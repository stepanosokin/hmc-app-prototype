"""Independent actual-array audit; never imports the policy being verified."""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
import requests
import zarr

from decoder.sampling import asset_path, read_values
from publication.domain import ROOT, database

phase = sys.argv[1]
report = Path('/report')
response = requests.get('http://gateway:8000/api/v1/catalogue', timeout=120)
response.raise_for_status()
catalogue = response.json()
(report / f'catalogue-{phase}.json').write_text(json.dumps(catalogue), encoding='utf-8')
with database() as cursor:
    cursor.execute('SELECT revision,manifest_path,manifest_sha256 FROM app.revisions')
    roots = {row['revision']: row for row in cursor.fetchall()}


def load(relative, checksum):
    raw = asset_path(ROOT, relative).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == checksum, relative
    return json.loads(raw)


revisions = {}
observations = {}
checks = []
for selection in catalogue['selections']:
    root, key = selection['selection'].split('.', 1)
    if root not in revisions:
        row = roots[root]
        revisions[root] = load(row['manifest_path'], row['manifest_sha256'])
    entry = next(e for e in revisions[root]['batches'] if e['key'] == key)
    batch = load(entry['manifest_path'], entry['manifest_sha256'])
    relative = batch['numerical_manifest']
    numerical = load(relative, batch['assets'][relative]['sha256'])
    item = numerical['fields'][0]
    meta = item['metadata']
    identity = json.dumps([selection[k] for k in ('run', 'field', 'valid_time', 'level', 'member')])
    wind = selection.get('field_short_name') == 'wind_speed' and selection['level'] == 10
    observations[identity] = {'selection': selection['selection'], 'target': wind,
        'values_sha256': meta['values']['decoded_float64_le_sha256'],
        'source_missing_count': meta['values'].get('source_missing_count'),
        'rejected_count': meta['values'].get('rejected_count'),
        'minimum': meta['values']['min'], 'validity': meta.get('value_validity')}
    if not wind:
        continue
    native_root = asset_path(ROOT, relative).parent
    group = zarr.open_group(str(asset_path(native_root, item['zarr'])), mode='r', zarr_format=2)
    values = read_values(group, item.get('data_variable', 'temperature'))
    reasons = read_values(group, 'missing_reason')
    assert hashlib.sha256(np.asarray(values, dtype='<f8').tobytes()).hexdigest() == observations[identity]['values_sha256']
    rejected = (reasons != 1) & (values < .01)
    valid = (reasons != 1) & (values >= .01)
    near_reported = (reasons != 1) & (np.abs(values - .000666263) < .0000000005)
    result = {'time': selection['valid_time'], 'threshold_cells': int(rejected.sum()),
        'already_rejected': int((reasons == 2).sum()), 'reported_value_cells': int(near_reported.sum()),
        'expected_minimum': float(values[valid].min()) if valid.any() else None}
    if phase == 'after':
        np.testing.assert_array_equal(reasons == 2, rejected)
        assert meta['value_validity']['version'] == 'field-validity/5'
        assert meta['value_validity']['rule'] == 'wind-speed-10m-minimum-0.01-ms'
        assert meta['values']['min'] == result['expected_minimum']
        with rasterio.open(asset_path(native_root, item['cog'])) as cog:
            # Native COG rows run from north to south, Zarr rows from south to north.
            np.testing.assert_array_equal(cog.read_masks(1) > 0, (reasons == 0)[::-1])
        metadata_response = requests.get('http://gateway:8000'+selection['native_display'], timeout=120)
        metadata_response.raise_for_status()
        native = metadata_response.json()
        assert native['value_counts']['rejected_count'] == int(rejected.sum())
        assert native['value_validity']['rule'] == 'wind-speed-10m-minimum-0.01-ms'
        result['native_counts'] = native['value_counts']
        if rejected.any():
            y, x = np.argwhere(near_reported if near_reported.any() else rejected)[0]
            params = {k: selection[k] for k in ('selection', 'run', 'revision', 'valid_time')}
            params.update(layer=selection['field'], lon=float(read_values(group, 'longitude', int(x))),
                          lat=float(read_values(group, 'latitude', int(y))))
            point = requests.get('http://gateway:8000/api/v1/point', params=params, timeout=120)
            point.raise_for_status()
            assert point.json()['value'] is None and point.json()['nodata_reason'] == 'rejected_value'
            result['point'] = {'source_value': float(values[y, x]), 'response': point.json()}
            if near_reported.any():
                from publication import geoserver
                grid = meta['grid']
                west, south, _, _ = grid['outer_cell_edges_wsen']
                dx, dy = grid['spacing_degrees_xy']
                gis = {**batch['gis'], 'probe': {'lon': west+(int(x)+.5)*dx,
                       'lat': south+(int(y)+.5)*dy, 'value': None}}
                identified = geoserver.verify(gis)
                assert identified['identified_value'] is None
                result['gis_identified_value'] = identified['identified_value']
    checks.append(result)

assert len(checks) == 10
assert any(row['reported_value_cells'] for row in checks), 'Reported value not located in actual arrays'
if phase == 'after':
    before = json.loads((report / 'audit-before.json').read_bytes())['observations']
    old_catalogue = json.loads((report / 'catalogue-before.json').read_bytes())
    old_batches = {json.dumps([s[k] for k in ('run', 'field', 'valid_time', 'level', 'member')]): s['batch']
                   for s in old_catalogue['selections']}
    current_batches = {json.dumps([s[k] for k in ('run', 'field', 'valid_time', 'level', 'member')]): s['batch']
                       for s in catalogue['selections']}
    assert before.keys() == observations.keys(), 'Changed forecast selection identities'
    for identity, observation in observations.items():
        for key in ('values_sha256', 'source_missing_count'):
            assert observation[key] == before[identity][key], (identity, key)
        if not observation['target']:
            assert current_batches[identity] == old_batches[identity], 'Unchanged field was rebuilt'
            for key in ('rejected_count', 'minimum'):
                assert observation[key] == before[identity][key], (identity, key)
        else:
            assert current_batches[identity] != old_batches[identity], 'Target field was not rebuilt'
output = {'status': 'passed', 'phase': phase, 'selections': len(observations),
          'observations': observations, 'checks': checks, 'cleanup': 'Read-only audit container uses --rm.'}
(report / f'audit-{phase}.json').write_text(json.dumps(output, indent=2), encoding='utf-8')
print(json.dumps({'status': 'passed', 'phase': phase, 'selections': len(observations), 'checks': checks}))
