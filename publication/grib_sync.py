"""Снятие публикаций отсутствующих GRIB по сохранённому плану."""

import argparse
import hashlib
import json
import os
import posixpath
import shutil
import stat
import signal
import sys
import uuid
from datetime import timedelta
from pathlib import Path

from decoder.sampling import canonical
from publication import recovery, retention, revisions
from publication.domain import ROOT, database, database_transaction, load_manifest, write_once


def fingerprint(value) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def input_names(directory: Path) -> list[str]:
    """Only names matter; changed contents under the same name remain present."""
    if not directory.is_dir() or directory.is_symlink():
        raise ValueError('Исходная папка отсутствует или недоступна')
    names = []
    # Materialize the entire enumeration; any stat/read failure aborts the plan.
    for path in directory.iterdir():
        mode = path.lstat().st_mode
        if stat.S_ISREG(mode):
            names.append(path.name)
    return sorted(names)


def direct_source(batch: dict, source_directories: list[str]) -> str | None:
    source = batch.get('source', {}).get('name')
    origin = batch.get('source', {}).get('directory')
    if (not isinstance(source, str) or not source or source in ('.', '..')
            or '/' in source or '\\' in source or batch.get('fixture', 'actual') != 'actual'
            or not isinstance(origin, str)
            or posixpath.normpath(origin.replace('\\', '/')) not in source_directories):
        return None
    return source


def plan_rows(names: list[str], rows: list[dict], target: str, configuration: dict,
              pending: list[dict] | None = None, source_directories: list[str] | None = None) -> dict:
    """Resolve provenance of every eligible root, including legacy selections."""
    actions, unchecked = [], []
    present = set(names)
    source_directories = sorted({posixpath.normpath(value.replace('\\', '/')) for value in
                                 (source_directories or [os.environ.get('GRIB_SOURCE_DIRECTORY', 'data/grib')])})
    for row in rows:
        if row['state'] != 'eligible':
            continue
        root = row['root']
        if row['kind'] == 'revision':
            manifest = revisions.load_revision(row['manifest_path'], row['manifest_sha256'])
            entries = manifest['batches']
            batches = [revisions.selected(manifest, entry) for entry in entries]
        else:
            entries = []
            batches = [load_manifest(row['manifest_path'], row['manifest_sha256'])]
        sources = [direct_source(batch, source_directories) for batch in batches]
        if not sources or None in sources:
            unchecked.append({'root': root, 'reason': 'Неизвестное происхождение или публикация вне области'})
            continue
        missing = sorted({source for source in sources if source is not None and source not in present})
        if missing:
            kept = [entry for entry, source in zip(entries, sources) if source in present]
            actions.append({'root': root, 'run': row['run'], 'kind': row['kind'],
                            'job_id': row['job_id'], 'missing': missing, 'keep': kept})
    body = {'version': 'grib-withdrawal/1', 'target': target, 'names': names,
            'catalogue': rows, 'policy': configuration, 'actions': actions, 'unchecked': unchecked,
            'pending': pending or [], 'source_directories': source_directories}
    return {**body, 'id': fingerprint(body)}


def preview(directory: Path, target: str, source_directories: list[str] | None = None) -> dict:
    configuration, _, roots = retention.snapshot()
    with database() as cursor:
        cursor.execute('SELECT * FROM app.revisions ORDER BY published_at,revision')
        modern = {row['revision']: row for row in cursor.fetchall()}
        cursor.execute('SELECT * FROM app.catalogue ORDER BY published_at,selection')
        legacy = {row['selection']: row for row in cursor.fetchall()}
        cursor.execute("SELECT id,source_name,state FROM app.jobs WHERE state NOT IN ('published','failed') "
                       "OR retryable ORDER BY id")
        pending = json.loads(json.dumps(cursor.fetchall(), default=str))
    rows = []
    for root in sorted(roots, key=lambda row: (retention.instant(row['published_at']), row['root'])):
        record = modern.get(root['root']) or legacy.get(root['root'])
        if record is None:
            continue
        rows.append({**root, **record, 'kind': 'revision' if root['root'] in modern else 'legacy'})
    # Canonical JSON-compatible snapshots retain dates and UUIDs without credentials.
    rows = json.loads(json.dumps(rows, default=str))
    return plan_rows(input_names(directory), rows, target, configuration, pending, source_directories)


def validate_plan(saved: dict, current: dict) -> None:
    if saved != current:
        raise ValueError('План устарел или изменён: выполните предварительный просмотр заново')


