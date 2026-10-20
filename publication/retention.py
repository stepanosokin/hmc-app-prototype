"""Reference-time retention, durable expiry and managed-only graph collection.

The worker lock serializes policy/publication/collection. A second shared reader
lock prevents unlinking assets while an HTTP operation uses them. No session can
renew a deadline; restarting services or changing policy cannot undo a tombstone.
"""

import argparse
import json
import os
import shutil
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from decoder.sampling import asset_path
from publication.domain import ROOT, database


class ExpiredSelection(LookupError):
    """A previously published selection has reached a fixed policy deadline."""


def instant(value) -> datetime:
    result = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('retention clock must include a timezone')
    return result.astimezone(timezone.utc)


def policy(**changes) -> dict:
    value: dict = dict(days=7, reader_grace_seconds=120, superseded_grace_seconds=86400,
                 superseded_count=64, superseded_bytes=16 * 1024**3, demo_runs=[], clock=None)
    value.update(changes)
    for key, low, high in [('days', 7, 30), ('reader_grace_seconds', 0, 3600),
                           ('superseded_grace_seconds', 0, 30 * 86400),
                           ('superseded_count', 0, 1024), ('superseded_bytes', 0, 1024**4)]:
        if type(value[key]) is not int or not low <= value[key] <= high:
            raise ValueError(f'{key} must be an integer in {low}..{high}')
    if not isinstance(value['demo_runs'], list) or len(value['demo_runs']) > 16:
        raise ValueError('at most 16 explicit demo runs are allowed')
    for run in value['demo_runs']:
        instant(run.rsplit('/', 1)[1])
    if value['clock'] is not None:
        instant(value['clock'])
    return value


def decisions(roots: list[dict], configuration: dict, clock) -> list[dict]:
    """Plan eligibility without mutation; valid times never affect run retention.

    Superseded budgets count conservative logical bytes (shared bytes can be
    counted more than once). The latest revision is outside these budgets.
    """
    now = instant(clock)
    result = []
    for row in roots:
        cutoff = instant(row['run'].rsplit('/', 1)[1]) + timedelta(days=configuration['days'])
        reason = 'reference-time'
        if row['run'] in configuration['demo_runs']:
            cutoff = datetime.max.replace(tzinfo=timezone.utc)
            reason = 'demo-pin'
        if row['superseded_at'] is not None:
            superseded = instant(row['superseded_at'])
            grace = superseded + timedelta(seconds=configuration['superseded_grace_seconds'])
            if grace < cutoff:
                cutoff, reason = grace, 'superseded-grace'
            newer = [other for other in roots if other['run'] == row['run']
                     and other['superseded_at'] is not None
                     and (instant(other['published_at']), other['root']) >= (instant(row['published_at']), row['root'])]
            if (len(newer) > configuration['superseded_count']
                    or sum(item['managed_bytes'] for item in newer) > configuration['superseded_bytes']):
                cutoff, reason = min(cutoff, superseded), 'superseded-budget'
        if row['expired_at'] is not None:
            cutoff, reason = instant(row['expired_at']), row.get('reason') or 'expired'
        result.append({**row, 'expires_at': cutoff.isoformat(), 'reason': reason,
                       'state': 'expired' if row['expired_at'] is not None or now >= cutoff else 'eligible'})
    return result


