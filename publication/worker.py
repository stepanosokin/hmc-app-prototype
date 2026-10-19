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

from psycopg2.extras import Json

from decoder.inspect_forecast import SAMPLE_SHA256
from decoder.sampling import ManifestSampler, canonical, file_hash
from decoder.storage import build, bounded_frames, field_metadata, decoded_arrays
from publication.domain import ROOT, PIPELINE, database, write_once, load_manifest
from publication import geoserver
from publication.tiles import CONTRACT, CONTRACT_PATH, render, encode, decode


def transition(job: str, state: str, **extra) -> None:
    entry = {'state': state, 'observed_at': datetime.now().astimezone().isoformat(), **extra}
    with database() as cursor:
        cursor.execute('UPDATE app.jobs SET state=%s, history=history || %s WHERE id=%s',
                       (state, Json([entry]), job))


def submit(clock: str) -> str:
    if not clock.endswith('Z'):
        raise ValueError('explicit UTC demo clock required')
    datetime.fromisoformat(clock.replace('Z', '+00:00'))
    job = str(uuid.uuid4())
    with database() as cursor:
        cursor.execute('INSERT INTO app.jobs(id,submitted_at,source_name,pipeline_version,state,history) '
                       'VALUES(%s,%s,%s,%s,%s,%s)',
                       (job, clock, 'ICON_EU_T_G_2026101500.grib2', PIPELINE, 'discovered',
                        Json([{'state': 'discovered', 'clock': clock}])))
    return job


def process(job: dict) -> None:
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
    report = build(staged, attempt / 'numerical', job['submitted_at'].isoformat().replace('+00:00', 'Z'))
    transition(identifier, 'normalized', zarr_max_abs_error_K=report['zarr_max_abs_error'])
    numerical = ManifestSampler(attempt / 'numerical/manifest.json')
    item = numerical.manifest['fields'][0]
    selection_body = {key: numerical.manifest[key] for key in ['model', 'run', 'member']}
    selection_body.update(revision=numerical.revision, field=item['field'], level=0,
                          valid_time=item['metadata']['valid_time'],
                          native_grid_sha256=item['metadata']['native_grid_sha256'],
                          publication_job=identifier, contract=CONTRACT['contract'])
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
    write_once(attempt / 'tiles.json', tile_metadata)
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
        tile_path.chmod(0o444)
        tile_checks.append({'zxy': [z, x, y], 'sha256': file_hash(tile_path)})
    if os.environ.get('T4_TEST_FAILURE') == 'tiles':
        # Explicit failure injection: real durable metadata is absent at readiness.
        (attempt / 'tiles.json').unlink()
    if not (attempt / 'tiles.json').is_file():
        raise ValueError('durable numeric metadata missing')
    mosaic = attempt / 'mosaic'
    mosaic.mkdir()
    shutil.copyfile(numerical.root / item['cog'], mosaic / 'temperature_20261015T010000.tif')
    (mosaic / 'datastore.properties').write_text('\n'.join([
        'SPI=org.geotools.data.postgis.PostgisNGDataStoreFactory', 'host=db', 'port=5432',
        'database=hmc', 'schema=' + ('nonexistent' if os.environ.get('T4_TEST_FAILURE') == 'index' else 'mosaic'), 'user=hmc_mosaic',
        'passwd=' + os.environ['MOSAIC_PASSWORD'], 'Loose bbox=true', 'preparedStatements=true']))
    (mosaic / 'indexer.properties').write_text('TimeAttribute=time\nMosaicCRS=EPSG:100001\nName=g' + selection[:24] + '\nTypeName=g' + selection[:24] + '\nSchema=*the_geom:Polygon,location:String,time:java.util.Date\nPropertyCollectors=TimestampFileNameExtractorSPI[timeregex](time)\n')
    (mosaic / 'timeregex.properties').write_text('regex=[0-9]{8}T[0-9]{6}\nformat=yyyyMMdd\'T\'HHmmss\n')
    gis = geoserver.prepare('p' + selection[:24], str(mosaic), item['metadata']['valid_time'])
    point = numerical.sample(run=numerical.manifest['run'], revision=numerical.revision,
                             field=item['field'], valid_time=item['metadata']['valid_time'], lon=20.,lat=50.)
    gis['probe'] = {'lon':point['cell']['lon'],'lat':point['cell']['lat'],'value':point['value']}
    transition(identifier, 'derivatives_ready', representative_tiles=tile_checks)
    gis_checks = geoserver.verify(gis)
    (mosaic / 'temperature_20261015T010000.tif').chmod(0o444)
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
    manifest_path = attempt / 'publication.json'
    checksum = write_once(manifest_path, body)
    for directory in [path for path in attempt.rglob('*') if path.is_dir()] + [attempt, attempt.parent, ROOT]:
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
    with database() as cursor:
        cursor.execute('INSERT INTO app.catalogue VALUES(%s,%s,%s,%s,%s)',
                       (selection, identifier, relative, checksum, job['submitted_at']))
        cursor.execute('UPDATE app.jobs SET state=%s, selection=%s, manifest_path=%s, manifest_sha256=%s, '
                       'history=history || %s WHERE id=%s',
                       ('published', selection, relative, checksum, Json([{'state': 'published'}]), identifier))


def once() -> bool:
    with database() as lock:
        lock.execute('SELECT pg_try_advisory_lock(16001) AS acquired')
        if not lock.fetchone()['acquired']:
            return False
        with database() as cursor:
            cursor.execute("SELECT * FROM app.jobs WHERE state NOT IN ('published','failed') ORDER BY submitted_at,id LIMIT 1")
            job = cursor.fetchone()
        if job is None:
            return False
        try:
            process(job)
        except Exception as error:
            transition(str(job['id']), 'failed', error_type=type(error).__name__)
            with database() as cursor:
                # Exceptions may contain private URLs/configuration; expose the class only.
                cursor.execute('UPDATE app.jobs SET error=%s WHERE id=%s', (type(error).__name__, job['id']))
            print(json.dumps({'job': str(job['id']), 'state': 'failed', 'error': str(error)}), flush=True)
            raise
        return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['submit', 'once', 'run'])
    parser.add_argument('--clock')
    args = parser.parse_args()
    if args.command == 'submit':
        if not args.clock:
            parser.error('--clock required')
        print(submit(args.clock))
    elif args.command == 'once':
        once()
    else:
        while True:
            try:
                once()
            except Exception as error:
                print(type(error).__name__, flush=True)
            time.sleep(2)


if __name__ == '__main__':
    main()
