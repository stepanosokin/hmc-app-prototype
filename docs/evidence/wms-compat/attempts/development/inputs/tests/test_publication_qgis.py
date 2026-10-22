"""T11: authenticated WMS consumer seam against real published services."""

import io
import json
import os
from pathlib import Path
import re
import tempfile
import unittest
import xml.etree.ElementTree as ET

from PIL import Image
import requests

from publication.access import issue
from publication.tiles import MAP_TO_NATIVE


@unittest.skipUnless(os.environ.get('T11_HTTP') == '1', 'requires isolated T11 Compose services')
class QgisWms(unittest.TestCase):
    base = 'http://gateway:8000'

    def test_scoped_desktop_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            key = Path(directory) / 'key'
            issue('t11-reader', 'all', key)
            self.headers = {'X-API-Key': key.read_text().strip()}
        catalogue = self.get('/org/api/v1/catalogue').json()['selections']
        actual = [item for item in catalogue if item['fixture'] == 'actual']
        # Retain a two-time revision while T5 has already published later
        # granules and another run. Its capabilities must not grow with them.
        selected = min((item for item in actual if len(item['valid_times']) >= 2),
                       key=lambda item: len(item['valid_times']))
        choices = [item for item in actual if item['revision'] == selected['revision']]
        path = selected['wms']
        caps = {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetCapabilities'}
        root = ET.fromstring(self.get(path, caps).content)
        self.assertEqual(root.findtext('.//{*}Service/{*}MaxWidth'), '512')
        self.assertEqual(root.findtext('.//{*}Service/{*}MaxHeight'), '512')
        negotiated = self.get(path, {'SERVICE': 'WMS', 'REQUEST': 'GetCapabilities'})
        self.assertEqual(ET.fromstring(negotiated.content).attrib['version'], '1.3.0')
        self.assertEqual([n.text for n in root.findall('.//{*}Layer/{*}Name')], ['temperature'])
        self.assertEqual([n.text for n in root.findall('.//{*}Dimension')],
                         [','.join(sorted(item['valid_time'] for item in choices))])
        hrefs = [value for node in root.iter() for name, value in node.attrib.items() if name.endswith('}href')]
        self.assertTrue(hrefs)
        self.assertTrue(all(value.startswith(path + '?') for value in hrefs), hrefs)
        legend_nodes = root.findall('.//{*}LegendURL/{*}OnlineResource')
        self.assertTrue(legend_nodes, 'QGIS must discover a scoped legend')
        legend = {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetLegendGraphic',
                  'LAYER': 'temperature', 'FORMAT': 'image/png', 'STYLE': 'raster'}
        self.assertEqual(Image.open(io.BytesIO(self.get(path, legend).content)).format, 'PNG')
        self.get(path, {**legend, 'DPI': '96', 'MAP_RESOLUTION': '96', 'FORMAT_OPTIONS': 'dpi:96', 'SCALE': '100000'})
        for extra in ({'LAYER': 'unrelated'}, {'SLD_BODY': '<StyledLayerDescriptor/>'}, {'WIDTH': '99999'}):
            self.get(path, {**legend, **extra}, expected=400)
        self.get(path, {**legend, 'TIME': '1900-01-01T00:00:00Z'}, expected=404)
        self.assertEqual(requests.get(self.base + path, params=legend, timeout=90).status_code, 401)
        observations = []
        # Native centres, first/last cells, and outside the half-open grid.
        # Source values are obtained independently via the canonical native sampler.
        for item in choices:
            for lon, lat in ((20., 50.), (-23.5, 29.5), (62.5, 70.5), (-25., 50.), (64., 50.)):
                point = self.get(item['point'], {**{k: item[k] for k in
                    ('selection', 'run', 'revision', 'valid_time')}, 'layer': item['field'],
                    'lon': lon, 'lat': lat}).json()
                self.assertEqual(point['units'], 'K')
                mx, my, _ = MAP_TO_NATIVE.transform(lon, lat, 0., direction='INVERSE')
                # EPSG:4326 geodetic latitude differs from native spherical latitude.
                from pyproj import Transformer
                gx, gy = Transformer.from_crs(3857, 4326, always_xy=True).transform(mx, my)
                for crs, x, y, delta in (('EPSG:3857', mx, my, 150.), ('EPSG:4326', gx, gy, .001)):
                    bbox = (y-delta, x-delta, y+delta, x+delta) if crs == 'EPSG:4326' else (x-delta, y-delta, x+delta, y+delta)
                    params = {**caps, 'REQUEST': 'GetMap', 'LAYERS': 'temperature', 'STYLES': '',
                              'TIME': item['valid_time'], 'CRS': crs, 'BBOX': ','.join(map(str, bbox)),
                              'WIDTH': '3', 'HEIGHT': '3', 'FORMAT': 'image/png', 'TRANSPARENT': 'true'}
                    image = Image.open(io.BytesIO(self.get(path, params).content)).convert('RGBA')
                    self.assertEqual(bool(image.getchannel('A').getpixel((1, 1))), point['value'] is not None)
                    dpi = {'DPI': '96', 'MAP_RESOLUTION': '96', 'FORMAT_OPTIONS': 'dpi:96'}
                    self.assertEqual(self.get(path, {**params, **dpi}).content, self.get(path, params).content)
                    if item['valid_time'] == min(choice['valid_time'] for choice in choices):
                        default = {k: v for k, v in params.items() if k != 'TIME'}
                        self.assertEqual(self.get(path, default).content, self.get(path, params).content)
                    identified = self.get(path, {**params, 'REQUEST': 'GetFeatureInfo',
                        'QUERY_LAYERS': 'temperature', 'INFO_FORMAT': 'text/plain', 'I': '1', 'J': '1'})
                    large = self.get(path, {**params, **dpi, 'REQUEST': 'GetFeatureInfo',
                        'QUERY_LAYERS': 'temperature', 'INFO_FORMAT': 'text/plain',
                        'WIDTH': '1205', 'HEIGHT': '525', 'I': '602', 'J': '262', 'FEATURE_COUNT': '10'})
                    self.assertEqual(large.text, identified.text)
                    match = re.search(r'GRAY_INDEX\s*=\s*([^\s]+)', identified.text)
                    if point['value'] is not None:
                        self.assertIsNotNone(match, identified.text)
                        assert match is not None
                        self.assertAlmostEqual(float(match[1]), point['value'], delta=.0001)
                    else:
                        self.assertTrue(match is None or match[1].lower() in ('nan', 'null'), identified.text)
                    observations.append({'time': item['valid_time'], 'crs': crs, 'native': [lon, lat],
                                         'value_K': point['value'], 'identify': identified.text})
            self.get(path, {**params, 'TIME': '1900-01-01T00:00:00Z'}, expected=404)
        for extra in ({'WIDTH': '513'}, {'DPI': '1201'}, {'FORMAT_OPTIONS': 'dpi:96;layout:bad'}):
            self.get(path, {**params, **extra}, expected=400)
        Path('/evidence/t11-http.json').write_text(json.dumps({'status': 'passed',
            'selection': selected, 'choices': choices, 'observations': observations}, indent=2) + '\n')

    def get(self, path, params=None, expected=200):
        response = requests.get(self.base + path, params=params, headers=self.headers, timeout=90)
        self.assertEqual(response.status_code, expected, response.text[:500])
        return response
