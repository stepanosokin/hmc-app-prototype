"""One-off verification of the user-requested rollback, using baseline readers."""
import json
import sys
from pathlib import Path
sys.path.insert(0, '/app')
import requests
from decoder.storage import bounded_frames, field_metadata, decoded_arrays, check_field, NATIVE_CRS
from decoder.sampling import file_hash
from publication import revisions
from publication.domain import database, sampler

JOB = 'ed6037f4-f53c-47d9-ad79-51c74ae492df'
SOURCE = Path('/input/ICON_EU_T_G_2026101500.grib2')
with database() as cursor:
    cursor.execute('SELECT state FROM app.jobs WHERE id=%s', (JOB,))
    assert cursor.fetchone()['state'] == 'published'
    cursor.execute("SELECT count(*) AS n FROM app.revisions r JOIN app.jobs j ON j.id=r.job_id WHERE j.request ? 'source_crs'")
    assert cursor.fetchone()['n'] == 0
    cursor.execute('SELECT count(*) AS n FROM app.revisions WHERE job_id=%s', (JOB,))
    assert cursor.fetchone()['n'] == 24, 'Every hour must be newly processed'
revision = revisions.latest('ICON-EU/2026-10-15T00:00:00Z')
assert revision['job'] == JOB and len(revision['batches']) == 24
checks = []
for hour, frame in enumerate(bounded_frames(SOURCE), 1):
    metadata = field_metadata(frame, hour)
    entry = next(e for e in revision['batches'] if e['valid_time'] == metadata['valid_time'])
    published = revisions.selected(revision, entry)
    assert published['source']['processing_version'] == 't6.1'
    assert 'source_crs' not in published['source']
    assert published['identity']['native_grid_sha256'] == metadata['native_grid_sha256']
    reader = sampler(published)
    item = reader.manifest['fields'][0]
    assert item['metadata']['native_crs_wkt'] == NATIVE_CRS.to_wkt()
    values, missing = decoded_arrays(frame, metadata['grid']['shape_yx'])
    check = check_field(reader.root, item, values, missing)
    for cell in metadata['grid']['cell_centres']:
        value = reader.sample(run=revision['run'], revision=reader.revision, field=item['field'],
                              valid_time=metadata['valid_time'], lon=cell['lon'], lat=cell['lat'])
        assert value['value'] == cell['value']
    cell = metadata['grid']['cell_centres'][0]
    params = dict(selection=published['selection'], run=revision['run'], revision=revision['revision'],
                  valid_time=metadata['valid_time'], layer=item['field'], lon=cell['lon'], lat=cell['lat'])
    response = requests.get('http://gateway:8000/api/v1/point', params=params, timeout=45)
    response.raise_for_status()
    assert response.json()['value'] == cell['value']
    assert response.json()['crs'] == 'urn:hmc:crs:icon-sphere-6371229'
    checks.append(check)
report = dict(state='passed', job=JOB, revision=revision['revision'], source_sha256=file_hash(SOURCE),
              newly_processed_times=len(checks), gateway_point_checks=len(checks),
              native_crs=NATIVE_CRS.to_string(), rejected_revisions_in_catalogue=0, fields=checks)
Path('/evidence/rollback-verification.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k != 'fields'}))
