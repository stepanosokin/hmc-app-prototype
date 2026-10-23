"""Durable one-sample job CLI and worker. Immutable attempts survive failures."""

import argparse
import hashlib
import json
import os
import shutil
import time
import uuid
from datetime import datetime
from pathlib import Path

from decoder.inspect_forecast import SAMPLE_SHA256
from decoder.sampling import ManifestSampler, canonical, file_hash
from decoder.storage import build, bounded_frames, field_metadata, decoded_arrays
from publication.domain import ROOT, PIPELINE, database, write_once, load_manifest
from publication import geoserver
from publication import recovery
from publication.tiles import CONTRACT, CONTRACT_PATH, render, encode, decode


def transition(job: str, state: str, **extra) -> None:
    entry = {'state': state, 'observed_at': datetime.now().astimezone().isoformat(), **extra}
    with database() as cursor:
        cursor.execute('UPDATE app.jobs SET state=%s, history=history || %s WHERE id=%s',
                       (state, json.dumps([entry]), job))


def submit(clock: str, request: dict | None = None) -> str:
    if not clock.endswith('Z'):
        raise ValueError('explicit UTC demo clock required')
    datetime.fromisoformat(clock.replace('Z', '+00:00'))
    job = str(uuid.uuid4())
    if request is not None:
        from decoder.source_crs import resolve
        request = {**request, 'source_crs': resolve()}
        from publication.revisions import migrate
        migrate()
    with database() as cursor:
        cursor.execute('INSERT INTO app.jobs(id,submitted_at,source_name,pipeline_version,state,history) '
                       'VALUES(%s,%s,%s,%s,%s,%s)',
                       (job, clock, 'ICON_EU_T_G_2026101500.grib2', PIPELINE if request is None else 't5.1', 'discovered',
                        json.dumps([{'state': 'discovered', 'clock': clock}])))
        if request is not None:
            cursor.execute('UPDATE app.jobs SET request=%s WHERE id=%s', (json.dumps(request), job))
    return job


def process(job: dict) -> None:
    if job.get('request') is not None:
        from publication.revisions import process as incremental
        incremental(job)
        return
    identifier = str(job['id'])
    # A restart creates a new immutable attempt; no old bytes are overwritten.
    attempt = ROOT / identifier / uuid.uuid4().hex
    attempt.mkdir(parents=True)
    source = Path('/input') / job['source_name']
    if file_hash(source) != SAMPLE_SHA256:
        raise ValueError('actual sample checksum mismatch')
    staged = attempt / source.name
    shutil.copyfile(source, staged)
    if file_hash(staged) != SAMPLE_SHA256:
        raise ValueError('staging checksum mismatch')
    staged.chmod(0o444)
    with database() as cursor:
        cursor.execute('UPDATE app.jobs SET checksum=%s WHERE id=%s', (SAMPLE_SHA256, identifier))
    transition(identifier, 'staged', source_sha256=SAMPLE_SHA256)
    messages = 0
    for messages, frame in enumerate(bounded_frames(staged), 1):
        metadata = field_metadata(frame, messages)
        decoded_arrays(frame, metadata['grid']['shape_yx'])
    if messages != 24:
        raise ValueError('incomplete actual sample')
    transition(identifier, 'decoded', messages=messages)
    # T2 validates every message and derivative before its own immutable manifest.
    report = build(staged, attempt / 'numerical', job['submitted_at'].isoformat().replace('+00:00', 'Z'), legacy_source_crs=True)
    transition(identifier, 'normalized', zarr_max_abs_error_K=report['zarr_max_abs_error'])
    numerical = ManifestSampler(attempt / 'numerical/manifest.json')
    publish_batch(job, attempt, numerical, commit=True)


