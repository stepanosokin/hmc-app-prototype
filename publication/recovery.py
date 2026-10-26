"""Bounded durable recovery for the approved, sample-only ingestion pipeline.

All mutations share the worker advisory lock. Source mounts are never written.
Published directories are retained; collection removes only abandoned attempts.
"""

import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import uuid
import signal
import stat
import re
from contextlib import contextmanager

from decoder.inspect_forecast import SAMPLE_SHA256, ValidationError
from decoder.sampling import canonical, file_hash
from decoder.storage import bounded_frames, field_metadata, decoded_arrays
from publication.domain import ROOT, database, write_once

PIPELINE = 't6.1'
MAX_SOURCE_BYTES = 64 * 1024**2
MAX_STORAGE_BYTES = int(os.environ.get('PUBLICATION_STORAGE_BYTES', 16 * 1024**3))
MAX_ATTEMPTS = 3
RETRY_SECONDS = 2
MAX_JOBS = 128


def source_limit(request: dict) -> int:
    return 128 * 1024**2 if request.get('source_profile')=='grib2-fields' else MAX_SOURCE_BYTES


class DeliveryInvalid(ValueError):
    """A retained delivery is invalid for the approved sample pipeline."""


def migrate() -> None:
    from publication.access import migrate as access_migrate
    access_migrate()
    from publication.revisions import migrate as revisions_migrate
    revisions_migrate()
    with database() as cursor:
        for definition in ('attempts integer NOT NULL DEFAULT 0', 'stage text',
                           'retry_at timestamptz', 'retryable boolean NOT NULL DEFAULT false',
                           'delivery_key text', 'managed_source text'):
            cursor.execute('ALTER TABLE app.jobs ADD COLUMN IF NOT EXISTS ' + definition)
        cursor.execute('CREATE UNIQUE INDEX IF NOT EXISTS jobs_delivery_key ON app.jobs(delivery_key)')
    from publication.retention import migrate as retention_migrate
    # Retention backfill must share publication's serialization boundary.
    with database() as guard:
        if not lock(guard):
            raise RuntimeError('worker busy; retry migration')
        retention_migrate()


def lock(cursor) -> bool:
    cursor.execute('SELECT pg_try_advisory_lock(16001) AS acquired')
    return cursor.fetchone()['acquired']


def storage_bytes() -> int:
    return sum(path.stat().st_size for path in ROOT.rglob('*') if path.is_file())


def reserve(required: int) -> None:
    if storage_bytes() + required > MAX_STORAGE_BYTES or shutil.disk_usage(ROOT).free < required:
        raise OSError('managed storage budget exhausted')


def stage(job: dict, name: str) -> None:
    if not (job.get('request') or {}).get('recoverable'):
        return
    with database() as cursor:
        cursor.execute('UPDATE app.jobs SET stage=%s WHERE id=%s', (name, str(job['id'])))


def checkpoint(job: dict, name: str) -> None:
    stage(job, name)
    # Explicit integration-only pause: the harness kills the actual worker here.
    if os.environ.get('T6_PAUSE_STAGE') == name and (job.get('request') or {}).get('recoverable'):
        marker = Path('/evidence') / ('pause-' + str(job['id']) + '.json')
        marker.write_text(json.dumps({'stage': name, 'pid': os.getpid()}))
        while True:
            time.sleep(0.1)


@contextmanager
def processing_budget():
    def expired(signum, frame):
        raise TimeoutError('publication attempt exceeded 600 seconds')
    previous = signal.signal(signal.SIGALRM, expired)
    signal.alarm(600)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)


def submit(clock: str, request: dict, source_name: str, delivery_sha256: str | None,
           stability_seconds: float) -> str:
    from decoder.grib_crs import configuration
    request = dict(request)
    if 'crs_configuration' not in request:
        request['crs_configuration'] = configuration()
    with processing_budget():
        return capture(clock, request, source_name, delivery_sha256, stability_seconds)


