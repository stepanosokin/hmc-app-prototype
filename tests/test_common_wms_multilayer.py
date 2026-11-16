"""Several forecast layers observed through the public GIS gateway (#109)."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import unittest

from PIL import Image

from test_common_wms_catalogue import CatalogueFixture


@unittest.skipUnless(os.environ.get('T109_HTTP') == '1', 'requires isolated multilayer stand')
class CommonMultilayer(CatalogueFixture):
    def test_multilayer_exact_and_default_times(self):
        reference = {'dataDate': 20261015, 'dataTime': 0}
        height = {**reference, 'typeOfLevel': 'heightAboveGround', 'level': 2}
        rain = {**reference, 'category': 1, 'number': 8, 'tablesVersion': 35, 'stepType': 'accum', 'startStep': 0}
        self.publish('WMS109-A', [(280, {**height, 'forecastTime': 3}),
                                  (290, {**height, 'forecastTime': 6}),
                                  (3, {**rain, 'endStep': 3}), (6, {**rain, 'endStep': 6})])
        self.publish('WMS109-B', [(100000, {**reference, 'category': 3, 'number': 0, 'forecastTime': 6}),
                                  (101000, {**reference, 'category': 3, 'number': 0, 'forecastTime': 9})])
        models, frozen = self.catalogue()
        leaves = models['WMS109-A'] + models['WMS109-B']
        temperature = next(leaf for leaf in leaves if (leaf.findtext('{*}Title') or '').startswith('Температура'))
        precipitation = next(leaf for leaf in leaves if (leaf.findtext('{*}Title') or '').startswith('Суммарные'))
        pressure = models['WMS109-B'][0]
        names = [leaf.findtext('{*}Name') for leaf in (temperature, pressure)]
        assert all(names)
        common = '2026-10-15T06:00:00Z'
        params = {**frozen, 'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap',
                  'LAYERS': ','.join(names), 'STYLES': ',', 'CRS': 'EPSG:4326',
                  'BBOX': '-.01,-.01,.01,.01', 'WIDTH': '3', 'HEIGHT': '3',
                  'FORMAT': 'image/png', 'TRANSPARENT': 'true', 'TIME': common}
        mapped = self.get(params).content
        self.assertEqual(Image.open(io.BytesIO(mapped)).format, 'PNG')
        info = self.get({**params, 'REQUEST': 'GetFeatureInfo', 'QUERY_LAYERS': ','.join(names),
                         'INFO_FORMAT': 'text/plain', 'I': '1', 'J': '1'}).text
        self.assertEqual([float(value) for value in re.findall(r'GRAY_INDEX\s*=\s*([^\s]+)', info)], [290, 100000])
        missing = self.get({**params, 'TIME': '2026-10-15T03:00:00Z'}, expected=404).json()
        self.assertEqual(missing['code'], 'InvalidDimensionValue')
        Path('/evidence/common-multilayer.json').write_text(json.dumps({
            'status': 'passed', 'snapshot': frozen, 'layers': names, 'time': common,
            'map_sha256': hashlib.sha256(mapped).hexdigest(), 'identify': info,
            'precipitation': precipitation.findtext('{*}Name'),
            'times': {leaf.findtext('{*}Name'): (leaf.findtext('{*}Dimension') or '').split(',') for leaf in leaves},
            'abstracts': {leaf.findtext('{*}Name'): leaf.findtext('{*}Abstract') for leaf in leaves},
            'values': {temperature.findtext('{*}Name'): {'2026-10-15T03:00:00Z': 280, common: 290},
                       precipitation.findtext('{*}Name'): {'2026-10-15T03:00:00Z': 3, common: 6},
                       pressure.findtext('{*}Name'): {common: 100000, '2026-10-15T09:00:00Z': 101000}},
            'params': params}, ensure_ascii=False, indent=2))

    def test_numerical_metadata_order_and_interval(self):
        seed = json.loads(Path('/evidence/common-multilayer.json').read_text())
        params = seed['params']
        names = seed['layers']
        observations = []
        for crs, bbox in (('EPSG:4326', '-.01,-.01,.01,.01'), ('EPSG:3857', '-1000,-1000,1000,1000')):
            params = {**params, 'CRS': crs, 'BBOX': bbox}
            for name, values in seed['values'].items():
                for time, expected in values.items():
                    single = {**params, 'LAYERS': name, 'STYLES': '', 'TIME': time}
                    image = self.get(single).content
                    pixel = Image.open(io.BytesIO(image)).convert('RGBA').getpixel((1, 1))
                    assert isinstance(pixel, tuple)
                    self.assertGreater(pixel[3], 0)
                    info = self.get({**single, 'REQUEST': 'GetFeatureInfo', 'QUERY_LAYERS': name,
                                     'INFO_FORMAT': 'text/plain', 'WIDTH': '3201', 'HEIGHT': '1801',
                                     'I': '1600', 'J': '900'}).text
                    value = re.search(r'GRAY_INDEX\s*=\s*([^\s]+)', info)
                    assert value is not None
                    self.assertAlmostEqual(float(value[1]), expected, delta=.0001)
                    for label in ('Модель:', 'Расчёт:', 'Редакция:', 'Единицы:', 'Срок: ' + time):
                        self.assertIn(label, info)
                    if name == seed['precipitation']:
                        self.assertIn('Интервал: 2026-10-15T00:00:00Z — ' + time + '; статистическая операция: 1', info)
                    legend = {**seed['snapshot'], 'SERVICE': 'WMS', 'VERSION': '1.3.0',
                              'REQUEST': 'GetLegendGraphic', 'LAYER': name, 'TIME': time, 'FORMAT': 'image/png'}
                    self.assertEqual(Image.open(io.BytesIO(self.get(legend).content)).format, 'PNG')
                    if time == min(values):
                        self.assertEqual(self.get({k: v for k, v in single.items() if k != 'TIME'}).content, image)
                    observations.append({'crs': crs, 'name': name, 'time': time, 'expected': expected, 'identify': info})
            info_params = {**params, 'REQUEST': 'GetFeatureInfo', 'QUERY_LAYERS': ','.join(names),
                           'INFO_FORMAT': 'text/plain', 'I': '1', 'J': '1'}
            default = self.get({k: v for k, v in info_params.items() if k != 'TIME'}).text
            self.assertEqual([float(v) for v in re.findall(r'GRAY_INDEX\s*=\s*([^\s]+)', default)], [280, 100000])
            self.assertIn('Срок: 2026-10-15T03:00:00Z', default)
            self.assertIn('Срок: 2026-10-15T06:00:00Z', default)
            # Independently calculate alpha-over from the two physical portrayals.
            for order in (names, list(reversed(names))):
                combined = self.get({**params, 'LAYERS': ','.join(order)}).content
                pixels = [Image.open(io.BytesIO(self.get({**params, 'LAYERS': name, 'STYLES': ''}).content)).convert('RGBA').getpixel((1, 1))
                          for name in order]
                bottom, top = pixels
                assert isinstance(bottom, tuple) and isinstance(top, tuple)
                alpha = top[3] / 255 + bottom[3] / 255 * (1 - top[3] / 255)
                expected_pixel = [round((top[i] * top[3] / 255 + bottom[i] * bottom[3] / 255 * (1 - top[3] / 255)) / alpha)
                                  for i in range(3)] + [round(alpha * 255)]
                actual = Image.open(io.BytesIO(combined)).convert('RGBA').getpixel((1, 1))
                assert isinstance(actual, tuple)
                for observed, expected_component in zip(actual, expected_pixel):
                    self.assertAlmostEqual(observed, expected_component, delta=1)
            subset = self.get({**info_params, 'QUERY_LAYERS': names[0]}).text
            self.assertEqual(len(re.findall('GRAY_INDEX', subset)), 1)
            self.get({**info_params, 'QUERY_LAYERS': names[0], 'TIME': '2026-10-15T03:00:00Z'}, expected=404)
        Path('/evidence/common-multilayer-values.json').write_text(json.dumps({'status': 'passed', 'observations': observations},
                                                                           ensure_ascii=False, indent=2))

    def test_parameters_access_and_unavailable_component(self):
        import requests
        import subprocess
        import sys
        import tempfile
        from publication.access import issue
        from publication import geoserver
        from publication.domain import resolve
        seed = json.loads(Path('/evidence/common-multilayer.json').read_text())
        params = seed['params']
        self.assertEqual(self.get({**params, 'LAYERS': seed['layers'][0] + ',unknown'}, expected=404).json()['code'], 'LayerNotDefined')
        self.assertEqual(self.get({**params, 'TIME': '1900-01-01T00:00:00Z'}, expected=404).json()['code'], 'InvalidDimensionValue')
        for change in ({'WIDTH': '3001'}, {'STYLES': 'raster'}, {'LAYERS': seed['layers'][0] + ','},
                       {'REQUEST': 'GetFeatureInfo', 'QUERY_LAYERS': 'unknown', 'INFO_FORMAT': 'text/plain', 'I': '1', 'J': '1'}):
            self.get({**params, **change}, expected=400)
        with tempfile.TemporaryDirectory() as directory:
            key_file = Path(directory) / 'key'
            identity = issue('wms109-reader', 'gis', key_file)
            headers = {'X-API-Key': key_file.read_text().strip()}
            operations = [params, {**params, 'REQUEST': 'GetFeatureInfo', 'QUERY_LAYERS': ','.join(seed['layers']),
                                   'INFO_FORMAT': 'text/plain', 'I': '1', 'J': '1'}]
            for operation in operations:
                for authorization, expected in ((headers, 200), ({}, 401)):
                    response = requests.get(self.base + '/org/gis/v1/wms', params=operation, headers=authorization, timeout=35)
                    self.assertEqual(response.status_code, expected)
            result = subprocess.run([sys.executable, '-m', 'publication.access', 'revoke', '--id', str(identity['id'])], capture_output=True)
            self.assertEqual(result.returncode, 0)
            for operation in operations:
                response = requests.get(self.base + '/org/gis/v1/wms', params=operation, headers=headers, timeout=35)
                self.assertEqual(response.status_code, 401)
                self.assertNotIn(seed['layers'][0], response.text)
        # Real GeoServer component failure after the other layer has rendered.
        catalogue = requests.get(self.base + '/api/v1/catalogue', timeout=35).json()['selections']
        selected = next(item for item in catalogue if item['wms_name'] == seed['layers'][1] and item['valid_time'] == params['TIME']
                        and item['revision'] in seed['abstracts'][seed['layers'][1]])
        manifest = resolve(selected['selection'])
        gis = manifest['gis']
        path = f"/workspaces/{gis['workspace']}/coveragestores/temperature/coverages/{gis['coverage']}.json"
        try:
            geoserver.admin('PUT', path, json={'coverage': {'enabled': False}})
            failed = self.get(params, expected=503)
            self.assertEqual(failed.json()['code'], 'Unavailable')
            self.assertNotIn('/assets', failed.text)
            self.assertNotIn('geoserver:', failed.text)
        finally:
            geoserver.admin('PUT', path, json={'coverage': {'enabled': True}})
        self.get(params)
        Path('/evidence/common-multilayer-errors.json').write_text(json.dumps({'status': 'passed',
            'unknown_layer': 'LayerNotDefined', 'missing_time': 'InvalidDimensionValue',
            'component_unavailable': 'Unavailable', 'access_and_revocation': True}))


    def test_q_nodata_composition_has_no_invented_values(self):
        seed = json.loads(Path('/evidence/common-multilayer.json').read_text())
        reference = {'dataDate': 20261015, 'dataTime': 0, 'forecastTime': 6}
        self.publish('WMS109-NODATA', [(0, {**reference, 'typeOfLevel': 'heightAboveGround', 'level': 2}),
                                       (0, {**reference, 'category': 3, 'number': 0})])
        models, frozen = self.catalogue()
        missing = [leaf.findtext('{*}Name') for leaf in models['WMS109-NODATA']]
        params = {**seed['params'], **frozen}
        valid = seed['layers'][0]
        reference_image = Image.open(io.BytesIO(self.get({**params, 'LAYERS': valid, 'STYLES': ''}).content)).convert('RGBA')
        for order in ([valid, missing[0]], [missing[0], valid], missing):
            selected = {**params, 'LAYERS': ','.join(order)}
            image = Image.open(io.BytesIO(self.get(selected).content)).convert('RGBA')
            if valid in order:
                self.assertEqual(image.tobytes(), reference_image.tobytes())
            else:
                self.assertEqual(image.getchannel('A').getextrema(), (0, 0))
            text = self.get({**selected, 'REQUEST': 'GetFeatureInfo', 'QUERY_LAYERS': ','.join(order),
                             'INFO_FORMAT': 'text/plain', 'I': '1', 'J': '1'}).text
            values = [float(value) for value in re.findall(r'GRAY_INDEX\s*=\s*([^\s]+)', text)]
            import math
            self.assertEqual([value for value in values if math.isfinite(value)], [290] if valid in order else [])
        Path('/evidence/common-multilayer-nodata.json').write_text(json.dumps({'status': 'passed',
            'orders_checked': 3, 'missing_fields': missing, 'valid_native_value': 290}))


def advance():
    """Publish only after the ordinary desktop has added the original layers."""
    seed = json.loads(Path('/evidence/common-multilayer.json').read_text())
    fixture = CatalogueFixture()
    fixture.publish('WMS109-A', [(295, {'dataDate': 20261015, 'dataTime': 0,
                                     'typeOfLevel': 'heightAboveGround', 'level': 2, 'forecastTime': 9})])
    models, frozen = fixture.catalogue()
    fixture.assertEqual(len(models['WMS109-A']), 1)
    fixture.assertEqual(models['WMS109-A'][0].findtext('{*}Name'), seed['layers'][0])
    fixture.assertEqual(models['WMS109-A'][0].findtext('{*}Dimension'), '2026-10-15T09:00:00Z')
    import xml.etree.ElementTree as ET
    retained = ET.fromstring(fixture.get(seed['snapshot']).content)
    for name, times in seed['times'].items():
        leaf = retained.find(f".//{{*}}Layer[{{*}}Name='{name}']")
        assert leaf is not None
        fixture.assertEqual((leaf.findtext('{*}Dimension') or '').split(','), times)
    Path('/evidence/multilayer-advance.json').write_text(json.dumps({'status': 'passed', 'snapshot': frozen,
        'name': seed['layers'][0], 'time': '2026-10-15T09:00:00Z', 'value': 295}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    import sys
    if sys.argv[1:] != ['desktop-advance']:
        raise SystemExit('Use desktop-advance on an isolated T11 stand')
    advance()
