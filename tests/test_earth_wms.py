"""Real GeoServer/gateway checks, only on an explicitly isolated test stand."""
import io
import json
import os
import tempfile
import unittest
from pathlib import Path

import numpy as np
import requests
from PIL import Image

from decoder.palettes import rgb, select


@unittest.skipUnless(os.environ.get('T77_HTTP') == '1', 'requires isolated earth77 services')
class EarthWms(unittest.TestCase):
    def setUp(self):
        from publication.access import issue
        with tempfile.TemporaryDirectory() as directory:
            key = Path(directory) / 'key'
            issue('earth77-reader', 'all', key)
            self.headers = {'X-API-Key': key.read_text().strip()}

    def get(self, path, params=None):
        response = requests.get('http://gateway:8000'+path, params=params, headers=self.headers, timeout=90)
        self.assertEqual(response.status_code, 200, response.text[:100] if response.status_code != 200 else '')
        return response

    def inspect(self, selection, expected):
        from publication.domain import resolve, sampler
        from decoder.grib_crs import transform
        from pyproj import Transformer
        manifest = resolve(selection)
        item = sampler(manifest).manifest['fields'][0]
        palette = select(item['metadata'])
        assert palette is not None
        choices = self.get('/org/api/v1/catalogue').json()['selections']
        chosen = next(s for s in choices if s['selection'] == selection)
        base = {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'TIME': chosen['valid_time']}
        grid = item['metadata']['grid']
        west, south, _, _ = grid['outer_cell_edges_wsen']
        dx, dy = grid['spacing_degrees_xy']
        lon, lat = transform(item['metadata']['source_crs'], west+dx*1.5, south+dy*1.5, inverse=True)
        mx, my = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True).transform(lon, lat)
        params = {**base, 'REQUEST': 'GetMap', 'LAYERS': 'field', 'STYLES': '', 'CRS': 'EPSG:3857',
                  'BBOX': f'{mx-150},{my-150},{mx+150},{my+150}', 'WIDTH': 3, 'HEIGHT': 3,
                  'FORMAT': 'image/png', 'TRANSPARENT': 'true'}
        image = Image.open(io.BytesIO(self.get(chosen['wms'], params).content)).convert('RGBA')
        pixel = image.getpixel((1, 1))
        assert isinstance(pixel, tuple)
        expected_rgb = rgb(np.array([expected]), palette)[0]
        self.assertLessEqual(float(np.abs(np.asarray(pixel[:3])-expected_rgb).max()), 2.)
        self.assertAlmostEqual(pixel[3], 204, delta=1)
        identified = self.get(chosen['wms'], {**params, 'REQUEST': 'GetFeatureInfo', 'QUERY_LAYERS': 'field',
                                            'I': 1, 'J': 1, 'INFO_FORMAT': 'text/plain'})
        import re
        value = re.search(r'GRAY_INDEX\s*=\s*([0-9.eE+-]+)', identified.text)
        assert value is not None
        self.assertAlmostEqual(float(value[1]), expected, delta=.0001)
        legend_bytes = self.get(chosen['wms'], {**base, 'REQUEST': 'GetLegendGraphic',
                      'LAYER': 'field', 'STYLE': 'raster', 'FORMAT': 'image/png'}).content
        Path('/evidence/earth77-'+palette['id']+'-legend.png').write_bytes(legend_bytes)
        legend = Image.open(io.BytesIO(legend_bytes))
        self.assertEqual(legend.size, (256, 72))
        observed = self.get(chosen['native_display']).json()['palette']
        self.assertEqual(observed, palette)
        return {'selection': selection, 'palette': palette['id'], 'pixel': pixel, 'expected_rgb': expected_rgb.tolist(),
                'identify': float(value[1]), 'legend_size': legend.size}

    def test_physical_colours_and_native_speed_through_public_gateway(self):
        from test_field_nodata import PublishedNoData
        seed = PublishedNoData().seed
        observations = []
        cases: list[tuple[int, int, float, dict]] = [
            (0, 0, 273.15, {'typeOfLevel': 'heightAboveGround', 'level': 2}),
            (0, 0, 150., {'typeOfLevel': 'heightAboveGround', 'level': 2}),
            (1, 1, 75., {'typeOfLevel': 'heightAboveGround', 'level': 2}),
            (1, 1, 200., {'typeOfLevel': 'heightAboveGround', 'level': 2}),
            (3, 1, 101300., {'typeOfLevel': 'meanSea'}),
            (3, 1, 110000., {'typeOfLevel': 'meanSea'}),
            (1, 8, 10., {'centre': 7, 'tablesVersion': 35, 'stepType': 'accum', 'startStep': 0, 'endStep': 3})]
        for category, number, value, keys in cases:
            selection, _ = seed([value]*12, category=category, number=number, **keys)
            observations.append(self.inspect(selection, value))
        from publication import revisions, worker
        from publication.domain import ROOT, database
        from publication.wind_speed import add
        import uuid
        entries = {}
        for number, value in [(2, 3.), (3, 4.)]:
            selection, batch = seed([value]*12, category=2, number=number, typeOfLevel='heightAboveGround', level=10)
            with database() as cursor:
                cursor.execute('SELECT manifest_path,manifest_sha256 FROM app.revisions WHERE revision=%s', (selection.split('.')[0],))
                row = cursor.fetchone()
            root = revisions.load_revision(row['manifest_path'], row['manifest_sha256'])
            entries.update({entry['key']: entry for entry in root['batches']})
        identifier = worker.submit('2026-10-19T06:00:00Z', {'source_profile': 'grib2-fields', 'fixture': 'actual'})
        with database() as cursor:
            cursor.execute('SELECT * FROM app.jobs WHERE id=%s', (identifier,))
            job = cursor.fetchone()
        directory = ROOT / identifier / uuid.uuid4().hex
        directory.mkdir(parents=True)
        combined = add(job, entries, directory)
        speed = next(entry for key, entry in combined.items() if key not in entries)
        from decoder.sampling import file_hash
        source = next(p for p in Path('/evidence').glob('nodata-*.grib2') if file_hash(p) == batch['source']['sha256'])
        revision = revisions.commit_revision(job, directory, batch['identity']['run'], None, combined,
                                              speed['key'], 1, source, batch['source']['sha256'])
        worker.transition(identifier, 'published')
        observations.append(self.inspect(revision+'.'+speed['key'], 5.))
        self.assertEqual(len(combined), 3)
        Path('/evidence/earth77-wms.json').write_text(json.dumps({'status': 'passed', 'observations': observations}), encoding='utf-8')
