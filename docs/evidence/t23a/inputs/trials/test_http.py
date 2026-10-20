"""Agreed seam: real HTTP through the isolated gateway, no adapter mocks."""

import json
import os
import unittest
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path('/fixtures')
GATEWAY = os.environ.get('TRIAL_GATEWAY', 'http://gateway:8000')


def request(path, query=None, *, key=None, headers=None):
    tokens = json.loads((ROOT / 'secrets.json').read_text())
    req = Request(GATEWAY + path + ('?' + urlencode(query) if query else ''),
                  headers={'X-API-Key': tokens['main'] if key is None else key, **(headers or {})})
    try:
        response = urlopen(req, timeout=15)
    except HTTPError as error:
        response = error
    with response:
        return response.status, json.loads(response.read()), dict(response.headers)


def replace_json(path, value):
    temporary = path.with_suffix('.test-pending')
    temporary.write_text(json.dumps(value, sort_keys=True, separators=(',', ':')))
    temporary.replace(path)


class HTTPContract(unittest.TestCase):
    def test_actual_sample_native_point_is_equal_through_both_adapters(self):
        identity = json.loads((ROOT / 'index.json').read_text())['actual']
        query = {**identity, 'layer': 'surface-temperature', 'valid_time': '2026-10-15T01:00:00Z',
                 'lon': 336.5, 'lat': 29.5}
        results = []
        for candidate in ['narrow', 'pygeoapi']:
            status, result, _ = request(f'/{candidate}/api/v1/point', query)
            self.assertEqual(status, 200, result)
            self.assertEqual(result['value'], 298.2274169921875)
            self.assertEqual(result['cell'], {'row': 0, 'column': 0, 'lon': -23.5, 'lat': 29.5})
            self.assertEqual(result['units'], 'K')
            self.assertEqual(result['method'], 'native_cell')
            self.assertEqual(result['run'], identity['run'])
            self.assertEqual(result['revision'], identity['revision'])
            results.append(result)
        self.assertEqual(*results)

    def test_edr_position_retains_all_native_values_and_exact_selection(self):
        identity = json.loads((ROOT / 'index.json').read_text())['actual']
        baseline = json.loads(Path('/app/baseline-a1.json').read_text())['messages']
        for message in baseline:
            for cell in message['grid']['cell_centres']:
                query = {**identity, 'datetime': message['valid_time'], 'parameter-name': 'T_G',
                         'coords': f"POINT({cell['lon']} {cell['lat']})", 'f': 'json'}
                results = []
                for candidate in ['narrow', 'pygeoapi']:
                    status, coverage, _ = request(f'/{candidate}/ogc/collections/surface-temperature/position', query)
                    self.assertEqual(status, 200, coverage)
                    self.assertEqual(coverage['type'], 'Coverage')
                    self.assertEqual(coverage['ranges']['T_G']['values'], [cell['value']])
                    self.assertEqual(coverage['selection']['run'], identity['run'])
                    self.assertEqual(coverage['selection']['revision'], identity['revision'])
                    self.assertEqual(coverage['selection']['valid_time'], message['valid_time'])
                    self.assertEqual(coverage['domain']['referencing'][0]['system']['id'], 'urn:hmc:crs:icon-sphere-6371229')
                    results.append(coverage)
                self.assertEqual(*results)

    def test_discovery_is_scoped_to_the_exact_revision(self):
        identities = json.loads((ROOT / 'index.json').read_text())
        documents = []
        for candidate in ['narrow', 'pygeoapi']:
            status, document, _ = request(f'/{candidate}/ogc/collections', identities['actual'])
            self.assertEqual(status, 200, document)
            self.assertEqual(len(document['collections']), 1)
            metadata = document['collections'][0]['selection']
            self.assertEqual(metadata['revision'], identities['actual']['revision'])
            self.assertEqual(len(metadata['valid_times']), 24)
            self.assertEqual(metadata['valid_times'][0], '2026-10-15T01:00:00Z')
            self.assertEqual(metadata['valid_times'][-1], '2026-10-16T00:00:00Z')
            self.assertEqual(metadata['query_types'], ['position'])
            documents.append(metadata)
        self.assertEqual(*documents)

    def test_masks_outside_boundaries_and_unavailable_selections_never_fall_back(self):
        identities = json.loads((ROOT / 'index.json').read_text())
        for candidate in ['narrow', 'pygeoapi']:
            base = {**identities['actual'], 'layer': 'surface-temperature',
                    'valid_time': '2026-10-15T01:00:00Z', 'lon': -23.5, 'lat': 29.5}
            cases: list[tuple[dict, int]] = [({'run': 'another-run'}, 404), ({'revision': 'another-revision'}, 404),
                                             ({'layer': '2t'}, 404), ({'valid_time': '2026-10-15T00:00:00Z'}, 404),
                                             ({'valid_time': 'nonsense'}, 400), ({'lon': 'nan'}, 400),
                                             ({'lat': 91}, 400), ({'valid_time': '2026-10-15T01:00:00Z/2026-10-15T02:00:00Z'}, 400)]
            for changes, expected_status in cases:
                status, result, _ = request(f'/{candidate}/api/v1/point', {**base, **changes})
                self.assertEqual(status, expected_status, result)
                self.assertNotIn('value', result)
            for lon, lat in [(-23.531251, 29.5), (62.53125, 29.5), (0, 70.53125), (0, 29.468749)]:
                status, result, _ = request(f'/{candidate}/api/v1/point', {**base, 'lon': lon, 'lat': lat})
                self.assertEqual(status, 200)
                self.assertIsNone(result['value'])
                self.assertEqual(result['reason'], 'outside_coverage')
            _, result, _ = request(f'/{candidate}/api/v1/point', {**base, 'lat': 29.53125})
            self.assertEqual(result['value'], 298.2479248046875)
            _, result, _ = request(f'/{candidate}/api/v1/point', {**base, **identities['masked']})
            self.assertIsNone(result['value'])
            self.assertEqual(result['reason'], 'native_nodata')
            status, coverage, _ = request(f'/{candidate}/ogc/collections/surface-temperature/position',
                                         {**identities['masked'], 'datetime': base['valid_time'],
                                          'coords': 'POINT(-23.5 29.5)', 'parameter-name': 'T_G'})
            self.assertEqual(status, 200)
            self.assertEqual(coverage['ranges']['T_G']['values'], [None])
            self.assertEqual(coverage['selection']['reason'], 'native_nodata')

    def test_policy_precedes_cached_delivery_and_accounts_for_rejections(self):
        import hashlib
        tokens = json.loads((ROOT / 'secrets.json').read_text())
        policy_path = ROOT / 'policy.json'
        original = json.loads(policy_path.read_text())
        identity = json.loads((ROOT / 'index.json').read_text())['actual']
        try:
            for candidate in ['narrow', 'pygeoapi']:
                policy = json.loads(json.dumps(original))
                policy['keys'][hashlib.sha256(tokens['limited'].encode()).hexdigest()]['organization'] = uuid.uuid4().hex
                replace_json(policy_path, policy)
                path = f'/{candidate}/ogc/collections'
                status, _, headers = request(path, identity, headers={'X-Trial-Cache': 'on'})
                self.assertEqual(status, 200)
                status, _, headers = request(path, identity, key=tokens['limited'], headers={'X-Trial-Cache': 'on'})
                self.assertEqual(status, 200)
                self.assertEqual(headers.get('X-Cache'), 'HIT')
                self.assertEqual(request(path, identity, key=tokens['limited'], headers={'X-Trial-Cache': 'on'})[0], 429)
                self.assertEqual(request(path, identity, key='invalid-key')[0], 401)
                self.assertEqual(request(path, identity, key=tokens['revocable'], headers={'X-Trial-Cache': 'on'})[0], 200)
                policy['keys'][hashlib.sha256(tokens['revocable'].encode()).hexdigest()]['enabled'] = False
                replace_json(policy_path, policy)
                self.assertEqual(request(path, identity, key=tokens['revocable'], headers={'X-Trial-Cache': 'on'})[0], 403)
                self.assertEqual(request(f'/{candidate}/fixtures/actual/manifest.json')[0], 404)
            status, usage, _ = request('/usage', headers={'X-Trial-Control': tokens['control']})
            self.assertEqual(status, 200)
            self.assertTrue({200, 401, 403, 429}.issubset({row['status'] for row in usage['requests']}))
            self.assertTrue(any(row['cache'] == 'HIT' for row in usage['requests']))
            for token in tokens.values():
                self.assertNotIn(token, json.dumps(usage))
        finally:
            replace_json(policy_path, original)

    def test_new_revision_visibility_and_failed_refresh_preserve_old_readers(self):
        identities = json.loads((ROOT / 'index.json').read_text())
        catalog_path = ROOT / 'catalog.json'
        initial = ['actual/manifest.json', 'masked/manifest.json']
        try:
            replace_json(catalog_path, initial)
            for candidate in ['narrow', 'pygeoapi']:
                self.assertEqual(request(f'/{candidate}/ogc/collections', identities['revised'])[0], 404)
            replace_json(catalog_path, initial + ['actual/revised.json'])
            for candidate in ['narrow', 'pygeoapi']:
                status, doc, _ = request(f'/{candidate}/ogc/collections', identities['revised'])
                self.assertEqual(status, 200, doc)
                self.assertEqual(len(doc['collections'][0]['selection']['valid_times']), 12)
                status, old, _ = request(f'/{candidate}/ogc/collections', identities['actual'])
                self.assertEqual(status, 200)
                self.assertEqual(len(old['collections'][0]['selection']['valid_times']), 24)
            replace_json(catalog_path, initial + ['actual/missing.json'])
            for candidate in ['narrow', 'pygeoapi']:
                self.assertEqual(request(f'/{candidate}/ogc/collections', identities['actual'])[0], 200)
                self.assertEqual(request(f'/{candidate}/ogc/collections', identities['revised'])[0], 200)
        finally:
            replace_json(catalog_path, initial)

    def test_edr_errors_match_domain_absence_and_profile_is_bounded(self):
        identity = json.loads((ROOT / 'index.json').read_text())['actual']
        base = {**identity, 'datetime': '2026-10-15T01:00:00Z', 'coords': 'POINT(-23.5 29.5)', 'parameter-name': 'T_G'}
        for candidate in ['narrow', 'pygeoapi']:
            path = f'/{candidate}/ogc/collections/surface-temperature/position'
            for changes, expected in [({'datetime': '2026-10-15T00:00:00Z'}, 404), ({'revision': 'missing'}, 404),
                                      ({'parameter-name': '2t'}, 404), ({'coords': 'POINT(nan 29.5)'}, 400),
                                      ({'coords': 'LINESTRING(0 0,1 1)'}, 400), ({'crs': 'EPSG:4326'}, 400),
                                      ({'f': 'html'}, 400), ({'datetime': 'invalid'}, 400)]:
                status, result, _ = request(path, {**base, **changes})
                self.assertEqual(status, expected, result)
                self.assertNotIn('ranges', result)
            self.assertEqual(request(path, {**base, 'crs': 'urn:hmc:crs:icon-sphere-6371229'})[0], 200)
            for suffix in ['instances', 'cube', 'trajectory']:
                self.assertEqual(request(f'/{candidate}/ogc/collections/surface-temperature/{suffix}', identity)[0], 404)

    def test_cached_revision_becomes_unavailable_after_valid_catalogue_removal(self):
        identity = json.loads((ROOT / 'index.json').read_text())['actual']
        initial = ['actual/manifest.json', 'masked/manifest.json']
        try:
            for candidate in ['narrow', 'pygeoapi']:
                replace_json(ROOT / 'catalog.json', initial)
                path = f'/{candidate}/ogc/collections'
                self.assertEqual(request(path, identity, headers={'X-Trial-Cache': 'on'})[0], 200)
                replace_json(ROOT / 'catalog.json', ['masked/manifest.json'])
                self.assertEqual(request(path, identity)[0], 404)
                self.assertEqual(request(path, identity, headers={'X-Trial-Cache': 'on'})[0], 404)
                # The same invalid input can preserve different accepted
                # catalogues depending on the last successful refresh.
                invalid = initial + ['actual/missing.json']
                replace_json(ROOT / 'catalog.json', initial)
                self.assertEqual(request(path, identity)[0], 200)
                replace_json(ROOT / 'catalog.json', invalid)
                self.assertEqual(request(path, identity, headers={'X-Trial-Cache': 'on'})[0], 200)
                replace_json(ROOT / 'catalog.json', ['masked/manifest.json'])
                self.assertEqual(request(path, identity)[0], 404)
                replace_json(ROOT / 'catalog.json', invalid)
                self.assertEqual(request(path, identity, headers={'X-Trial-Cache': 'on'})[0], 404)
        finally:
            replace_json(ROOT / 'catalog.json', initial)


if __name__ == '__main__':
    unittest.main()
