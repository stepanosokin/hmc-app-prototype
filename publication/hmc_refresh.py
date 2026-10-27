"""План и выполнение инкрементального обновления для общей команды hmc-app."""

import argparse
import json
import os
import signal
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from publication import grib_batch, grib_sync, recovery, retention, revisions
from publication.domain import database


def published_names(plan: dict, jobs: dict) -> list[str]:
    """Only a complete, still available delivery counts as an imported file."""
    result = set()
    for row in plan['catalogue']:
        if row['state'] != 'eligible':
            continue
        if row['kind'] == 'revision':
            manifest = revisions.load_revision(row['manifest_path'], row['manifest_sha256'])
            entries = manifest['batches']
        else:
            entries = [row]
        counts: dict = defaultdict(set)
        for entry in entries:
            batch = grib_sync.source_manifest(entry['manifest_path'], entry['manifest_sha256'])
            name = grib_sync.direct_source(batch, plan['source_directories'], plan['include_unlocated'])
            identifier = batch.get('identity', {}).get('publication_job')
            job = jobs.get(str(identifier))
            if name and job and job['state'] == 'published':
                counts[(name, str(identifier))].add(batch['source'].get('message_sha256') or entry['manifest_path'])
        for (name, identifier), messages in counts.items():
            expected = len((jobs[identifier].get('request') or {}).get('hours') or [1])
            if len(messages) >= expected:
                result.add(name)
    return sorted(result)


def build_plan(directory: Path, target: str, directories: list[str], include_unlocated: bool,
               remove_all: bool) -> dict:
    withdrawal = grib_sync.preview(directory, target, directories, include_unlocated, remove_all)
    with database() as cursor:
        cursor.execute('SELECT id,state,request FROM app.jobs')
        jobs = {str(row['id']): row for row in cursor.fetchall()}
    # A dead hmc worker may leave a retryable job. The worker lock is checked
    # by the caller before treating it as interrupted rather than still running.
    interrupted = [job['id'] for job in withdrawal['pending']
                   if (jobs[str(job['id'])].get('request') or {}).get('hmc_refresh')]
    if any(job['id'] not in interrupted for job in withdrawal['pending']):
        raise RuntimeError('Есть незавершённые задания загрузки. Завершите их перед обновлением или очисткой')
    names = [] if remove_all else [item.name for item in grib_batch.discover(directory)]
    known = [] if remove_all else published_names(withdrawal, jobs)
    return {'withdrawal': withdrawal, 'load': sorted(set(names)-set(known)),
            'keep': sorted(set(names)&set(known)), 'interrupted': interrupted,
            'remove_all': remove_all, 'grib_names': names,
            'cleanup_pending': [row['root'] for row in withdrawal['catalogue'] if row.get('cleanup_after') is not None
                                and row.get('reason') == 'source-withdrawn']}


def collect_when_ready(report: Path) -> None:
    # Persisted wall deadlines make collection retryable across CLI/service restarts.
    while True:
        with database() as cursor:
            cursor.execute('SELECT max(cleanup_after) AS deadline FROM app.retention_roots '
                           "WHERE reason='source-withdrawn' AND cleanup_after IS NOT NULL")
            deadline = cursor.fetchone()['deadline']
        delay = max(0, (retention.instant(deadline)-datetime.now(timezone.utc)).total_seconds()) if deadline else 0
        if delay > 0:
            time.sleep(min(delay, 30))
            continue
        try:
            result = retention.collect(apply=True)
            report.write_text(json.dumps(result, default=str, ensure_ascii=False, indent=2)+'\n')
            return
        except RuntimeError:
            time.sleep(2)  # Another writer owns the lock; never force collection.


def main() -> None:
    def interrupted(signum, frame):
        raise InterruptedError('Операция остановлена; следующий запуск построит новый план')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['preview', 'apply', 'collect'])
    parser.add_argument('--plan', type=Path, default=Path('/evidence/plan.json'))
    parser.add_argument('--target', default='')
    parser.add_argument('--source-directory', action='append', default=[])
    parser.add_argument('--include-unlocated', action='store_true')
    parser.add_argument('--remove-all', action='store_true')
    args = parser.parse_args()
    if args.operation == 'collect':
        collect_when_ready(Path('/evidence/cleanup.json'))
        return
    directory = Path('/input')
    with database() as coordinator:
        coordinator.execute('SELECT pg_try_advisory_lock(16060) AS acquired')
        if not coordinator.fetchone()['acquired']:
            raise RuntimeError('Уже выполняется обновление данных этого проекта')
        with database() as guard:
            if not recovery.lock(guard):
                raise RuntimeError('Выполняется загрузка или очистка. Повторите команду позже')
            current = build_plan(directory, args.target, args.source_directory,
                                 args.include_unlocated, args.remove_all)
        if args.operation == 'preview':
            with args.plan.open('x', encoding='utf-8') as stream:
                json.dump(current, stream, ensure_ascii=False, indent=2)
            return
        saved = json.loads(args.plan.read_text())
        grib_sync.validate_plan(saved, current)
        with database() as guard:
            if not recovery.lock(guard):
                raise RuntimeError('Выполняется загрузка или очистка')
            # Retire only interrupted jobs created by this mechanism. Successful
            # deliveries and jobs belonging to other operators are untouched.
            with database() as cursor:
                for identifier in current['interrupted']:
                    cursor.execute("UPDATE app.jobs SET state='failed',retryable=false,error='HmcInterrupted' WHERE id=%s",
                                   (identifier,))
        withdrawal = dict(current['withdrawal'])
        withdrawal['pending'] = [job for job in withdrawal['pending'] if job['id'] not in current['interrupted']]
        withdrawal['id'] = grib_sync.fingerprint({key: value for key, value in withdrawal.items() if key != 'id'})
        print(json.dumps({'hmc_progress': 'Снятие публикаций'}), flush=True)
        result = grib_sync.apply(withdrawal, directory, args.target, args.source_directory,
                                 args.include_unlocated, args.remove_all, operational_cleanup=True)
        Path('/evidence/withdrawal.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
        if not args.remove_all:
            # A changed directory listing invalidates approved additions as well.
            names = [item.name for item in grib_batch.discover(directory)]
            if names != current['grib_names']:
                raise ValueError('Состав GRIB изменился во время обновления. Выполните новый просмотр')
            grib_batch.ingest(os.environ.get('PUBLICATION_CLOCK', '2026-10-19T05:00:00Z'),
                              Path('/evidence/reload-grib.json'), True, current['load'], True, True)
        print(json.dumps({'hmc_progress': 'Изменения применены'}), flush=True)


if __name__ == '__main__':
    main()