def apply(saved: dict, directory: Path, target: str, source_directories: list[str] | None = None) -> dict:
    """Prepare immutable leftovers, then expose all changes in one DB commit."""
    prepared: list[tuple[dict, dict, str, str]] = []
    created: list[Path] = []
    visibility_attempted = False
    with database() as guard:
        if not recovery.lock(guard):
            raise RuntimeError('Идёт публикация или очистка: повторите синхронизацию позже')
        try:
            current = preview(directory, target, source_directories)
            validate_plan(saved, current)
            missing = {name for action in current['actions'] for name in action['missing']}
            if any(job['source_name'] in missing for job in current['pending']):
                raise ValueError('Для отсутствующих исходников есть незавершённые задания: '
                                 'дождитесь их завершения и постройте новый план')
            rows = {row['root']: row for row in current['catalogue']}
            for action in current['actions']:
                if not action['keep']:
                    continue
                row = rows[action['root']]
                old = revisions.load_revision(row['manifest_path'], row['manifest_sha256'])
                body = {key: value for key, value in old.items() if key != 'revision'}
                body.update(parent=action['root'], batches=action['keep'], withdrawal_plan=current['id'])
                revision = fingerprint(body)
                recovery.reserve(len(canonical({**body, 'revision': revision})))
                # UUID attempt directories participate in the existing collector.
                attempt = ROOT / action['job_id'] / uuid.uuid4().hex
                attempt.mkdir(parents=True)
                created.append(attempt)
                path = attempt / 'revision.json'
                checksum = write_once(path, {**body, 'revision': revision})
                relative = path.relative_to(ROOT).as_posix()
                manifest = revisions.load_revision(relative, checksum)
                for entry in manifest['batches']:
                    revisions.selected(manifest, entry)
                descriptor = os.open(attempt.parent, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
                prepared.append((action, manifest, relative, checksum))
            # Revalidate after potentially expensive asset verification as well.
            validate_plan(saved, preview(directory, target, source_directories))
            visibility_attempted = True
            with database_transaction():
                with database() as cursor:
                    cursor.execute("SET LOCAL lock_timeout = '110s'")
                    cursor.execute('SELECT pg_advisory_xact_lock(16002)')
                    validate_plan(saved, preview(directory, target, source_directories))
                    for action, manifest, relative, checksum in prepared:
                        original = rows[action['root']]
                        cursor.execute('INSERT INTO app.revisions VALUES(%s,%s,%s,%s,%s,%s)',
                                       (manifest['revision'], manifest['run'], relative, checksum,
                                        original['published_at'], action['job_id']))
                        assets = {}
                        for entry in manifest['batches']:
                            assets.update(load_manifest(entry['manifest_path'], entry['manifest_sha256'])['assets'])
                        # A historical leftover keeps its place in publication
                        # order and its original retention deadlines.
                        cursor.execute('INSERT INTO app.retention_roots '
                            '(root,manifest_path,event_clock,run,wms_revision,published_at,superseded_at,managed_bytes) '
                            'SELECT %s,%s,event_clock,run,%s,published_at,superseded_at,%s '
                            'FROM app.retention_roots WHERE root=%s',
                            (manifest['revision'], relative, manifest['revision'],
                             sum(item['bytes'] for item in assets.values()), action['root']))
                    configuration = current['policy']
                    # Policy clocks can be pinned for a demo; both eligibility
                    # and deletion grace must use that same clock.
                    cursor.execute('SELECT clock_timestamp() AS clock')
                    clock = retention.instant(configuration.get('clock') or cursor.fetchone()['clock'])
                    deadline = clock + timedelta(seconds=configuration['reader_grace_seconds'])
                    # Reducing superseded budgets must never resurrect a root
                    # already expired before this visibility transaction.
                    for row in current['catalogue']:
                        if row['state'] == 'expired' and row['expired_at'] is None:
                            cursor.execute('UPDATE app.retention_roots SET expired_at=%s,delete_after=%s,reason=%s '
                                           'WHERE root=%s AND expired_at IS NULL',
                                           (row['expires_at'], deadline, row['reason'], row['root']))
                    for action in current['actions']:
                        cursor.execute('UPDATE app.retention_roots SET expired_at=%s,delete_after=%s,reason=%s '
                                       'WHERE root=%s', (clock, deadline, 'source-withdrawn', action['root']))
            created.clear()  # Published manifests now belong to retention.
            return {'state': 'applied', 'plan': saved['id'],
                    'withdrawn': [action['root'] for action in current['actions']],
                    'replacements': [{'previous': action['root'], 'revision': manifest['revision']}
                                     for action, manifest, _, _ in prepared]}
        finally:
            # No GIS workspace or new numerical assets are allocated. A failed
            # preparation only owns its freshly created attempt directories.
            removable = created
            if created and visibility_attempted:
                try:
                    with database() as cursor:
                        cursor.execute("SET LOCAL lock_timeout = '4s'")
                        cursor.execute('SELECT pg_advisory_xact_lock(16002)')
                        cursor.execute('SELECT manifest_path FROM app.revisions')
                        referenced = {row['manifest_path'] for row in cursor.fetchall()}
                    removable = [attempt for attempt in created
                                 if (attempt / 'revision.json').relative_to(ROOT).as_posix() not in referenced]
                except Exception:
                    # A lost COMMIT acknowledgement cannot prove rollback.
                    # Preserve immutable files for recovery/retention collection.
                    removable = []
                    print('Не удалось проверить исход транзакции; подготовленные данные сохранены. '
                          'Проверьте каталог и выполните новый просмотр.', file=sys.stderr)
            for attempt in removable:
                shutil.rmtree(attempt)


def main() -> None:
    def interrupted(signum, frame):
        raise InterruptedError('Операция отменена')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['preview', 'apply'])
    parser.add_argument('--target', required=True)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--input', type=Path, default=Path('/input'))
    parser.add_argument('--source-directory', action='append')
    args = parser.parse_args()
    try:
        if args.operation == 'preview':
            with database() as guard:
                if not recovery.lock(guard):
                    raise RuntimeError('Идёт публикация или очистка: повторите просмотр позже')
                result = preview(args.input, args.target, args.source_directory)
                with args.plan.open('x', encoding='utf-8') as stream:
                    json.dump(result, stream, ensure_ascii=False, indent=2)
            print('План сохранён. Отсутствующие файлы → снимаемые публикации:')
            for action in result['actions']:
                print(f'{", ".join(action["missing"])} → {action["root"]}; остаётся полей: {len(action["keep"])}')
            print(f'Публикаций вне области или с неизвестным происхождением: {len(result["unchecked"])}')
            for row in result['unchecked']:
                print(f'Непроверенная публикация: {row["root"]}; {row["reason"]}')
        else:
            result = apply(json.loads(args.plan.read_text(encoding='utf-8')), args.input, args.target, args.source_directory)
            print(json.dumps(result, ensure_ascii=False))
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        raise SystemExit(f'Синхронизация остановлена: {error}') from error


if __name__ == '__main__':
    main()
