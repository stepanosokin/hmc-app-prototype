import hashlib
import io
import json
import sys
from pathlib import Path

import numpy as np
import requests
import zarr
from PIL import Image

from decoder.sampling import asset_path, read_values
from publication.domain import ROOT, database

phase = sys.argv[1]
report = Path('/report')
response = requests.get('http://gateway:8000/api/v1/catalogue', timeout=90)
response.raise_for_status()
catalogue = response.json()
(report / f'catalogue-{phase}.json').write_text(json.dumps(catalogue), encoding='utf-8')
with database() as cursor:
    cursor.execute('SELECT revision,manifest_path,manifest_sha256 FROM app.revisions')
    roots = {row['revision']: row for row in cursor.fetchall()}

def load(relative, checksum):
    path = asset_path(ROOT, relative)
    raw = path.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == checksum, relative
    return json.loads(raw)

revisions = {}
observations = {}
checks = []
cloud_levels = set()
point_checked = False
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
    observations[identity] = {'selection': selection['selection'], 'short': selection.get('field_short_name'),
        'values_sha256': meta['values']['decoded_float64_le_sha256'],
        'source_missing_count': meta['values'].get('source_missing_count'),
        'rejected_count': meta['values'].get('rejected_count'),
        'minimum': meta['values']['min'], 'validity': meta.get('value_validity')}
    wind = selection.get('field_short_name') == 'wind_speed' and selection['level'] == 10
    cloud = selection.get('field_short_name') == 'ccl' and selection['level'] not in cloud_levels
    if not (wind or cloud):
        continue
    native_root = asset_path(ROOT, relative).parent
    group = zarr.open_group(str(asset_path(native_root, item['zarr'])), mode='r', zarr_format=2)
    values = read_values(group, item.get('data_variable', 'temperature'))
    reasons = read_values(group, 'missing_reason')
    assert hashlib.sha256(np.asarray(values, dtype='<f8').tobytes()).hexdigest() == observations[identity]['values_sha256']
    if wind:
        rejected = (reasons != 1) & (values < .01)
        if phase == 'after':
            np.testing.assert_array_equal(reasons == 2, rejected)
            assert observations[identity]['validity']['version'] == 'field-validity/5'
            if rejected.any() and not point_checked:
                y, x = np.argwhere(rejected)[0]
                params = {k: selection[k] for k in ('selection', 'run', 'revision', 'valid_time')}
                params.update(layer=selection['field'], lon=float(read_values(group, 'longitude', int(x))),
                              lat=float(read_values(group, 'latitude', int(y))))
                point = requests.get('http://gateway:8000/api/v1/point', params=params, timeout=90)
                point.raise_for_status()
                assert point.json()['value'] is None and point.json()['nodata_reason'] == 'rejected_value'
                checks.append({'point': point.json()})
                point_checked = True
        checks.append({'wind_time': selection['valid_time'], 'threshold_cells': int(rejected.sum()),
                       'rejected_count': int((reasons == 2).sum())})
    if cloud:
        cloud_levels.add(selection['level'])
        assert not (reasons[values == 0] == 2).any()
        if phase == 'after':
            from decoder.palettes import select, rgb
            from publication import geoserver
            import rasterio
            from pyproj import Transformer
            palette = select(meta)
            assert palette is not None
            assert palette['colors'][:4] == [31, 31, 68, 255]
            assert palette['colors'][-4:] == [255, 255, 255, 255]
            gis = batch['gis']
            # Select a visible cell from the actual GIS derivative. The worker's
            # numerical probe may legitimately be a transparent zero cloud cell.
            cog = next(name for name in batch['assets'] if '/mosaic/' in name and name.endswith('.tif'))
            with rasterio.open(asset_path(ROOT, cog)) as raster:
                data = raster.read(1)
                visible = np.argwhere((raster.read_masks(1) > 0) & np.isfinite(data) & (data != 0))
                y, x = visible[len(visible)//2]
                lon, lat = raster.xy(int(y), int(x))
                value = float(data[y, x])
                mx, my = Transformer.from_crs(raster.crs, 'EPSG:3857', always_xy=True).transform(lon, lat)
            result = geoserver.wms(gis, {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap',
                'LAYERS': gis['layer'], 'STYLES': '', 'TIME': gis['valid_time'], 'CRS': 'EPSG:3857',
                'BBOX': f'{mx-150},{my-150},{mx+150},{my+150}', 'WIDTH': 3, 'HEIGHT': 3,
                'FORMAT': 'image/png', 'TRANSPARENT': 'true'})
            result.raise_for_status()
            image = Image.open(io.BytesIO(result.content)).convert('RGBA')
            pixel = image.getpixel((1, 1))
            assert isinstance(pixel, tuple)
            expected = rgb(np.array([value]), palette)[0]
            assert np.abs(np.asarray(pixel[:3]) - expected).max() <= 2, (pixel, expected)
            assert abs(pixel[3] - 204) <= 1, pixel
            (report / f'cloud-{selection["level"]}.png').write_bytes(result.content)
            checks.append({'cloud_level': selection['level'], 'wms_pixel': pixel, 'expected': expected.tolist(),
                           'range': palette['range'], 'zero_cells': int((values == 0).sum())})

if phase == 'after':
    before = json.loads((report / 'audit-before.json').read_bytes())['observations']
    assert before.keys() == observations.keys(), 'Changed forecast selection identities'
    for identity, observation in observations.items():
        for key in ('values_sha256', 'source_missing_count'):
            assert observation[key] == before[identity][key], (identity, key)
        if observation['short'] != 'wind_speed':
            assert observation['rejected_count'] == before[identity]['rejected_count'], identity
    assert point_checked, 'No live sentinel point was verified'

output = {'status': 'passed', 'phase': phase, 'selections': len(observations), 'observations': observations,
          'checks': checks, 'cleanup': 'Read-only assets/source mounts; disposable container uses --rm.'}
(report / f'audit-{phase}.json').write_text(json.dumps(output, indent=2), encoding='utf-8')
print(json.dumps({'status': 'passed', 'phase': phase, 'selections': len(observations), 'checks': checks}))
