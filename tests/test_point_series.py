"""Forecast point series through the real public gateway."""

import os
import unittest
from collections import defaultdict

import requests


@unittest.skipUnless(os.environ.get('T4_HTTP') == '1', 'requires a published Compose fixture')
class ForecastPointSeries(unittest.TestCase):
    base = os.environ.get('POINT_SERIES_GATEWAY', 'http://gateway:8000') + '/api/v1'
    position = {'lon': os.environ.get('T114_POINT_LON', '20'), 'lat': os.environ.get('T114_POINT_LAT', '50')}
    crs = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84'

    group_keys = ('model', 'run', 'revision', 'field', 'level', 'native_grid_sha256', 'member')

    def groups(self):
        catalogue = requests.get(self.base + '/catalogue', timeout=30)
        catalogue.raise_for_status()
        groups: dict[tuple, list[dict]] = defaultdict(list)
        for item in catalogue.json()['selections']:
            groups[tuple(item[key] for key in self.group_keys)].append(item)
        return [sorted(group, key=lambda item: item['valid_time']) for group in groups.values()]

    def point(self, selected, position):
        params = {key: selected[key] for key in ('selection', 'run', 'revision', 'valid_time')}
        point = requests.get(self.base + '/point', params={**params, **position,
                             'layer': selected['field'], 'crs': self.crs}, timeout=30)
        point.raise_for_status()
        return point.json()

    def test_scalar_series_matches_published_point_values(self):
        expected = max((group for group in self.groups() if group[0]['field'] == 'T_G:surface:0'), key=len)
        anchor = expected[0]
        series = requests.get(self.base + '/point-series', params={'selection': anchor['selection'], **self.position},
                              timeout=32)
        self.assertEqual(series.status_code, 200, series.text[:300])
        self.assertIn('X-Request-ID', series.headers)
        payload = series.json()
        self.assertNotIn('wind', payload)
        self.assertEqual([entry['time'] for entry in payload['scalar']], [item['valid_time'] for item in expected])
        for entry, selected in zip(payload['scalar'], expected, strict=True):
            with self.subTest(time=entry['time']):
                self.assertEqual(entry['result'], self.point(selected, self.position))

    def test_invalid_or_protected_query_uses_gateway_policy(self):
        query = {'selection': '0'*64, **self.position}
        for params in ({**query, 'wind_u': '0'*64}, {**query, 'lat': 'nan'},
                       {**query, 'from': 'not a time'}, {**query, 'other': 'x'}):
            with self.subTest(params=params):
                response = requests.get(self.base + '/point-series', params=params, timeout=30)
                self.assertEqual(response.status_code, 400, response.text)
                self.assertIn('X-Request-ID', response.headers)
        response = requests.get(self.base.replace('/api/v1', '/org/api/v1') + '/point-series',
                                params=query, timeout=30)
        self.assertEqual(response.status_code, 401, response.text)

    @unittest.skipUnless(os.environ.get('T114_STORAGE_FAULT') == '1', 'requires an isolated multi-time fixture')
    def test_warm_series_retains_good_times_after_array_or_chunk_loss(self):
        from publication.domain import resolve, sampler

        group = max((group for group in self.groups() if group[0]['field'] == 'T_G:surface:0'), key=len)
        self.assertGreater(len(group), 1)
        query = {'selection': group[0]['selection'], **self.position}

        def series(params):
            result = requests.get(self.base + '/point-series', params=params, timeout=32)
            self.assertEqual(result.status_code, 200, result.text[:300])
            return result.json()['scalar']

        baseline = series(query)
        self.assertEqual(len(baseline), len(group))
        self.assertTrue(all(row['status'] == 'sampled' and row['result']['value'] is not None for row in baseline))
        numerical = sampler(resolve(group[-1]['selection']))
        array = numerical.root / numerical.manifest['fields'][0]['zarr'] / 'longitude'
        suffix = {**query, 'from': group[-1]['valid_time']}
        failure = {'time': group[-1]['valid_time'], 'status': 'error'}
        for target in (array, array / '0'):
            self.assertEqual(series(suffix), baseline[-1:])
            moved = target.with_name(target.name + '-series-test')
            target.rename(moved)
            try:
                self.assertEqual(series(suffix), [failure])
                partial = series(query)
                self.assertEqual(partial[:-1], baseline[:-1])
                self.assertEqual(partial[-1], failure)
            finally:
                moved.rename(target)
            self.assertEqual(series(suffix), baseline[-1:])

    @unittest.skipUnless(os.environ.get('T114_WIND') == '1', 'requires the published U/V fixture')
    def test_combined_series_matches_both_canonical_components(self):
        groups = self.groups()
        model = os.environ.get('T114_MODEL')
        u_group = max((group for group in groups if group[0].get('wind_axis') == 'u'
                       and (model is None or group[0]['model'] == model)), key=len)
        u = u_group[0]
        keys = ('model', 'run', 'revision', 'level', 'native_grid_sha256', 'member', 'units', 'wind_pair')
        v_group = next(group for group in groups if group[0].get('wind_axis') == 'v'
                       and all(group[0][key] == u[key] for key in keys))
        u_by_time = {item['valid_time']: item for item in u_group}
        v_by_time = {item['valid_time']: item for item in v_group}
        valid = min(u_by_time.keys() & v_by_time.keys())
        scalar = next(group for group in groups if group[0]['revision'] == u['revision']
                      and group[0].get('wind_axis') is None)
        query = {'selection': scalar[0]['selection'], 'wind_u': u_by_time[valid]['selection'],
                 'wind_v': v_by_time[valid]['selection'], **self.position}
        response = requests.get(self.base + '/point-series', params=query, timeout=32)
        self.assertEqual(response.status_code, 200, response.text[:300])
        payload = response.json()
        self.assertEqual([entry['time'] for entry in payload['scalar']], [item['valid_time'] for item in scalar])
        self.assertEqual([entry['time'] for entry in payload['wind']], sorted(u_by_time.keys() | v_by_time.keys()))
        values = 0
        for row in payload['wind']:
            valid = row['time']
            with self.subTest(time=valid):
                if valid not in u_by_time or valid not in v_by_time:
                    self.assertEqual(row['status'], 'missing')
                    continue
                self.assertEqual(row['status'], 'sampled')
                results = [row[axis]['result'] for axis in ('u', 'v')]
                if all(item['value'] is not None and item['cell'] is not None for item in results):
                    values += 1
                for component, selected in [('u', u_by_time[valid]), ('v', v_by_time[valid])]:
                    canonical = self.point(selected, self.position)
                    result = row[component]['result']
                    self.assertEqual(result, {key: canonical[key] for key in result})
        self.assertGreater(values, 0, 'Fixture must actually sample finite U/V in the native footprint')