def publish_batch(job: dict, attempt: Path, numerical: ManifestSampler, *, commit: bool) -> tuple[dict, str, str]:
    """Gate one immutable compatible batch through numeric and real GIS readiness."""
    identifier = str(job['id'])
    item = numerical.manifest['fields'][0]
    failure = os.environ.get('T4_TEST_FAILURE')
    if os.environ.get('T5_FAIL_HOUR') not in (None, str(item['metadata']['message'])):
        failure = None
    selection_body = {key: numerical.manifest[key] for key in ['model', 'run', 'member']}
    selection_body.update(revision=numerical.revision, field=item['field'], level=0,
                          valid_time=item['metadata']['valid_time'],
                          native_grid_sha256=item['metadata']['native_grid_sha256'],
                          publication_job=identifier, contract=CONTRACT['contract'])
    selection_body.update(matrix=CONTRACT['matrix'], resampling='bilinear', encoding_version=CONTRACT['contract'] + '/f32',
                          engine='project-bilinear/1')
    from decoder.source_crs import LEGACY_ID, identifier as crs_identifier
    corrected = crs_identifier(item['metadata']) != LEGACY_ID
    if corrected:
        selection_body.update(contract='hmc-temperature-tile/3', encoding_version='hmc-temperature-tile/3/f32')
    selection = hashlib.sha256(canonical(selection_body)).hexdigest()
    # The engine is selected only by a retained successful comparison report.
    decision = json.loads(Path('/evidence/selection.json').read_bytes())
    if decision.get('status') != 'selected' or decision.get('contract_sha256') != file_hash(CONTRACT_PATH):
        raise ValueError('no successful comparison for frozen tile contract')
    if decision['engine'] != 'project-bilinear/1' or decision['encoding'] != 'f32':
        raise ValueError('unsupported selected engine')
    for name, checksum in decision['evidence_sha256'].items():
        if file_hash(Path('/evidence') / name) != checksum:
            raise ValueError('comparison evidence changed after selection')
    write_once(attempt / 'engine-selection.json', decision)
    tile_metadata = {**CONTRACT, 'selected_encoding': decision['encoding'], 'engine': decision['engine'],
                     'selection': selection, 'identity': selection_body,
                     'url': CONTRACT['url_template'].replace('{selection}', selection).replace('{encoding}', decision['encoding'])}
    if corrected:
        amendment = json.loads(Path(__file__).with_name('contract.v3.json').read_bytes())
        tile_metadata.update(amendment, source_crs=item['metadata']['source_crs'])
        tile_metadata['bilinear'] = {**CONTRACT['bilinear'], 'projection': amendment['crs_binding'],
            'datum_limit': 'Owner-approved zero geocentric shift prototype hypothesis, 2026-10-23; no producer control point'}
        tile_metadata['url'] = amendment['url_template'].replace('{selection}', selection).replace('{encoding}', decision['encoding'])
    write_once(attempt / 'tiles.json', tile_metadata)
    recovery.stage(job, 'tiles')
    tile_checks = []
    for z, x, y in CONTRACT['readiness']['representatives']:
        values, valid = render(numerical.root, item, z, x, y)
        payload = encode(values, valid, 'f32')
        if encode(*render(numerical.root, item, z, x, y), 'f32') != payload:
            raise ValueError('non-deterministic representative tile')
        restored, restored_mask = decode(payload, 'f32')
        import numpy as np
        if not np.array_equal(restored_mask, valid) or np.max(np.abs(restored-values)) > 0.001:
            raise ValueError('representative numeric readiness failed')
        tile_path = attempt / f'{z}-{x}-{y}.f32'
        tile_path.write_bytes(payload)
        recovery.checkpoint(job, 'tiles')
        tile_path.chmod(0o444)
        tile_checks.append({'zxy': [z, x, y], 'sha256': file_hash(tile_path)})
    if failure == 'tiles':
        # Explicit failure injection: real durable metadata is absent at readiness.
        (attempt / 'tiles.json').unlink()
    if not (attempt / 'tiles.json').is_file():
        raise ValueError('durable numeric metadata missing')
    mosaic = attempt / 'mosaic'
    recovery.stage(job, 'derivatives')
    mosaic.mkdir()
    stamp = datetime.fromisoformat(item['metadata']['valid_time'].replace('Z', '+00:00')).strftime('%Y%m%dT%H%M%S')
    cog_path = mosaic / f'temperature_{stamp}.tif'
    # Same filesystem/immutable inode: do not copy the batch COG into each GIS index.
    os.link(numerical.root / item['cog'], cog_path)
    recovery.checkpoint(job, 'derivatives')
    workspace = 'p' + hashlib.sha256(attempt.relative_to(ROOT).as_posix().encode()).hexdigest()[:24]
    index_name = 'g' + workspace[1:]
    (mosaic / 'datastore.properties').write_text('\n'.join([
        'SPI=org.geotools.data.postgis.PostgisNGDataStoreFactory', 'host=db', 'port=5432',
        'database=hmc', 'schema=' + ('nonexistent' if failure == 'index' else 'mosaic'), 'user=hmc_mosaic',
        'passwd=' + os.environ['MOSAIC_PASSWORD'], 'Loose bbox=true', 'preparedStatements=true']))
    (mosaic / 'indexer.properties').write_text('TimeAttribute=time\nMosaicCRS=EPSG:100001\nName=' + index_name + '\nTypeName=' + index_name + '\nSchema=*the_geom:Polygon,location:String,time:java.util.Date\nPropertyCollectors=TimestampFileNameExtractorSPI[timeregex](time)\n')
    (mosaic / 'timeregex.properties').write_text('regex=[0-9]{8}T[0-9]{6}\nformat=yyyyMMdd\'T\'HHmmss\n')
    # An interrupted index may already exist. Every attempt owns its workspace;
    # only the manifest-selected one becomes reachable through the gateway.
    write_once(attempt / 'workspace.json', {'workspace': workspace})
    recovery.stage(job, 'indexing')
    gis = geoserver.prepare(workspace, str(mosaic), item['metadata']['valid_time'])
    recovery.checkpoint(job, 'indexing')
    point = numerical.sample(run=numerical.manifest['run'], revision=numerical.revision,
                             field=item['field'], valid_time=item['metadata']['valid_time'], lon=20.,lat=50.)
    gis['probe'] = {'lon':point['cell']['lon'],'lat':point['cell']['lat'],'value':point['value']}
    if 'gis_derivative' in item:
        gis['source_crs'] = item['metadata']['source_crs']
        gis['derivative'] = item['gis_derivative']
    transition(identifier, 'derivatives_ready', representative_tiles=tile_checks)
    recovery.checkpoint(job, 'readiness')
    gis_checks = geoserver.verify(gis)
    cog_path.chmod(0o444)
    # Administrative mutable mosaic metadata is outside the immutable asset inventory.
    inventory = {}
    for path in sorted(attempt.rglob('*')):
        if path.is_file() and ('mosaic' not in path.relative_to(attempt).parts or path.suffix == '.tif'):
            inventory[path.relative_to(ROOT).as_posix()] = {'bytes': path.stat().st_size, 'sha256': file_hash(path)}
            with path.open('rb') as stream:
                os.fsync(stream.fileno())
    body = {'schema_version': 1, 'pipeline_version': PIPELINE, 'selection': selection,
            'identity': selection_body, 'numerical_manifest': (numerical.root / 'manifest.json').relative_to(ROOT).as_posix(),
            'tile_metadata': (attempt / 'tiles.json').relative_to(ROOT).as_posix(),
            'tile_engine': decision['engine'], 'encoding': decision['encoding'],
            'gis': gis, 'gis_checks': gis_checks, 'tile_checks': tile_checks,
            'source': numerical.manifest['source'], 'assets': inventory}
    body['fixture'] = numerical.manifest.get('fixture', 'actual')
    manifest_path = attempt / 'publication.json'
    recovery.stage(job, 'metadata')
    checksum = write_once(manifest_path, body)
    recovery.checkpoint(job, 'metadata')
    parents = [attempt, *list(attempt.parents)[:len(attempt.relative_to(ROOT).parts)]]
    for directory in [path for path in attempt.rglob('*') if path.is_dir()] + parents:
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    relative = manifest_path.relative_to(ROOT).as_posix()
    load_manifest(relative, checksum)
    transition(identifier, 'validated', manifest_path=relative, manifest_sha256=checksum, gis=gis_checks)
    # Re-read discovery immediately before the only catalogue visibility switch.
    geoserver.verify(gis)
    if commit:
        with database() as cursor:
            cursor.execute('INSERT INTO app.catalogue VALUES(%s,%s,%s,%s,%s)',
                           (selection, identifier, relative, checksum, job['submitted_at']))
            from publication.retention import register
            register(cursor, selection, body, relative)
            cursor.execute('UPDATE app.jobs SET state=%s, selection=%s, manifest_path=%s, manifest_sha256=%s, '
                           'history=history || %s WHERE id=%s',
                           ('published', selection, relative, checksum, json.dumps([{'state': 'published'}]), identifier))
    return body, relative, checksum