def bounded_checksum(path: Path, limit: int = MAX_SOURCE_BYTES) -> str:
    checksum = hashlib.sha256()
    remaining = limit + 1
    with path.open('rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError('source must be a regular file')
        while remaining:
            chunk = stream.read(min(1024**2, remaining))
            if not chunk:
                return checksum.hexdigest()
            checksum.update(chunk)
            remaining -= len(chunk)
    raise ValueError('source exceeds 64 MiB sample pipeline limit')


def capture(clock: str, request: dict, source_name: str, delivery_sha256: str | None,
            stability_seconds: float) -> str:
    if Path(source_name).name != source_name or source_name in ('', '.', '..'):
        raise ValueError('source must be a basename under the read-only input mount')
    if not 0 <= stability_seconds <= 300 or (delivery_sha256 is None and stability_seconds < 1):
        raise ValueError('use a producer SHA256/atomic-delivery signal or a stability delay in 1..300 seconds')
    migrate()
    with database() as guard:
        if not lock(guard):
            raise RuntimeError('worker busy; retry submission')
        source = Path('/input') / source_name
        # Refuse links escaping the configured source directory.
        source.resolve().relative_to(Path('/input').resolve())
        before = source.stat()
        if not stat.S_ISREG(before.st_mode):
            raise ValueError('source must be a regular file')
        limit=source_limit(request)
        if before.st_size > limit:
            raise ValueError('source exceeds bounded pipeline limit')
        if delivery_sha256 is None:
            time.sleep(stability_seconds)
            after = source.stat()
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise ValueError('delivery still changing; retry discovery')
        checksum = bounded_checksum(source,limit)
        key = hashlib.sha256(canonical({'source': checksum, 'pipeline': PIPELINE, 'request': request,
                                      'producer_sha256': delivery_sha256})).hexdigest()
        with database() as cursor:
            cursor.execute('SELECT id,error FROM app.jobs WHERE delivery_key=%s', (key,))
            existing = cursor.fetchone()
            if existing and existing['error'] != 'CaptureInterrupted':
                return str(existing['id'])
            cursor.execute("SELECT count(*) AS count FROM app.jobs WHERE state <> 'published'")
            if cursor.fetchone()['count'] >= MAX_JOBS and existing is None:
                raise RuntimeError('job backlog budget exhausted')
        reserve(limit)
        identifier = str(existing['id']) if existing else str(uuid.uuid4())
        directory = ROOT / identifier
        relative = (directory / 'original.grib2').relative_to(ROOT).as_posix()
        if existing is None:
            # Commit capture intent before creating any managed bytes. Failed
            # capture stays discoverable and resubmission resumes this identity.
            with database() as cursor:
                cursor.execute('INSERT INTO app.jobs(id,submitted_at,source_name,checksum,pipeline_version,state,history,'
                               'request,delivery_key,managed_source,retryable,error,stage) '
                               'VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                               (identifier, clock, source_name, checksum, PIPELINE, 'failed',
                                json.dumps([{'state': 'discovered', 'clock': clock},
                                            {'state': 'failed', 'failed_stage': 'capture', 'error_type': 'CaptureInterrupted'}]),
                                json.dumps({**request, 'producer_sha256': delivery_sha256}), key, relative,
                                False, 'CaptureInterrupted', 'capture'))
        directory.mkdir(exist_ok=True)
        staged = directory / 'original.grib2'
        # Bound the copy even if a producer grows the file after discovery.
        if not staged.exists():
            temporary = directory / ('capture-' + uuid.uuid4().hex + '.grib2')
            with source.open('rb') as incoming, temporary.open('xb') as outgoing:
                remaining = limit + 1
                while remaining:
                    chunk = incoming.read(min(1024**2, remaining))
                    if not chunk:
                        break
                    outgoing.write(chunk)
                    remaining -= len(chunk)
                    checkpoint({'id': identifier, 'request': request}, 'capture')
                outgoing.flush()
                os.fsync(outgoing.fileno())
            temporary.chmod(0o444)
            temporary.rename(staged)
        checkpoint({'id': identifier, 'request': request}, 'captured')
        complete_capture({'id': identifier, 'source_name': source_name, 'managed_source': relative,
                          'checksum': checksum, 'request': {**request,'producer_sha256': delivery_sha256}}, stability_seconds)
        return identifier


