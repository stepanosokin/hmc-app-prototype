"""Incremental immutable time batches and small run-revision manifests.

Only the worker writes these records. All readers resolve a retained revision,
then an exact compatible field/time/grid/level/member key within that manifest.
"""

import hashlib
import json
import os
import shutil
import uuid
from pathlib import Path

from decoder.inspect_forecast import SAMPLE_SHA256
from decoder.sampling import ManifestSampler, canonical, file_hash
from decoder.storage import (RUN, PIPELINE as STORAGE_PIPELINE, bounded_frames,
                             field_metadata, decoded_arrays, write_field, check_field, versions)
from publication.domain import ROOT, database, write_once, load_manifest

PIPELINE = 't5.1'


def fixture_run(fixture: str) -> str:
    return 'SYNTHETIC-ICON-EU/2026-10-15T01:00:00Z' if fixture == 'overlap' else RUN


def migrate() -> None:
    """Add T5 records without modifying any historical publication or asset."""
    with database() as cursor:
        cursor.execute('ALTER TABLE app.jobs ADD COLUMN IF NOT EXISTS request jsonb')
        cursor.execute('CREATE TABLE IF NOT EXISTS app.revisions ('
                       'revision text PRIMARY KEY, run text NOT NULL, manifest_path text NOT NULL, '
                       'manifest_sha256 text NOT NULL, published_at timestamptz NOT NULL, '
                       'job_id uuid NOT NULL REFERENCES app.jobs)')
        cursor.execute('GRANT SELECT ON app.revisions TO hmc_api')


def normalize(source: Path, target: Path, hour: int, frame: bytes, fixture: str) -> ManifestSampler:
    """Validate one bounded actual message, with explicit synthetic supplements."""
    target.mkdir()
    metadata = field_metadata(frame, hour)
    values, missing = decoded_arrays(frame, metadata['grid']['shape_yx'])
    run = fixture_run(fixture)
    if fixture != 'actual':
        metadata['synthetic_fixture'] = fixture
        if fixture == 'correction':
            values = values + 1.0
            metadata['synthetic_correction_K'] = 1.0
            metadata['original_values_metadata'] = metadata.pop('values')
            for cell in metadata['grid']['cell_centres']:
                cell['value'] += 1.0
    item = write_field(target, f'hour-{hour:02d}', metadata, values, missing)
    check = check_field(target, item, values, missing)
    write_once(target / 'validation.json', check)
    inventory = {path.relative_to(target).as_posix(): {'bytes': path.stat().st_size, 'sha256': file_hash(path)}
                 for path in sorted(target.rglob('*')) if path.is_file()}
    body = {'schema_version': 1, 'pipeline_version': STORAGE_PIPELINE, 'state': 'validated-test',
            'run': run, 'model': 'ICON-EU', 'member': None, 'synthetic_nodata': False,
            'fixture': fixture, 'source': {'name': source.name, 'sha256': SAMPLE_SHA256,
                                         'message_sha256': hashlib.sha256(frame).hexdigest(),
                                         'synthetic_fixture': None if fixture == 'actual' else fixture},
            'tools': versions(), 'fields': [item], 'assets': inventory}
    revision = hashlib.sha256(canonical(body)).hexdigest()
    write_once(target / 'manifest.json', {**body, 'revision': revision})
    for path in target.rglob('*'):
        if path.is_file():
            path.chmod(0o444)
    numerical = ManifestSampler(target / 'manifest.json')
    for cell in metadata['grid']['cell_centres']:
        result = numerical.sample(run=run, revision=revision, field=item['field'],
                                  valid_time=metadata['valid_time'], lon=cell['lon'], lat=cell['lat'])
        if result['value'] != cell['value']:
            raise ValueError('batch native sampling differs from decoded source')
    return numerical


def batch_key(identity: dict) -> str:
    keys = ('field', 'level', 'valid_time', 'native_grid_sha256', 'member')
    return hashlib.sha256(canonical({key: identity[key] for key in keys})).hexdigest()


def latest(run: str) -> dict | None:
    with database() as cursor:
        cursor.execute('SELECT manifest_path,manifest_sha256 FROM app.revisions WHERE run=%s '
                       'ORDER BY published_at DESC, revision DESC LIMIT 1', (run,))
        row = cursor.fetchone()
    return None if row is None else load_revision(row['manifest_path'], row['manifest_sha256'])


def load_revision(relative: str, checksum: str) -> dict:
    from decoder.sampling import asset_path
    path = asset_path(ROOT, relative)
    if file_hash(path) != checksum:
        raise ValueError('revision manifest integrity failed')
    value = json.loads(path.read_bytes())
    body = dict(value)
    revision = body.pop('revision')
    if (hashlib.sha256(canonical(body)).hexdigest() != revision or body['pipeline_version'] != PIPELINE
            or len({entry['key'] for entry in body['batches']}) != len(body['batches'])):
        raise ValueError('invalid revision manifest')
    return value


