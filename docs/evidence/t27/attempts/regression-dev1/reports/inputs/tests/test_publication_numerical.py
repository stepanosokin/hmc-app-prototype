"""T10 contracts through the approved real-service gateway seam."""

import os
import json
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest

import requests


@unittest.skipUnless(os.environ.get('T4_HTTP') == '1', 'requires isolated publication services')
class NumericalContract(unittest.TestCase):
    base = 'http://gateway:8000'

    def get(self, path, expected=200, **kwargs):
        response = requests.get(self.base + path, timeout=90, **kwargs)
        self.assertEqual(response.status_code, expected, response.text[:300])
        return response

    def test_discovery_and_exact_position_share_native_point(self):
        catalogue = self.get('/api/v1/catalogue').json()
        selected = next(item for item in catalogue['selections'] if item['fixture'] == 'actual')
        collection = self.get(selected['collection']).json()
        self.assertEqual(collection['id'], selected['selection'])
        self.assertEqual(collection['dimensions']['valid_time'], [selected['valid_time']])
        self.assertEqual(collection['storageCrs'], 'urn:hmc:crs:icon-sphere-6371229')
        query = {key: selected[key] for key in ('run', 'revision')}
        query.update(coords='POINT(-23.5 29.5)', datetime=selected['valid_time'], **{'parameter-name': 'T_G', 'crs': collection['storageCrs']})
        response = self.get(selected['position'], params=query)
        self.assertEqual(response.headers['Content-Type'], 'application/vnd.cov+json')
        coverage = response.json()
        self.assertEqual(coverage['ranges']['T_G']['values'], [298.2274169921875])
        point_query = {key: selected[key] for key in ('selection', 'run', 'revision', 'valid_time')}
        point_query.update(layer=selected['field'], lon=-23.5, lat=29.5)
        point = self.get(selected['point'], params=point_query).json()
        self.assertEqual(coverage['selection'], point)
        self.assertEqual(point['identity']['revision'], selected['revision'])
        self.assertEqual(point['cell']['lon'], -23.5)
        metadata = self.get(selected['tiles']).json()
        self.assertEqual(collection['numeric_tiles']['url'], metadata['url'])
        Path('/evidence/t10-numerical.json').write_text(json.dumps({
            'status': 'passed', 'selection': selected, 'collection': collection,
            'coverage': coverage, 'point': point, 'tile_metadata': metadata}, indent=2))

    def selected(self):
        return next(item for item in self.get('/api/v1/catalogue').json()['selections']
                    if item['fixture'] == 'actual')

    def query(self, selected, **changes):
        return {**{key: selected[key] for key in ('run', 'revision')},
                'coords': 'POINT(-23.5 29.5)', 'datetime': selected['valid_time'],
                'parameter-name': 'T_G', **changes}

    def command(self, module, *args):
        result = subprocess.run([sys.executable, '-m', module, *map(str, args)],
                                capture_output=True, text=True, timeout=600)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def test_position_validation_axes_null_and_exact_selection(self):
        selected = self.selected()
        path = selected['position']
        outside = self.get(path, params=self.query(selected, coords='POINT(100 0)')).json()
        self.assertEqual(outside['ranges']['T_G']['values'], [None])
        self.assertEqual(outside['selection']['reason'], 'outside_coverage')
        self.assertIsNone(outside['selection']['cell'])
        swapped = self.get(path, params=self.query(selected, coords='POINT(29.5 -23.5)')).json()
        self.assertEqual(swapped['selection']['reason'], 'outside_coverage')
        # Independent WGS84 -> sphere latitude at (-23.5,29.5), h=0 is
        # 29.33535 degrees: it selects the southern edge cell, unlike native input.
        crs84 = self.get(path, params=self.query(selected, crs='http://www.opengis.net/def/crs/OGC/1.3/CRS84')).json()
        self.assertEqual(crs84['selection']['reason'], 'outside_coverage')
        for changes in ({'coords': 'POINT(nan 50)'}, {'coords': 'POINT(20 inf)'},
                        {'coords': 'POINT(20 91)'}, {'coords': 'POINT(20 50 1)'},
                        {'coords': 'MULTIPOINT(20 50)'}, {'datetime': 'bad'},
                        {'datetime': '2026-10-15T01:00:00Z/2026-10-15T02:00:00Z'},
                        {'crs': 'EPSG:4326'}, {'f': 'GeoJSON'}, {'z': '0'}):
            self.get(path, 400, params=self.query(selected, **changes))
        for changes in ({'datetime': '1900-01-01T00:00:00Z'}, {'run': 'missing'},
                        {'revision': '0'*64}, {'parameter-name': 'unknown'}):
            self.get(path, 404, params=self.query(selected, **changes))
        query = self.query(selected)
        self.get(path, 400, params=[*query.items(), ('coords', 'POINT(20 50)')])
        del query['datetime']
        self.get(path, 400, params=query)
        self.get('/ogc/collections/' + '0'*64, 404)
        self.get('/ogc/collections/' + '0'*64 + '/position', 404, params=self.query(selected))
        self.get('/ogc/collections/' + selected['selection'] + '/instances', 404)
        domain = {key: selected[key] for key in ('selection', 'run', 'revision', 'valid_time')}
        domain.update(layer=selected['field'], lon='nan', lat='50')
        self.get(selected['point'], 400, params=domain)
        domain.update(lon='20', valid_time='bad')
        self.get(selected['point'], 400, params=domain)

    def test_catalogue_hierarchy_openapi_and_protected_profile(self):
        selected = self.selected()
        self.assertEqual(self.get('/api/v1/modules').json()['modules'][0]['id'], 'meteorology')
        models = self.get('/api/v1/models').json()['models']
        self.assertIn(selected['model'], [item['id'] for item in models])
        runs = self.get('/api/v1/runs', params={'model': selected['model']}).json()['runs']
        self.assertIn(selected['run'], [item['id'] for item in runs])
        revisions = self.get('/api/v1/revisions', params={'model': selected['model'], 'run': selected['run']}).json()['revisions']
        self.assertIn(selected['revision'], [item['id'] for item in revisions])
        self.assertEqual(self.get('/ogc/conformance').json()['conformsTo'], [])
        landing = self.get('/ogc').json()
        for link in landing['links']:
            self.get(link['href'])
        spec = self.get('/api/v1/openapi.json').json()
        self.assertEqual(spec['openapi'], '3.0.3')
        self.assertIn('/ogc/collections/{selection}/position', spec['paths'])
        self.assertEqual(spec['paths']['/ogc/collections/{selection}/position']['get']['security'], [])
        self.assertIn(selected['selection'], [item['id'] for item in self.get('/ogc/collections').json()['collections']])
        with tempfile.TemporaryDirectory() as directory:
            for profile, expected in [('numeric', 200), ('gis', 403)]:
                key_path = Path(directory) / (profile + '.key')
                issued = json.loads(self.command('publication.access', 'create', '--organization', 't10-'+profile,
                    '--profile', profile, '--out', key_path))
                headers = {'Authorization': 'Bearer ' + key_path.read_text().strip()}
                for path, params in [(selected['collection'], {}), (selected['position'], self.query(selected)),
                                     ('/api/v1/openapi.json', {})]:
                    self.get('/org'+path, 401, params=params)
                    self.get('/org'+path, expected, params=params, headers=headers)
                if expected == 200:
                    org_spec = self.get('/org/api/v1/openapi.json', headers=headers).json()
                    self.assertEqual(org_spec['paths']['/ogc/collections/{selection}/position']['get']['security'],
                                     [{'bearerAuth': []}, {'apiKey': []}])
                    org = self.get('/org'+selected['collection'], headers=headers).json()
                    self.assertTrue(org['data_queries']['position']['link']['href'].startswith('/org/ogc/'))
                    self.assertTrue(org['numeric_tiles']['url'].startswith('/org/api/'))
                    self.command('publication.access', 'revoke', '--id', str(issued['id']))
                    self.get('/org'+selected['position'], 401, params=self.query(selected), headers=headers)

    def test_synthetic_native_nodata_is_null_through_published_gateway(self):
        # Fixture setup uses the existing real decoder and publication gate. Only
        # the observations/assertions use the consumer HTTP seam.
        import uuid
        from decoder.storage import build
        from decoder.sampling import ManifestSampler
        from publication.domain import ROOT, database
        from publication.worker import submit, publish_batch
        clock = '2026-10-19T05:00:00Z'
        job_id = submit(clock)
        with database() as cursor:
            cursor.execute('SELECT * FROM app.jobs WHERE id=%s', (job_id,))
            job = cursor.fetchone()
        attempt = ROOT / job_id / uuid.uuid4().hex
        attempt.mkdir(parents=True)
        build(Path('/input/ICON_EU_T_G_2026101500.grib2'), attempt / 'numerical', clock, synthetic_nodata=True)
        numerical = ManifestSampler(attempt / 'numerical/manifest.json')
        numerical.manifest['fixture'] = 'synthetic-nodata'
        manifest, _, _ = publish_batch(job, attempt, numerical, commit=True)
        selected = next(item for item in self.get('/api/v1/catalogue').json()['selections']
                        if item['selection'] == manifest['selection'])
        self.assertEqual(selected['fixture'], 'synthetic-nodata')
        response = self.get(selected['position'], params=self.query(selected)).json()
        self.assertEqual(response['ranges']['T_G']['values'], [None])
        self.assertEqual(response['selection']['reason'], 'native_nodata')
        self.assertEqual(response['selection']['cell']['row'], 0)
        self.assertEqual(response['selection']['cell']['column'], 0)
        # A real missing array on a warmed immutable sampler is a transient
        # storage failure, not an unknown selection. No fake backend is used.
        array = numerical.root / numerical.manifest['fields'][0]['zarr'] / 'longitude'
        for target in (array, array / '0'):
            unavailable = target.with_name(target.name + '-unavailable')
            target.rename(unavailable)
            try:
                failed = self.get(selected['position'], 503, params=self.query(selected))
                self.assertEqual(failed.json(), {'code': 'Unavailable', 'description': 'published service temporarily unavailable'})
                self.assertIn('Retry-After', failed.headers)
                point_query = {key: selected[key] for key in ('selection', 'run', 'revision', 'valid_time')}
                point_query.update(layer=selected['field'], lon=-23.5, lat=29.5)
                self.get(selected['point'], 503, params=point_query)
            finally:
                unavailable.rename(target)
            self.get(selected['position'], params=self.query(selected))
        # Eligibility must override a successfully warmed metadata/point reader.
        self.get(selected['collection'])
        self.command('publication.retention', 'configure', '--clock', '2026-11-14T00:00:00Z')
        try:
            self.get(selected['collection'], 410)
            self.get(selected['position'], 410, params=self.query(selected))
            self.get(selected['tiles'], 410)
            self.assertEqual(self.get('/ogc/collections').json()['collections'], [])
        finally:
            self.command('publication.retention', 'configure', '--clock', clock)
        Path('/evidence/t10-faults.json').write_text(json.dumps({
            'status': 'passed', 'fixture': 'synthetic-nodata', 'nodata': response,
            'missing_array': 503, 'missing_chunk': 503, 'restored': 200,
            'expired_collection_position_tiles': 410, 'expired_collections': [],
            'service_error': failed.json()}, indent=2))

    def test_position_budget_rejection_preserves_status_and_retry(self):
        selected = self.selected()
        with tempfile.TemporaryDirectory() as directory:
            key_path = Path(directory) / 'quota.key'
            self.command('publication.access', 'create', '--organization', 't10quota',
                         '--profile', 'numeric', '--out', key_path)
            headers = {'Authorization': 'Bearer ' + key_path.read_text().strip()}
            path = '/org' + selected['position']
            self.get(path, headers=headers, params=self.query(selected))
            limits = Path(directory) / 'limits.json'
            limits.write_text(json.dumps({'requests': 1}))
            self.command('publication.budgets', 'configure', '--organization', 't10quota', '--file', limits)
            rejected = self.get(path, 429, headers=headers, params=self.query(selected))
            self.assertEqual(rejected.json()['code'], 'TooManyRequests')
            self.assertIn('Retry-After', rejected.headers)
            self.assertEqual(rejected.headers['Cache-Control'], 'no-store')