def complete_capture(job: dict, stability_seconds: float | None) -> None:
    staged = ROOT / job['managed_source']
    limit=source_limit(job['request'])
    observed = bounded_checksum(staged, limit + 1)
    declared = job['request'].get('producer_sha256')
    invalid = (staged.stat().st_size > limit or observed != job['checksum']
               or (declared is not None and observed != declared))
    # A crash after metadata durability but before database acknowledgement
    # reuses the same original and records another immutable capture receipt.
    write_once(staged.parent / ('delivery-' + uuid.uuid4().hex + '.json'), {
        'source_name': job['source_name'], 'sha256': observed, 'producer_sha256': declared,
        'stability_seconds': stability_seconds,
        'note': 'Stable size is not proof of completeness; full structural/decode checks follow.'})
    descriptor = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    with database() as cursor:
        cursor.execute('UPDATE app.jobs SET checksum=%s,state=%s,retryable=%s,error=%s,stage=%s,history=history || %s '
                       'WHERE id=%s', (observed, 'failed' if invalid else 'discovered', not invalid,
                       'DeliveryChecksumMismatch' if invalid else None, 'delivery',
                       json.dumps([{'state': 'failed' if invalid else 'discovered', 'capture': 'durable'}]), str(job['id'])))


def source(job: dict) -> Path:
    """Validate the entire managed delivery before any per-hour publication."""
    from publication.worker import transition
    with database() as cursor:
        cursor.execute('UPDATE app.jobs SET stage=%s WHERE id=%s', ('decoding', str(job['id'])))
    staged = ROOT / job['managed_source']
    if file_hash(staged) != job['checksum']:
        raise DeliveryInvalid('managed source integrity failed')
    try:
        count = 0
        for count, frame in enumerate(bounded_frames(staged), 1):
            generic = bool(job.get('request',{}).get('source_profile'))
            if count > (4096 if generic else 24):
                raise DeliveryInvalid('too many source messages')
            metadata = field_metadata(frame,count,job.get('request', {}).get('crs_configuration'),sample_inventory=not generic,
                                      all_fields=job.get('request',{}).get('source_profile')=='grib2-fields')
            decoded_arrays(frame, metadata['grid']['shape_yx'])
            checkpoint(job, 'decoding')
        if (not job.get('request',{}).get('source_profile') and (count != 24 or job['checksum'] != SAMPLE_SHA256)) or count<1:
            raise DeliveryInvalid('incomplete or unsupported sample delivery')
    except (ValidationError, RuntimeError, ValueError) as error:
        raise DeliveryInvalid('partial, truncated or unsupported GRIB delivery') from error
    transition(str(job['id']), 'staged', source_sha256=job['checksum'])
    reserve(len(job['request']['hours']) * 128 * 1024**2)
    return staged


def failed(job: dict, error: Exception) -> None:
    from publication.worker import transition
    retryable = not isinstance(error, DeliveryInvalid) and job['attempts'] < MAX_ATTEMPTS
    with database() as cursor:
        cursor.execute('SELECT stage FROM app.jobs WHERE id=%s', (str(job['id']),))
        stage = cursor.fetchone()['stage']
    transition(str(job['id']), 'failed', error_type=type(error).__name__, failed_stage=stage, attempt=job['attempts'])
    with database() as cursor:
        cursor.execute('UPDATE app.jobs SET error=%s,retryable=%s,retry_at=clock_timestamp() + '
                       "interval '2 seconds' WHERE id=%s", (type(error).__name__, retryable, str(job['id'])))


def retry(identifier: str) -> None:
    with database() as guard:
        if not lock(guard):
            raise RuntimeError('worker busy; retry later')
        with database() as cursor:
            cursor.execute('SELECT * FROM app.jobs WHERE id=%s', (identifier,))
            job = cursor.fetchone()
        if job and job['error'] == 'CaptureInterrupted':
            if not (ROOT / job['managed_source']).is_file():
                raise ValueError('capture is incomplete; resubmit the source to resume capture')
            with processing_budget():
                complete_capture(job, None)
            return
        with database() as cursor:
            if (job is None or not (job['request'] or {}).get('recoverable') or job['state'] != 'failed'
                    or job['error'] in ('DeliveryInvalid', 'DeliveryChecksumMismatch', 'CaptureInterrupted')):
                raise ValueError('only failed recoverable processing jobs can be retried; redeliver invalid sources')
            cursor.execute("UPDATE app.jobs SET state='discovered',attempts=0,error=NULL,retry_at=NULL,retryable=true,"
                           'history=history || %s WHERE id=%s',
                           (json.dumps([{'state': 'discovered', 'operator_retry': True}]), identifier))


