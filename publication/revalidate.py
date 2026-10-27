"""Пересчёт NoData опубликованных полей с атомарной заменой редакций."""
import argparse
import copy
import hashlib
import json
import os
import signal
import uuid
from datetime import timedelta
from pathlib import Path

import zarr

from decoder.sampling import ManifestSampler, asset_path, canonical, file_hash, read_values
from decoder.storage import write_field, check_field
from decoder.validity import VERSION
from publication import grib_sync, recovery, retention, revisions, worker
from publication.domain import ROOT, database, database_transaction, load_manifest, sampler, write_once


def preview(target: str) -> dict:
    # Reuse the sealed-provenance snapshot without requiring original GRIB files.
    snapshot = grib_sync.preview(Path('/input'), target, remove_all=True)
    rows = [row for row in snapshot['catalogue'] if row['state'] == 'eligible']
    actions = []
    for row in rows:
        if row['kind'] == 'revision':
            root = revisions.load_revision(row['manifest_path'], row['manifest_sha256'])
            entries = root['batches']
        else:
            batch = grib_sync.source_manifest(row['manifest_path'], row['manifest_sha256'])
            entries = [{'key': revisions.batch_key(batch['identity']),
                        'field': batch['identity']['field'], 'valid_time': batch['identity']['valid_time'],
                        'manifest_path': row['manifest_path'], 'manifest_sha256': row['manifest_sha256']}]
        if any(grib_sync.source_manifest(entry['manifest_path'], entry['manifest_sha256'])
               ['source'].get('value_validity_version') != VERSION for entry in entries):
            actions.append({'root': row['root'], 'entries': entries})
    body = {'version': 'field-revalidation/1', 'rule_version': VERSION, 'target': target,
            'catalogue': rows, 'policy': snapshot['policy'], 'actions': actions}
    return {**body, 'id': grib_sync.fingerprint(body)}


def rebuild(job: dict, batch: dict, directory: Path) -> tuple[dict, str, str]:
    original = sampler(batch)
    item = next(item for item in original.manifest['fields']
                if item['field'] == batch['identity']['field']
                and item['metadata']['valid_time'] == batch['identity']['valid_time'])
    metadata = copy.deepcopy(item['metadata'])
    group = zarr.open_group(str(asset_path(original.root, item['zarr'])), mode='r', zarr_format=2)
    values = read_values(group, item.get('data_variable', 'temperature'))
    source_missing = (read_values(group, 'missing_reason') == 1 if 'missing_reason' in group
                      else read_values(group, 'missing').astype(bool))
    target = directory / 'numerical'
    target.mkdir(parents=True)
    replacement = write_field(target, 'field', metadata, values, source_missing)
    check = check_field(target, replacement, values, source_missing)
    write_once(target / 'validation.json', check)
    inventory = {path.relative_to(target).as_posix(): {'bytes': path.stat().st_size, 'sha256': file_hash(path)}
                 for path in sorted(target.rglob('*')) if path.is_file()}
    body = {key: value for key, value in original.manifest.items() if key not in ('revision', 'fields', 'assets')}
    body.update(fields=[replacement], assets=inventory,
                source={**original.manifest['source'], 'value_validity_version': VERSION,
                        'revalidated_from': batch.get('batch_selection', batch['selection'])})
    revision = hashlib.sha256(canonical(body)).hexdigest()
    write_once(target / 'manifest.json', {**body, 'revision': revision})
    for path in target.rglob('*'):
        if path.is_file():
            path.chmod(0o444)
    return worker.publish_batch(job, directory, ManifestSampler(target / 'manifest.json'), commit=False)


