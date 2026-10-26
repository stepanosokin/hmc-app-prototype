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
from publication import recovery

PIPELINE = 't5.1'


def fixture_run(fixture: str) -> str:
    return 'SYNTHETIC-ICON-EU/2026-10-15T01:00:00Z' if fixture == 'overlap' else RUN


def source_run(request: dict, metadata: dict, fixture: str) -> str:
    if request.get('source_profile') not in ('surface-temperature-grib2','grib2-fields') or fixture != 'actual':
        return fixture_run(fixture)
    return request.get('model',metadata['model'])+'/'+metadata['reference_time']


def migrate() -> None:
    """Add T5 records without modifying any historical publication or asset."""
    with database() as cursor:
        cursor.execute('ALTER TABLE app.jobs ADD COLUMN IF NOT EXISTS request jsonb')
        cursor.execute('CREATE TABLE IF NOT EXISTS app.revisions ('
                       'revision text PRIMARY KEY, run text NOT NULL, manifest_path text NOT NULL, '
                       'manifest_sha256 text NOT NULL, published_at timestamptz NOT NULL, '
                       'job_id uuid NOT NULL REFERENCES app.jobs)')
        cursor.execute('GRANT SELECT ON app.revisions TO hmc_api')


def normalize(source: Path, target: Path, hour: int, frame: bytes, fixture: str,
              processing_version: str = PIPELINE, job: dict | None = None) -> ManifestSampler:
    """Validate one bounded actual message, with explicit synthetic supplements."""
    target.mkdir()
    if job is not None:
        recovery.stage(job, 'normalization')
    request = (job or {}).get('request', {})
    metadata = field_metadata(frame,hour,request.get('crs_configuration'),
                              sample_inventory=not request.get('source_profile'),
                              all_fields=request.get('source_profile')=='grib2-fields')
    values, missing = decoded_arrays(frame, metadata['grid']['shape_yx'])
    run = source_run(request,metadata,fixture)
    model = request.get('model',metadata['model']) if request.get('source_profile') else 'ICON-EU'
    metadata['model'] = model
    if fixture != 'actual':
        metadata['synthetic_fixture'] = fixture
        if fixture == 'correction':
            values = values + 1.0
            metadata['synthetic_correction_K'] = 1.0
            metadata['original_values_metadata'] = metadata.pop('values')
            for cell in metadata['grid']['cell_centres']:
                cell['value'] += 1.0
    item = write_field(target, f'hour-{hour:02d}', metadata, values, missing)
    if job is not None:
        recovery.checkpoint(job, 'normalization')
    check = check_field(target, item, values, missing)
    write_once(target / 'validation.json', check)
    inventory = {path.relative_to(target).as_posix(): {'bytes': path.stat().st_size, 'sha256': file_hash(path)}
                 for path in sorted(target.rglob('*')) if path.is_file()}
    body = {'schema_version': 1, 'pipeline_version': STORAGE_PIPELINE, 'state': 'validated-test',
            'run': run, 'model': model, 'member': None, 'synthetic_nodata': False,
            'fixture': request.get('fixture_label',fixture), 'source': {'name': job['source_name'] if job else source.name, 'sha256': file_hash(source),
                                         'message_sha256': hashlib.sha256(frame).hexdigest(),
                                         'processing_version': processing_version,
                                         'synthetic_fixture': request.get('fixture_label') or (None if fixture == 'actual' else fixture),
                                         'source_crs': metadata['source_crs']},
            'tools': versions(), 'fields': [item], 'assets': inventory}
    if metadata.get('field_profile'):
        descriptor = metadata['raw_identity']
        body['source'].update(field_profile=metadata['field_profile'], field_descriptor={
            'id':item['field'], 'units':metadata['identity']['units'],
            'label':f'Поле GRIB {descriptor["discipline"]}.{descriptor["parameterCategory"]}.{descriptor["parameterNumber"]}',
            'level_type':metadata['identity']['typeOfLevel'], 'level':metadata['identity']['level'],
            'short_name':metadata['identity']['shortName'],
            'display_blocks':((metadata['grid']['shape_yx'][0]+255)//256)*((metadata['grid']['shape_yx'][1]+255)//256),
            'raw_identity':metadata['field_identity'], 'interval':metadata['interval']})
        if 'uv_relative_to_grid' in metadata['identity']:
            pair={key:value for key,value in metadata['field_identity'].items() if key!='parameterNumber'}
            body['source']['field_descriptor'].update(wind_axis='u' if descriptor['parameterNumber']==2 else 'v',
                wind_pair=hashlib.sha256(canonical(pair)).hexdigest(),
                uv_relative_to_grid=metadata['identity']['uv_relative_to_grid'])
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
            'revision_times': sorted({item['valid_time'] for item in revision['batches']
                                      if item.get('field','T_G:surface:0')==identity['field']}),
            'fixture': batch.get('fixture', 'actual')}