def migrate() -> None:
    """Additive migration; caller holds the worker lock before backfilling."""
    with database() as cursor:
        cursor.execute('CREATE TABLE IF NOT EXISTS app.retention_policy ('
                       'singleton boolean PRIMARY KEY CHECK(singleton), configuration jsonb NOT NULL)')
        cursor.execute('CREATE TABLE IF NOT EXISTS app.retention_roots ('
                       'root text PRIMARY KEY, manifest_path text NOT NULL, event_clock timestamptz NOT NULL, '
                       'run text NOT NULL, wms_revision text NOT NULL, published_at timestamptz NOT NULL, '
                       'superseded_at timestamptz, managed_bytes bigint NOT NULL, '
                       'expired_at timestamptz, delete_after timestamptz, reason text)')
        cursor.execute('INSERT INTO app.retention_policy VALUES(true,%s) ON CONFLICT DO NOTHING',
                       (json.dumps(policy(clock=os.environ.get('PUBLICATION_CLOCK'))),))
        cursor.execute('GRANT SELECT ON app.retention_policy,app.retention_roots TO hmc_api')
        cursor.execute('SELECT * FROM app.revisions ORDER BY published_at,revision')
        revisions = cursor.fetchall()
        cursor.execute('SELECT * FROM app.catalogue ORDER BY published_at,selection')
        legacy = cursor.fetchall()
        cursor.execute('SELECT root FROM app.retention_roots')
        existing = {row['root'] for row in cursor.fetchall()}
    from publication.revisions import load_revision
    from publication.domain import load_manifest
    for row in sorted(revisions + legacy, key=lambda row: (instant(row['published_at']),
                                                          row.get('revision', row.get('selection')))):
        root = row.get('revision', row.get('selection'))
        if root in existing:
            continue
        manifest = (load_revision if 'revision' in row else load_manifest)(row['manifest_path'], row['manifest_sha256'])
        with database() as cursor:
            register(cursor, root, manifest, row['manifest_path'], row['published_at'])


def register(cursor, root: str, manifest: dict, manifest_path: str, published_at=None) -> None:
    """Commit retention identity in the same transaction as publication."""
    from publication.domain import load_manifest
    run = manifest.get('run') or manifest['identity']['run']
    assets = dict(manifest.get('assets', {}))
    for batch in manifest.get('batches', []):
        assets.update(load_manifest(batch['manifest_path'], batch['manifest_sha256'])['assets'])
    cursor.execute('SELECT configuration FROM app.retention_policy WHERE singleton')
    configuration = cursor.fetchone()['configuration']
    cursor.execute('SELECT clock_timestamp() AS clock')
    observed = cursor.fetchone()['clock']
    event_clock = published_at or configuration.get('clock') or observed
    cursor.execute('INSERT INTO app.retention_roots(root,manifest_path,event_clock,run,wms_revision,published_at,managed_bytes) '
                   'VALUES(%s,%s,%s,%s,%s,%s,%s)',
                   (root, manifest_path, event_clock, run, manifest.get('revision') or manifest['identity']['revision'],
                    published_at or observed,
                    sum(item['bytes'] for item in assets.values())))
    # Wall publication chronology and the explicit policy clock are separate.
    # Late adoption of older rows must never supersede a newer current root.
    cursor.execute('SELECT root,superseded_at,event_clock FROM app.retention_roots '
                   'WHERE run=%s ORDER BY published_at,root', (run,))
    ordered = cursor.fetchall()
    for previous, successor in zip(ordered, ordered[1:]):
        if previous['superseded_at'] is None or instant(previous['superseded_at']) > instant(successor['event_clock']):
            cursor.execute('UPDATE app.retention_roots SET superseded_at=%s WHERE root=%s',
                           (successor['event_clock'], previous['root']))


def snapshot() -> tuple[dict, str, list[dict]]:
    with database() as cursor:
        cursor.execute('SELECT configuration FROM app.retention_policy WHERE singleton')
        configuration = policy(**cursor.fetchone()['configuration'])
        cursor.execute('SELECT * FROM app.retention_roots')
        roots = cursor.fetchall()
    clock = configuration['clock'] or datetime.now(timezone.utc).isoformat()
    return configuration, clock, decisions(roots, configuration, clock)


def ensure(root: str) -> dict | None:
    _, _, rows = snapshot()
    row = next((row for row in rows if row['root'] == root), None)
    if row is not None and row['state'] == 'expired':
        raise ExpiredSelection(root)
    return row


@contextmanager
def reader():
    """Hold through response generation; new readers queue behind collection."""
    with database() as cursor:
        cursor.execute('SELECT pg_advisory_xact_lock_shared(16002)')
        yield


def configure(configuration: dict) -> dict:
    from publication import recovery
    configuration = policy(**configuration)
    with database() as guard:
        if not recovery.lock(guard):
            raise RuntimeError('worker busy; retry policy configuration')
        migrate()
        with database() as cursor:
            cursor.execute('UPDATE app.retention_policy SET configuration=%s WHERE singleton',
                           (json.dumps(configuration),))
    return configuration