def apply(saved: dict, target: str) -> dict:
    with database() as guard:
        if not recovery.lock(guard):
            raise RuntimeError('Идёт публикация или очистка: повторите пересчёт позже')
        grib_sync.validate_plan(saved, preview(target))
        if not saved['actions']:
            return {'state': 'unchanged', 'replacements': []}
        clock = retention.instant(retention.snapshot()[1]).isoformat().replace('+00:00', 'Z')
        identifier = worker.submit(clock, {})
        with database() as cursor:
            cursor.execute('SELECT * FROM app.jobs WHERE id=%s', (identifier,))
            job = cursor.fetchone()
        attempt = ROOT / identifier / uuid.uuid4().hex
        attempt.mkdir(parents=True)
        prepared = []
        converted: dict[tuple[str, str], dict] = {}
        rows = {row['root']: row for row in saved['catalogue']}
        try:
            for action in saved['actions']:
                entries, assets = [], {}
                for entry in action['entries']:
                    reference = (entry['manifest_path'], entry['manifest_sha256'])
                    if reference not in converted:
                        batch = load_manifest(*reference)
                        if batch['source'].get('value_validity_version') == VERSION:
                            converted[reference] = {**entry, '_assets': batch['assets']}
                        else:
                            recovery.reserve(sum(asset['bytes'] for asset in batch['assets'].values()) * 2)
                            directory = attempt / f'batch-{len(converted):05d}'
                            directory.mkdir()
                            replacement, relative, checksum = rebuild(job, batch, directory)
                            from publication.catalogue import discovery
                            converted[reference] = {'key': revisions.batch_key(replacement['identity']),
                                'field': replacement['identity']['field'], 'valid_time': replacement['identity']['valid_time'],
                                'manifest_path': relative, 'manifest_sha256': checksum,
                                'discovery': discovery(replacement), '_assets': replacement['assets']}
                    converted_entry = converted[reference]
                    entries.append({key: value for key, value in converted_entry.items() if key != '_assets'})
                    assets.update(converted_entry['_assets'])
                row = rows[action['root']]
                body = {'schema_version': 2, 'pipeline_version': revisions.PIPELINE, 'run': row['run'],
                        'parent': action['root'], 'job': identifier, 'hour': 0, 'clock': clock,
                        'completeness': 'unknown', 'value_validity_version': VERSION,
                        'revalidation_plan': saved['id'], 'batches': sorted(entries, key=lambda entry: entry['key'])}
                revision = grib_sync.fingerprint(body)
                path = attempt / (revision + '.json')
                checksum = write_once(path, {**body, 'revision': revision})
                relative = path.relative_to(ROOT).as_posix()
                manifest = revisions.load_revision(relative, checksum)
                for entry in manifest['batches']:
                    revisions.selected(manifest, entry)
                prepared.append((action['root'], manifest, relative, checksum, assets))
            # No catalogue entry changes until every derivative passed readiness.
            for directory in (attempt, attempt.parent, ROOT):
                descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
            with database_transaction():
                with database() as cursor:
                    cursor.execute("SET LOCAL lock_timeout = '110s'")
                    cursor.execute('SELECT pg_advisory_xact_lock(16002)')
                    grib_sync.validate_plan(saved, preview(target))
                    configuration, now, roots = retention.snapshot()
                    deadline = retention.instant(now) + timedelta(seconds=configuration['reader_grace_seconds'])
                    # Retain previous expiry decisions despite the reduced count.
                    for row in roots:
                        if row['state'] == 'expired' and row['expired_at'] is None:
                            cursor.execute('UPDATE app.retention_roots SET expired_at=%s,delete_after=%s,reason=%s '
                                           'WHERE root=%s', (row['expires_at'], deadline, row['reason'], row['root']))
                    for previous, manifest, relative, checksum, assets in prepared:
                        row = rows[previous]
                        cursor.execute('INSERT INTO app.revisions VALUES(%s,%s,%s,%s,%s,%s)',
                                       (manifest['revision'], manifest['run'], relative, checksum, row['published_at'], identifier))
                        cursor.execute('INSERT INTO app.retention_roots '
                            '(root,manifest_path,event_clock,run,wms_revision,published_at,superseded_at,managed_bytes) '
                            'SELECT %s,%s,event_clock,run,%s,published_at,superseded_at,%s '
                            'FROM app.retention_roots WHERE root=%s',
                            (manifest['revision'], relative, manifest['revision'],
                             sum(asset['bytes'] for asset in assets.values()), previous))
                        cursor.execute('UPDATE app.retention_roots SET expired_at=%s,delete_after=%s,reason=%s '
                                       'WHERE root=%s', (now, deadline, 'source-withdrawn', previous))
                    cursor.execute("UPDATE app.jobs SET state='published',retryable=false,selection=%s WHERE id=%s",
                                   (prepared[-1][1]['revision'] + '.' + prepared[-1][1]['batches'][0]['key'], identifier))
            return {'state': 'applied', 'plan': saved['id'], 'job': identifier,
                    'replacements': [{'previous': previous, 'revision': manifest['revision']}
                                     for previous, manifest, _, _, _ in prepared]}
        except Exception:
            # Immutable attempts remain available to the regular collector;
            # never delete assets after an uncertain COMMIT acknowledgement.
            with database() as cursor:
                cursor.execute("UPDATE app.jobs SET state='failed',retryable=false,error='RevalidationFailed' "
                               "WHERE id=%s AND state<>'published'", (identifier,))
            raise


def main():
    def interrupted(signum, frame):
        raise InterruptedError('Пересчёт отменён')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['preview', 'apply'])
    parser.add_argument('--target', required=True)
    parser.add_argument('--plan', type=Path, required=True)
    args = parser.parse_args()
    if args.operation == 'preview':
        with database() as guard:
            if not recovery.lock(guard):
                raise RuntimeError('Идёт публикация или очистка')
            result = preview(args.target)
            with args.plan.open('x', encoding='utf-8') as stream:
                json.dump(result, stream, ensure_ascii=False, indent=2)
            print(f'План сохранён. Редакций для пересчёта: {len(result["actions"])}')
    else:
        with recovery.processing_budget():
            result = apply(json.loads(args.plan.read_bytes()), args.target)
        print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
