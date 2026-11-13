"""Common WMS consumer boundary through the real GIS gateway (#106)."""

import os
import io
import re
import json
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit, parse_qs

import requests
from PIL import Image
from pyproj import Transformer
from publication.tiles import MAP_TO_NATIVE
from publication.access import issue


@unittest.skipUnless(os.environ.get('T11_HTTP') == '1', 'requires isolated T11 services')
class CommonWms(unittest.TestCase):
    base = 'http://gateway:8000'

    def get(self, path='/gis/v1/wms', params=None, headers=None, expected=200):
        response = requests.get(self.base + path, params=params, headers=headers, timeout=35)
        self.assertEqual(response.status_code, expected, response.text[:300] if expected != 200 else response.content[:100])
        return response

    def connection(self, headers=None, prefix=''):
        root = ET.fromstring(self.get(prefix + '/gis/v1/wms', headers=headers).content)
        resource = root.find('.//{*}GetCapabilities//{*}OnlineResource')
        assert resource is not None
        url = urlsplit(resource.attrib['{http://www.w3.org/1999/xlink}href'])
        return root, url.path, {key: value[0] for key, value in parse_qs(url.query).items()}

    def test_common_discovery_advertises_one_frozen_catalogue(self):
        response = requests.get('http://gateway:8000/gis/v1/wms',
                                params={'SERVICE': 'WMS', 'REQUEST': 'GetCapabilities'}, timeout=30)
        self.assertEqual(response.status_code, 200, response.text[:300])
        root = ET.fromstring(response.content)
        self.assertEqual(root.attrib['version'], '1.3.0')
        operations = root.findall('.//{*}Request/*')
        self.assertEqual({node.tag.split('}')[-1] for node in operations},
                         {'GetCapabilities', 'GetMap', 'GetFeatureInfo', 'GetLegendGraphic'})
        hrefs = []
        for node in operations:
            resource = node.find('.//{*}OnlineResource')
            assert resource is not None
            hrefs.append(resource.attrib['{http://www.w3.org/1999/xlink}href'])
        self.assertEqual(len(set(hrefs)), 1)
        frozen = urlsplit(hrefs[0])
        self.assertEqual(frozen.path, '/gis/v1/wms')
        self.assertIn('snapshot=', frozen.query)
        self.assertTrue(root.findall('.//{*}Layer/{*}Name'))

    def test_maps_identify_legend_and_exact_time_preserve_native_values(self):
        root, path, frozen = self.connection()
        leaf = root.find('.//{*}Layer[{*}Name]')
        assert leaf is not None
        name = leaf.findtext('{*}Name')
        self.assertEqual(leaf.findtext('{*}Title'), 'Температура поверхности, K')
        abstract = leaf.findtext('{*}Abstract') or ''
        choices = [s for s in self.get('/api/v1/catalogue').json()['selections'] if s['revision'] in abstract]
        self.assertGreaterEqual(len(choices), 2)
        observations = []
        for item in (min(choices, key=lambda s: s['valid_time']), max(choices, key=lambda s: s['valid_time'])):
            for lon, lat in ((20., 50.), (64., 50.)):
                point = self.get(item['point'], {**{k: item[k] for k in ('selection', 'run', 'revision', 'valid_time')},
                    'layer': item['field'], 'lon': lon, 'lat': lat}).json()
                mx, my, _ = MAP_TO_NATIVE.transform(lon, lat, 0., direction='INVERSE')
                gx, gy = Transformer.from_crs(3857, 4326, always_xy=True).transform(mx, my)
                for crs, x, y, delta in (('EPSG:3857', mx, my, 150.), ('EPSG:4326', gx, gy, .001)):
                    bbox = (y-delta, x-delta, y+delta, x+delta) if crs == 'EPSG:4326' else (x-delta, y-delta, x+delta, y+delta)
                    params = {**frozen, 'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap',
                        'LAYERS': name, 'STYLES': '', 'TIME': item['valid_time'], 'CRS': crs,
                        'BBOX': ','.join(map(str, bbox)), 'WIDTH': '3', 'HEIGHT': '3', 'FORMAT': 'image/png', 'TRANSPARENT': 'true'}
                    mapped = self.get(path, params)
                    image = Image.open(io.BytesIO(mapped.content)).convert('RGBA')
                    self.assertEqual(bool(image.getchannel('A').getpixel((1, 1))), point['value'] is not None)
                    identify = {**params, 'REQUEST': 'GetFeatureInfo', 'QUERY_LAYERS': name, 'INFO_FORMAT': 'text/plain',
                        'WIDTH': '1205', 'HEIGHT': '701', 'I': '602', 'J': '350'}
                    text = self.get(path, identify).text
                    match = re.search(r'GRAY_INDEX\s*=\s*([^\s]+)', text)
                    if point['value'] is None:
                        self.assertTrue(match is None or match[1].lower() in ('nan', 'null'))
                    else:
                        assert match is not None
                        self.assertAlmostEqual(float(match[1]), point['value'], delta=.0001)
                    for value in (item['run'], item['revision'], item['valid_time'], 'Единицы: K'):
                        self.assertIn(value, text)
                    if item['valid_time'] == min(s['valid_time'] for s in choices):
                        self.assertEqual(self.get(path, {k: v for k, v in params.items() if k != 'TIME'}).content, mapped.content)
                    self.get(path, {**params, 'TIME': '1900-01-01T00:00:00Z'}, expected=404)
                    observations.append({'time': item['valid_time'], 'crs': crs, 'native': [lon, lat], 'expected': point['value'], 'identify': text})
        legend = self.get(path, {**frozen, 'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetLegendGraphic', 'LAYER': name, 'FORMAT': 'image/png'})
        self.assertEqual(Image.open(io.BytesIO(legend.content)).format, 'PNG')
        self.get(path, {**params, 'LAYERS': 'unknown'}, expected=404)
        self.get(path, {**params, 'WIDTH': '3001'}, expected=400)
        Path('/evidence/common-wms-numerical.json').write_text(json.dumps({'status': 'passed', 'observations': observations}, indent=2))

    def test_snapshot_does_not_authorize_protected_operations(self):
        with tempfile.TemporaryDirectory() as directory:
            key_file = Path(directory) / 'key'
            identity = issue('wms106-reader', 'gis', key_file)
            headers = {'X-API-Key': key_file.read_text().strip()}
            root, path, frozen = self.connection(headers, '/org')
            name = root.findtext('.//{*}Layer/{*}Name')
            operations = [frozen, {**frozen, 'REQUEST': 'GetMap', 'LAYERS': name, 'STYLES': '', 'CRS': 'EPSG:4326',
                'BBOX': '45,15,55,25', 'WIDTH': '8', 'HEIGHT': '8', 'FORMAT': 'image/png'},
                {**frozen, 'REQUEST': 'GetLegendGraphic', 'LAYER': name, 'FORMAT': 'image/png'}]
            operations.append({**operations[1], 'REQUEST': 'GetFeatureInfo', 'QUERY_LAYERS': name, 'INFO_FORMAT': 'text/plain', 'I': '4', 'J': '4'})
            for params in operations:
                self.get(path, params, headers)
                self.get(path, params, expected=401)
                self.get(path, {**params, 'key': 'forbidden'}, headers, expected=400)
            revoked = subprocess.run([sys.executable, '-m', 'publication.access', 'revoke', '--id', str(identity['id'])], capture_output=True)
            self.assertEqual(revoked.returncode, 0)
            for params in operations:
                self.get(path, params, headers, expected=401)

    @unittest.skipUnless(os.environ.get('T106_LIFECYCLE') == '1', 'destructive final phase on disposable stand')
    def test_retained_catalogue_survives_publication_but_not_expiry_or_withdrawal(self):
        from publication import retention, grib_sync
        root, path, frozen = self.connection()
        name = root.findtext('.//{*}Layer/{*}Name')
        operations = [frozen, {**frozen, 'REQUEST': 'GetMap', 'LAYERS': name, 'STYLES': '', 'CRS': 'EPSG:4326',
            'BBOX': '45,15,55,25', 'WIDTH': '8', 'HEIGHT': '8', 'FORMAT': 'image/png'},
            {**frozen, 'REQUEST': 'GetLegendGraphic', 'LAYER': name, 'FORMAT': 'image/png'}]
        operations.append({**operations[1], 'REQUEST': 'GetFeatureInfo', 'QUERY_LAYERS': name, 'INFO_FORMAT': 'text/plain', 'I': '4', 'J': '4'})
        before = [self.get(path, params).content for params in operations[1:]]
        for arguments in (['submit', '--clock', '2026-10-19T05:00:00Z', '--hours', '4', '--fixture', 'overlap'], ['once']):
            result = subprocess.run([sys.executable, '-m', 'publication.worker', *arguments], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr[-1000:])
        latest, _, new_frozen = self.connection()
        self.assertNotEqual(new_frozen, frozen)
        retained = ET.fromstring(self.get(path, frozen).content)
        self.assertEqual(retained.findtext('.//{*}Dimension'), root.findtext('.//{*}Dimension'))
        self.assertEqual([self.get(path, params).content for params in operations[1:]], before)
        configuration, _, _ = retention.snapshot()
        older_runs = sorted({s['run'] for s in self.get('/api/v1/catalogue').json()['selections'] if s['fixture'] == 'actual'})
        self.assertTrue(older_runs)
        try:
            # Keep the old actual run available while the newer overlapping run
            # expires. Discovery must not fall back to that older forecast.
            retention.configure({**configuration, 'clock': '2026-12-01T00:00:00Z', 'demo_runs': [older_runs[0]]})
            for params in operations:
                self.get(path, {**params, **new_frozen}, expected=410)
            self.assertTrue(self.get('/api/v1/catalogue').json()['selections'])
            self.get(expected=404)
        finally:
            retention.configure(configuration)
        with tempfile.TemporaryDirectory() as directory:
            empty = Path(directory)
            plan = grib_sync.preview(empty, 'wms106-disposable', remove_all=True)
            withdrawn = grib_sync.apply(plan, empty, 'wms106-disposable', remove_all=True)
        for params in operations:
            self.get(path, params, expected=410)
        self.get(expected=404)
        # Upgrade an actual collected archive: the old schema has no model
        # column, and GC has already removed old catalogue rows and manifests.
        for arguments in (['submit', '--clock', '2026-10-19T05:00:00Z', '--hours', '1', '--fixture', 'overlap'], ['once']):
            result = subprocess.run([sys.executable, '-m', 'publication.worker', *arguments], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr[-1000:])
        retention.configure({**configuration, 'clock': '2026-10-19T06:00:00Z', 'reader_grace_seconds': 0})
        collected = retention.collect(apply=True)
        self.assertTrue(collected['removed'], 'Upgrade fixture requires physically collected historical roots')
        from publication.domain import database, ROOT
        removed_manifests = [row['root'] for row in collected['roots']
                             if row['state'] == 'expired' and not (ROOT / row['manifest_path']).exists()]
        self.assertTrue(removed_manifests, 'Upgrade fixture requires a collected tombstone without its manifest')
        with database() as cursor:
            cursor.execute('ALTER TABLE app.retention_roots DROP COLUMN model')
        retention.migrate()
        self.get()
        self.get(path, frozen, expected=410)
        Path('/evidence/common-wms-lifecycle.json').write_text(json.dumps({'status': 'passed',
            'retained_times': root.findtext('.//{*}Dimension'), 'latest_times': latest.findtext('.//{*}Dimension'),
            'expiry_operations': 4, 'withdrawal_operations': 4, 'withdrawal': withdrawn,
            'legacy_collected_tombstone_upgrade': removed_manifests}, indent=2, default=str))