def captured_prefix(partial: Path, original: Path) -> bool:
    """Only discard a fragment whose exact bytes remain in a managed original."""
    if partial.stat().st_size > original.stat().st_size:
        return False
    with partial.open('rb') as fragment, original.open('rb') as complete:
        while chunk := fragment.read(1024**2):
            if complete.read(len(chunk)) != chunk:
                return False
    return True


def collect(*, apply: bool = False) -> dict:
    """Collect whole unreferenced attempts under the same writer lock, never sources.

    Published revision manifests root the graph, including all immutable readers.
    GeoServer workspaces are removed first; failed removals keep the directory.
    """
    from publication import geoserver
    from publication.revisions import load_revision
    with database() as guard:
        if not lock(guard):
            raise RuntimeError('worker busy; retry collection')
        with database() as cursor:
            cursor.execute('SELECT manifest_path,manifest_sha256 FROM app.revisions')
            rows = cursor.fetchall()
            cursor.execute('SELECT manifest_path FROM app.catalogue')
            roots = [row['manifest_path'] for row in cursor.fetchall()]
            cursor.execute('SELECT id,state,stage,error,retryable,managed_source,checksum FROM app.jobs')
            jobs = cursor.fetchall()
        for row in rows:
            value = load_revision(row['manifest_path'], row['manifest_sha256'])
            roots.append(row['manifest_path'])
            roots.extend(entry['manifest_path'] for entry in value['batches'])
        retained = [Path(relative).parts for relative in roots]
        candidates = []
        removed = []
        for job in jobs:
            directory = ROOT / str(job['id'])
            original = ROOT / job['managed_source'] if job['managed_source'] else None
            if (original is not None and original.is_file()
                    and bounded_checksum(original, MAX_SOURCE_BYTES + 1) == job['checksum']):
                for partial in sorted(directory.glob('capture-*.grib2')):
                    if (not partial.is_symlink() and re.fullmatch(r'capture-[0-9a-f]{32}\.grib2', partial.name)
                            and captured_prefix(partial, original)):
                        candidates.append(partial.relative_to(ROOT).as_posix())
                        if apply:
                            partial.unlink()
                            removed.append(partial.relative_to(ROOT).as_posix())
            for attempt in sorted(directory.iterdir()) if directory.exists() else []:
                if not attempt.is_dir() or attempt.is_symlink():
                    continue
                # Only UUID-named worker attempts qualify; original.grib2 stays.
                try:
                    uuid.UUID(hex=attempt.name)
                except ValueError:
                    continue
                references = [parts for parts in retained if parts[:2] == (directory.name, attempt.name)]
                targets = [attempt]
                if references:
                    # T4 has a manifest directly in its attempt. T5/T6 can have
                    # both committed hours and abandoned hours in one attempt.
                    if any(len(parts) < 4 for parts in references):
                        continue
                    targets = [child for child in sorted(attempt.iterdir()) if child.is_dir()
                               and not child.is_symlink() and child.name.startswith('hour-')
                               and not any(parts[2] == child.name for parts in references)]
                for target in targets:
                    target.resolve().relative_to(ROOT.resolve())
                    candidates.append(target.relative_to(ROOT).as_posix())
                    if apply:
                        for record in target.rglob('workspace.json'):
                            geoserver.discard_staging(json.loads(record.read_bytes())['workspace'])
                        shutil.rmtree(target)
                        removed.append(target.relative_to(ROOT).as_posix())
        return {'managed_bytes': storage_bytes(), 'budget_bytes': MAX_STORAGE_BYTES,
                'candidates': candidates, 'removed': removed, 'apply': apply,
                'jobs': [{**job, 'id': str(job['id'])} for job in jobs],
                'originals': 'retained; source mounts never collected'}