def once() -> bool:
    with database() as lock:
        lock.execute('SELECT pg_try_advisory_lock(16001) AS acquired')
        if not lock.fetchone()['acquired']:
            return False
        with database() as cursor:
            cursor.execute("SELECT * FROM app.jobs WHERE state NOT IN ('published','failed') "
                           "OR (retryable AND state='failed' AND retry_at <= clock_timestamp()) "
                           'ORDER BY submitted_at,id LIMIT 1')
            job = cursor.fetchone()
        if job is None:
            return False
        recoverable = bool((job.get('request') or {}).get('recoverable'))
        if recoverable:
            if job['attempts'] >= recovery.MAX_ATTEMPTS:
                recovery.failed(job, RuntimeError('worker interrupted; attempt budget exhausted'))
                return True
            with database() as cursor:
                cursor.execute('UPDATE app.jobs SET attempts=attempts+1,error=NULL,retryable=true,retry_at=NULL '
                               "WHERE id=%s RETURNING attempts", (str(job['id']),))
                job['attempts'] = cursor.fetchone()['attempts']
        try:
            if recoverable:
                with recovery.processing_budget():
                    process(job)
            else:
                process(job)
        except Exception as error:
            if recoverable:
                recovery.failed(job, error)
                print(json.dumps({'job': str(job['id']), 'state': 'failed', 'error_type': type(error).__name__}), flush=True)
                raise
            transition(str(job['id']), 'failed', error_type=type(error).__name__)
            with database() as cursor:
                # Exceptions may contain private URLs/configuration; expose the class only.
                cursor.execute('UPDATE app.jobs SET error=%s WHERE id=%s', (type(error).__name__, job['id']))
            print(json.dumps({'job': str(job['id']), 'state': 'failed', 'error': str(error)}), flush=True)
            raise
        return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['submit', 'once', 'run', 'collect', 'retry'])
    parser.add_argument('--clock')
    parser.add_argument('--hours', default=','.join(map(str, range(1, 25))),
                        help='Validated source hours to ingest; default all 24 actual sample times')
    parser.add_argument('--fixture', choices=['actual', 'correction', 'overlap'], default='actual',
                        help='Synthetic supplements are explicitly labelled; actual is unchanged producer input')
    parser.add_argument('--legacy-one-time', action='store_true', help='Reproduce archived T4 one-time workflow')
    parser.add_argument('--migrate', action='store_true', help='Apply additive T5 schema before consuming existing volumes')
    parser.add_argument('--recoverable', action='store_true', help='Use T6 durable source capture and bounded retries')
    parser.add_argument('--source-name', default='ICON_EU_T_G_2026101500.grib2')
    parser.add_argument('--delivery-sha256', help='Checksum from producer completion manifest/atomic delivery signal')
    parser.add_argument('--stability-seconds', type=float, default=2)
    parser.add_argument('--apply', action='store_true', help='Apply collect; default is dry-run')
    parser.add_argument('--job', type=uuid.UUID, help='Failed recoverable job to explicitly retry after repair')
    args = parser.parse_args()
    if args.command == 'submit':
        if not args.clock:
            parser.error('--clock required')
        try:
            hours = [int(value) for value in args.hours.split(',')]
            if not hours or len(set(hours)) != len(hours) or any(not 1 <= hour <= 24 for hour in hours):
                raise ValueError()
        except ValueError:
            parser.error('--hours must be unique sample hours in 1..24')
        if args.recoverable:
            if args.legacy_one_time:
                parser.error('--recoverable cannot use the archived one-time pipeline')
            if not args.clock.endswith('Z'):
                parser.error('explicit UTC demo clock required')
            datetime.fromisoformat(args.clock.replace('Z', '+00:00'))
            from decoder.source_crs import resolve
            print(recovery.submit(args.clock, {'hours': sorted(hours), 'fixture': args.fixture, 'recoverable': True,
                                              'source_crs': resolve()},
                                  args.source_name, args.delivery_sha256, args.stability_seconds))
        else:
            print(submit(args.clock, None if args.legacy_one_time else {'hours': hours, 'fixture': args.fixture}))
    elif args.command == 'retry':
        if args.job is None:
            parser.error('--job required')
        recovery.migrate()
        recovery.retry(str(args.job))
        print(str(args.job))
    elif args.command == 'collect':
        recovery.migrate()
        with recovery.processing_budget():
            print(json.dumps(recovery.collect(apply=args.apply)))
    elif args.command == 'once':
        recovery.migrate()
        once()
    else:
        recovery.migrate()
        while True:
            try:
                once()
            except Exception as error:
                print(type(error).__name__, flush=True)
            time.sleep(2)


if __name__ == '__main__':
    main()