def selected(revision: dict, entry: dict) -> dict:
    batch = load_manifest(entry['manifest_path'], entry['manifest_sha256'])
    if batch_key(batch['identity']) != entry['key'] or batch['identity']['run'] != revision['run']:
        raise ValueError('revision batch identity mismatch')
    identity = {**batch['identity'], 'revision': revision['revision']}
    return {**batch, 'identity': identity, 'selection': revision['revision'] + '.' + entry['key'],
            'batch_selection': batch['selection'], 'completeness': revision['completeness'],
            'revision_times': sorted({item['valid_time'] for item in revision['batches']}),
            'fixture': batch.get('fixture', 'actual')}


def process(job: dict) -> None:
    # The queue advisory lock serializes publication, so late batches merge with
    # the last committed revision rather than a stale base captured at submission.
    from publication.worker import transition, publish_batch
    identifier = str(job['id'])
    request = job['request']
    source = Path('/input') / job['source_name']
    if file_hash(source) != SAMPLE_SHA256:
        raise ValueError('actual sample checksum mismatch')
    attempt = ROOT / identifier / uuid.uuid4().hex
    attempt.mkdir(parents=True)
    staged = attempt / source.name
    shutil.copyfile(source, staged)
    if file_hash(staged) != SAMPLE_SHA256:
        raise ValueError('staging checksum mismatch')
    staged.chmod(0o444)
    with database() as cursor:
        cursor.execute('UPDATE app.jobs SET checksum=%s WHERE id=%s', (SAMPLE_SHA256, identifier))
    transition(identifier, 'staged', source_sha256=SAMPLE_SHA256)
    hours = set(request['hours'])
    published = 0
    for hour, frame in enumerate(bounded_frames(staged), 1):
        if hour not in hours:
            continue
        run = fixture_run(request['fixture'])
        base = latest(run)
        # A repeated delivery of the same validated message reuses the batch;
        # no new Zarr/COG, GIS workspace, or publication revision is required.
        if base and not os.environ.get('T4_TEST_FAILURE'):
            metadata = field_metadata(frame, hour)
            matching = [entry for entry in base['batches'] if entry['valid_time'] == metadata['valid_time']]
            for entry in matching:
                existing = selected(base, entry)
                if (existing['source'].get('message_sha256') == hashlib.sha256(frame).hexdigest()
                        and existing.get('fixture', 'actual') == request['fixture']):
                    with database() as cursor:
                        cursor.execute('UPDATE app.jobs SET selection=%s WHERE id=%s', (existing['selection'], identifier))
                    published += 1
                    break
            else:
                matching = []
            if matching:
                continue
        directory = attempt / f'hour-{hour:02d}'
        directory.mkdir()
        numerical = normalize(staged, directory / 'numerical', hour, frame, request['fixture'])
        transition(identifier, 'decoded', hour=hour)
        transition(identifier, 'normalized', hour=hour)
        batch, relative, checksum = publish_batch(job, directory, numerical, commit=False)
        base = latest(numerical.manifest['run'])
        key = batch_key(batch['identity'])
        entries = {entry['key']: entry for entry in base['batches']} if base else {}
        entries[key] = {'key': key, 'valid_time': batch['identity']['valid_time'],
                        'manifest_path': relative, 'manifest_sha256': checksum}
        body = {'schema_version': 2, 'pipeline_version': PIPELINE, 'run': numerical.manifest['run'],
                'parent': base['revision'] if base else None, 'job': identifier, 'hour': hour,
                'clock': job['submitted_at'].isoformat(), 'completeness': 'unknown',
                'batches': sorted(entries.values(), key=lambda entry: entry['key'])}
        revision = hashlib.sha256(canonical(body)).hexdigest()
        manifest = directory / 'revision.json'
        revision_checksum = write_once(manifest, {**body, 'revision': revision})
        manifest_relative = manifest.relative_to(ROOT).as_posix()
        loaded = load_revision(manifest_relative, revision_checksum)
        # Recheck every referenced batch before making this revision eligible.
        for entry in loaded['batches']:
            selected(loaded, entry)
        if file_hash(source) != SAMPLE_SHA256:
            raise ValueError('source changed during publication')
        with database() as cursor:
            cursor.execute('INSERT INTO app.revisions VALUES(%s,%s,%s,%s,clock_timestamp(),%s)',
                           (revision, body['run'], manifest_relative, revision_checksum, identifier))
            cursor.execute('UPDATE app.jobs SET selection=%s, manifest_path=%s, manifest_sha256=%s WHERE id=%s',
                           (revision + '.' + key, manifest_relative, revision_checksum, identifier))
        published += 1
        transition(identifier, 'validated', revision=revision, published_times=published)
    if published != len(hours):
        raise ValueError('requested source times unavailable')
    transition(identifier, 'published', published_times=published)