def inventory(paths: list[Path]) -> dict:
    categories = dict(originals=0, zarr=0, cogs=0, numeric_tiles=0, metadata=0, other=0)
    files = sorted({path for root in paths for path in ([root] if root.is_file() else root.rglob('*')) if path.is_file()})
    for path in files:
        if path.suffix == '.grib2':
            category = 'originals'
        elif any(part.endswith('.zarr') for part in path.parts):
            category = 'zarr'
        elif path.suffix == '.tif':
            category = 'cogs'
        elif path.suffix == '.f32':
            category = 'numeric_tiles'
        elif path.suffix == '.json':
            category = 'metadata'
        else:
            category = 'other'
        categories[category] += path.stat().st_size
    return {'logical_bytes': sum(categories.values()), 'files': len(files), 'categories': categories}


def collect(*, apply: bool = False) -> dict:
    from publication import recovery, geoserver
    from publication.revisions import load_revision
    with database() as guard:
        if not recovery.lock(guard):
            raise RuntimeError('worker busy; retry retention')
        migrate()
        configuration, clock, rows = snapshot()
        now = instant(clock)
        # Persist expiry before considering physical removal. Keep roots as
        # tombstones even after manifest rows/files are removed.
        for row in rows:
            if row['state'] == 'expired' and row['expired_at'] is None:
                row['expired_at'] = row['expires_at']
                row['delete_after'] = (now + timedelta(seconds=configuration['reader_grace_seconds'])).isoformat()
                if apply:
                    with database() as cursor:
                        cursor.execute('UPDATE app.retention_roots SET expired_at=%s,delete_after=%s,reason=%s '
                                       'WHERE root=%s AND expired_at IS NULL',
                                       (row['expired_at'], row['delete_after'], row['reason'], row['root']))
        retained = {row['root'] for row in rows if row['state'] == 'eligible'
                    or (row['delete_after'] is not None and instant(row['delete_after']) > now)}
        with database() as cursor:
            cursor.execute('SELECT * FROM app.revisions')
            revisions = cursor.fetchall()
            cursor.execute('SELECT * FROM app.catalogue')
            legacy = cursor.fetchall()
            cursor.execute('SELECT * FROM app.jobs')
            jobs = cursor.fetchall()
        roots = []
        expired_revisions, expired_legacy = [], []
        for row in revisions:
            if row['revision'] in retained:
                manifest = load_revision(row['manifest_path'], row['manifest_sha256'])
                roots.append(row['manifest_path'])
                roots.extend(entry['manifest_path'] for entry in manifest['batches'])
            else:
                expired_revisions.append(row['revision'])
        for row in legacy:
            if row['selection'] in retained:
                roots.append(row['manifest_path'])
            else:
                expired_legacy.append(row['selection'])
        # Reuse the existing abandoned-attempt collector after pruning expired
        # roots. Protect whole shared batches, never delete individual assets.
        protected = [Path(relative).parts for relative in roots]
        candidates: list[Path] = []
        originals: list[Path] = []
        for job in jobs:
            directory = ROOT / str(job['id'])
            if directory.is_symlink():
                raise ValueError('refuse symlinked managed job')
            directory.resolve().relative_to(ROOT.resolve())
            if job['state'] not in ('published', 'failed') or job['retryable']:
                continue
            if (job['manifest_path'] and directory.exists()
                    and not any(parts[0] == directory.name for parts in protected)):
                candidates.append(directory)
                continue
            for attempt in sorted(directory.iterdir()) if directory.exists() else []:
                if not attempt.is_dir() or attempt.is_symlink():
                    continue
                try:
                    import uuid
                    uuid.UUID(hex=attempt.name)
                except ValueError:
                    continue
                references = [parts for parts in protected if parts[:2] == (directory.name, attempt.name)]
                if not references:
                    candidates.append(attempt)
                elif not any(len(parts) < 4 for parts in references):
                    candidates.extend(child for child in attempt.iterdir() if child.is_dir()
                                      and child.name.startswith('hour-') and not child.is_symlink()
                                      and not any(parts[2] == child.name for parts in references))
            # Preserve managed original while any retained root uses this job's
            # assets. Failed/quarantined deliveries remain recovery's concern.
            if (job['state'] == 'published' and not any(parts[0] == directory.name for parts in protected)
                    and job['managed_source']):
                originals.append(asset_path(ROOT, job['managed_source']))
            # T5 copies its input at attempt level. Only whole attempt deletion
            # removes it; no organization /input path is ever a candidate.
        candidates.extend(path for path in originals if path.exists())
        # A small superseded revision manifest can share a directory with a
        # still-referenced batch. Its exact file is independently collectible.
        for row in rows:
            if row['root'] not in retained and row['manifest_path'] not in roots:
                path = asset_path(ROOT, row['manifest_path'])
                if path.exists() and not any(target == path or target in path.parents for target in candidates):
                    candidates.append(path)
        for path in candidates:
            path.resolve().relative_to(ROOT.resolve())
            if path.is_symlink() or any(child.is_symlink() for child in path.rglob('*')):
                raise ValueError('refuse symlinks in managed cleanup')
        report: dict = {'apply': apply, 'clock': clock, 'policy': configuration,
                  'roots': rows, 'storage': inventory([ROOT]), 'reclaimable': inventory(candidates),
                  'candidates': [path.relative_to(ROOT).as_posix() for path in candidates],
                  'removed': [], 'reader_lock': 'exclusive queued drain; 110 second timeout',
                  'server_cache': {'scope': 'per API process; purged before request eligibility',
                                   'maximum_bytes_per_process': int(os.environ.get('TILE_CACHE_BYTES', 16777216))},
                  'source_mount': '/input is read-only and outside managed cleanup'}
        if apply:
            with database(timeout=120) as deletion:
                deletion.execute("SET LOCAL lock_timeout = '110s'")
                # PostgreSQL queues later shared readers behind this writer.
                # Continuous unrelated traffic cannot renew the old-reader pin.
                # A stuck read fails the bounded operation, never forces unlink.
                deletion.execute('SELECT pg_advisory_xact_lock(16002)')
                # Drop GIS/index before files; failure preserves manifests for
                # idempotent retry. Tombstones already prevent all new reads.
                for target in candidates:
                    for record in target.rglob('workspace.json'):
                        geoserver.discard_staging(json.loads(record.read_bytes())['workspace'])
                # Commit pruning before unlink: crashes cannot leave a database
                # root referencing a partially deleted manifest. Retained graph
                # was calculated under the writer lock and remains unchanged.
                with database() as pruning:
                    for revision in expired_revisions:
                        pruning.execute('DELETE FROM app.revisions WHERE revision=%s', (revision,))
                    for selection in expired_legacy:
                        pruning.execute('DELETE FROM app.catalogue WHERE selection=%s', (selection,))
                for target in candidates:
                    if target.is_dir():
                        shutil.rmtree(target)
                    else:
                        target.unlink(missing_ok=True)
                    report['removed'].append(target.relative_to(ROOT).as_posix())
        return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['configure', 'collect', 'report'])
    parser.add_argument('--days', type=int, default=7)
    parser.add_argument('--reader-grace-seconds', type=int, default=120)
    parser.add_argument('--superseded-grace-seconds', type=int, default=86400)
    parser.add_argument('--superseded-count', type=int, default=64)
    parser.add_argument('--superseded-bytes', type=int, default=16 * 1024**3)
    parser.add_argument('--clock', help='Explicit isolated demo/test clock; omit for wall UTC')
    parser.add_argument('--demo-run', action='append', default=[])
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.command == 'configure':
        result = configure(policy(days=args.days, reader_grace_seconds=args.reader_grace_seconds,
                                  superseded_grace_seconds=args.superseded_grace_seconds,
                                  superseded_count=args.superseded_count, superseded_bytes=args.superseded_bytes,
                                  clock=args.clock, demo_runs=args.demo_run))
    else:
        result = collect(apply=args.apply if args.command == 'collect' else False)
    print(json.dumps(result, default=str, indent=2))


if __name__ == '__main__':
    main()