def commit_revision(job: dict, directory: Path, run: str, base: dict | None, entries: dict,
                    key: str, hour: int, source: Path, checksum: str) -> str:
    """Expose a fully validated immutable manifest with one database commit."""
    identifier = str(job['id'])
    body = {'schema_version': 2, 'pipeline_version': PIPELINE, 'run': run,
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
    if file_hash(source) != checksum:
        raise ValueError('source changed during publication')
    recovery.checkpoint(job, 'publication')
    with database() as cursor:
        cursor.execute('INSERT INTO app.revisions VALUES(%s,%s,%s,%s,clock_timestamp(),%s)',
                       (revision, body['run'], manifest_relative, revision_checksum, identifier))
        cursor.execute('UPDATE app.jobs SET selection=%s, manifest_path=%s, manifest_sha256=%s WHERE id=%s',
                       (revision + '.' + key, manifest_relative, revision_checksum, identifier))
        from publication.retention import register
        register(cursor, revision, loaded, manifest_relative)
    recovery.checkpoint(job, 'committed')
    return revision


def process(job: dict) -> None:
    # The queue advisory lock serializes publication, so late batches merge with
    # the last committed revision rather than a stale base captured at submission.
    from publication.worker import transition, publish_batch
    identifier = str(job['id'])
    request = job['request']
    if request.get('source_profile')=='grib2-fields':
        transition(identifier,job['state'],processing_started=True)
    recoverable = bool(request.get('recoverable'))
    source = recovery.source(job) if recoverable else Path('/input') / job['source_name']
    checksum = job['checksum'] if request.get('source_profile') else SAMPLE_SHA256
    if file_hash(source) != checksum:
        raise ValueError('actual sample checksum mismatch')
    attempt = ROOT / identifier / uuid.uuid4().hex
    attempt.mkdir(parents=True)
    staged = source if recoverable else attempt / source.name
    if not recoverable:
        shutil.copyfile(source, staged)
    if file_hash(staged) != checksum:
        raise ValueError('staging checksum mismatch')
    staged.chmod(0o444)
    with database() as cursor:
        cursor.execute('UPDATE app.jobs SET checksum=%s WHERE id=%s', (checksum, identifier))
    transition(identifier, 'staged', source_sha256=checksum)
    hours = set(request['hours'])
    published = 0
    pending: dict = {}
    for hour, frame in enumerate(bounded_frames(staged), 1):
        if hour not in hours:
            continue
        metadata = field_metadata(frame,hour,request.get('crs_configuration'),
                                  sample_inventory=not request.get('source_profile'),
                                  all_fields=request.get('source_profile')=='grib2-fields')
        run = source_run(request,metadata,request['fixture'])
        base = latest(run)
        # A repeated delivery of the same validated message reuses the batch;
        # no new Zarr/COG, GIS workspace, or publication revision is required.
        if base and not os.environ.get('T4_TEST_FAILURE'):
            matching = [entry for entry in base['batches'] if entry['valid_time'] == metadata['valid_time']]
            for entry in matching:
                existing = selected(base, entry)
                if (existing['source'].get('message_sha256') == hashlib.sha256(frame).hexdigest()
                        and existing['source'].get('processing_version', PIPELINE) == job['pipeline_version']
                        and existing['source'].get('source_crs') == metadata['source_crs']
                        and existing.get('fixture', 'actual') == request['fixture']
                        and not request.get('rebuild')):
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
        numerical = normalize(staged, directory / 'numerical', hour, frame, request['fixture'], job['pipeline_version'], job)
        metadata = numerical.manifest['fields'][0]['metadata']
        transition(identifier, 'decoded', hour=hour)
        transition(identifier, 'normalized', hour=hour)
        batch, relative, batch_checksum = publish_batch(job, directory, numerical, commit=False)
        base = latest(numerical.manifest['run'])
        key = batch_key(batch['identity'])
        previous = dict(pending) if pending else {entry['key']:entry for entry in base['batches']} if base else {}
        entries = {entry['key']: entry for entry in previous.values()
                   if not (entry['valid_time']==batch['identity']['valid_time']
                           and entry.get('field','T_G:surface:0')==batch['identity']['field'])}
        entries[key] = {'key': key, 'valid_time': batch['identity']['valid_time'],
                        'field':batch['identity']['field'],
                        'manifest_path': relative, 'manifest_sha256': batch_checksum}
        from publication.catalogue import discovery
        entries[key]['discovery']=discovery(batch)
        if request.get('source_profile')=='grib2-fields':
            pending=entries
            published+=1
            transition(identifier,'validated',prepared_fields=published)
            continue
        revision = commit_revision(job, directory, numerical.manifest['run'], base, entries, key, hour, source, checksum)
        published += 1
        transition(identifier, 'validated', revision=revision, published_times=published)
    if published != len(hours):
        raise ValueError('requested source times unavailable')
    if pending:
        revision = commit_revision(job, directory, run, latest(run), pending, key, hour, source, checksum)
        transition(identifier, 'validated', revision=revision, published_times=published)
    transition(identifier, 'published', published_times=published)
    if recoverable:
        with database() as cursor:
            cursor.execute('UPDATE app.jobs SET retryable=false,error=NULL,stage=%s WHERE id=%s', ('published', identifier))
