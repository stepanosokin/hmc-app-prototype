"""T12/M3: one protected selection across real numerical, tile and GIS clients."""

import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import unittest
import xml.etree.ElementTree as ET

import requests

from decoder.storage import bounded_frames, decoded_arrays
from publication.access import issue
from publication.compare import reference
from publication.tiles import decode


@unittest.skipUnless(os.environ.get('T12_HTTP') == '1', 'requires isolated T12 Compose services')
class ProtectedPublication(unittest.TestCase):
    base = 'http://gateway:8000'
    clock = '2026-10-19T05:00:00Z'

    def command(self, module, *args):
        result = subprocess.run([sys.executable, '-m', module, *map(str, args)],
                                capture_output=True, text=True, timeout=600)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout) if result.stdout.strip().startswith('{') else result.stdout.strip()

    def get(self, path, params=None, expected=200, token=None, **kwargs):
        response = requests.get(self.base + path, params=params,
            headers={'X-API-Key': token if token is not None else self.token}, timeout=90, **kwargs)
        self.assertEqual(response.status_code, expected, path)
        self.requests.append({'request_id': response.headers['X-Request-ID'],
                              'status': expected, 'bytes': len(response.content)})
        if expected >= 400:
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
        return response

    def catalogue(self):
        return self.get('/org/api/v1/catalogue').json()['selections']

    def queries(self, item, lon=-23.5, lat=29.5):
        return ({**{k: item[k] for k in ('selection', 'run', 'revision', 'valid_time')},
                 'layer': item['field'], 'lon': lon, 'lat': lat},
                {**{k: item[k] for k in ('run', 'revision')}, 'coords': f'POINT({lon} {lat})',
                 'datetime': item['valid_time'], 'parameter-name': 'T_G'})

    def caps(self, item):
        response = self.get(item['wms'], {'SERVICE': 'WMS', 'REQUEST': 'GetCapabilities', 'VERSION': '1.3.0'})
        root = ET.fromstring(response.content)
        self.assertEqual([n.text for n in root.findall('.//{*}Dimension')], [','.join(item['valid_times'])])
        hrefs = [v for node in root.iter() for k, v in node.attrib.items() if k.endswith('}href')]
        self.assertTrue(hrefs)
        self.assertTrue(all(v.startswith(item['wms'] + '?') for v in hrefs))

    def check_selection(self, item, *, tiles=True):
        hour = int(item['valid_time'][11:13]) or 24
        baseline = self.baseline[hour-1]['grid']['cell_centres']
        correction = 1 if item['fixture'] == 'correction' else 0
        observations = []
        for cell in baseline:
            lon, lat = cell['lon'], cell['lat']
            pq, eq = self.queries(item, lon, lat)
            point = self.get(item['point'], pq).json()
            coverage = self.get(item['position'], eq).json()
            self.assertEqual(coverage['selection'], point)
            self.assertEqual(point['value'], cell['value'] + correction)
            for key in ('run', 'revision', 'valid_time', 'field'):
                self.assertEqual(point['identity'][key], item[key])
            # Independent native sphere -> WGS84 latitude at native height zero.
            gx = lon * math.pi / 180 * 6378137
            # WGS84 geodetic latitude at radius 6371229 (same approved datum hypothesis).
            from pyproj import Transformer
            geodetic = Transformer.from_pipeline('+proj=pipeline +step +proj=cart +R=6371229 '
                '+step +inv +proj=cart +ellps=WGS84')
            _, gy, _ = geodetic.transform(lon, lat, 0.)
            gy = math.log(math.tan(math.pi/4 + math.radians(gy)/2)) * 6378137
            params = {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetFeatureInfo',
                'LAYERS': 'temperature', 'QUERY_LAYERS': 'temperature', 'STYLES': '',
                'TIME': item['valid_time'], 'CRS': 'EPSG:3857',
                'BBOX': f'{gx-10},{gy-10},{gx+10},{gy+10}', 'WIDTH': 3, 'HEIGHT': 3,
                'I': 1, 'J': 1, 'FORMAT': 'image/png', 'INFO_FORMAT': 'text/plain'}
            wms = self.get(item['wms'], params)
            match = re.search(r'GRAY_INDEX\s*=\s*([^\s]+)', wms.text)
            self.assertIsNotNone(match)
            assert match is not None
            self.assertAlmostEqual(float(match[1]), point['value'], delta=.0001)
            observations.append({'native': [lon, lat], 'value_K': point['value'], 'wms_K': float(match[1])})
        pq, eq = self.queries(item, 100, 0)
        point = self.get(item['point'], pq).json()
        self.assertIsNone(point['value'])
        self.assertEqual(self.get(item['position'], eq).json()['selection'], point)
        self.caps(item)
        collection = self.get(item['collection']).json()
        self.assertEqual(collection['id'], item['selection'])
        self.assertEqual(collection['dimensions']['valid_time'], [item['valid_time']])
        metadata = self.get(item['tiles']).json()
        for key in ('run', 'revision', 'valid_time', 'field'):
            self.assertEqual(metadata['identity'][key], item[key])
        self.assertEqual(collection['numeric_tiles']['url'], metadata['url'])
        tile_reports = []
        if tiles:
            for z, x, y in ((0, 0, 0), (3, 4, 2), (4, 8, 5)):
                path = metadata['url'].replace('{z}', str(z)).replace('{x}', str(x)).replace('{y}', str(y))
                response = self.get(path)
                values, mask = decode(response.content, 'f32')
                digest = hashlib.sha256(response.content).hexdigest()
                self.assertEqual(response.headers['ETag'], '"' + digest + '"')
                maximum, valid_count, missing_count = 0., 0, 0
                for row in (0, 1, 64, 128, 192, 256, 257):
                    for col in (0, 1, 64, 128, 192, 256, 257):
                        lon = (x*256+col-.5)/(256*2**z)*360-180
                        lon = (lon+180) % 360-180
                        latitude = math.atan(math.sinh(math.pi*(1-2*(y*256+row-.5)/(256*2**z))))
                        lat = math.degrees(math.atan((1-0.0066943799901413165)*math.tan(latitude)))
                        expected = reference(self.raw[hour], lon, lat)
                        self.assertEqual(bool(mask[row, col]), expected is not None)
                        if expected is None:
                            missing_count += 1
                            self.assertEqual(values[row, col], 0)
                        else:
                            valid_count += 1
                            maximum = max(maximum, abs(float(values[row, col]) - expected - correction))
                self.assertLessEqual(maximum, .001)
                tile_reports.append({'zxy': [z, x, y], 'sha256': digest, 'max_abs_error_K': maximum,
                                     'valid_checks': valid_count, 'missing_checks': missing_count})
        self.observations.append({'selection': item['selection'], 'fixture': item['fixture'],
            'run': item['run'], 'revision': item['revision'], 'time': item['valid_time'],
            'baseline': observations, 'tiles': tile_reports})

    def publish(self, retained, hours, *, failure=None):
        job = self.command('publication.worker', 'submit', '--clock', self.clock,
                           '--hours', hours, '--fixture', 'correction')
        environment = dict(os.environ)
        if failure:
            environment.update(T4_TEST_FAILURE=failure, T5_FAIL_HOUR=hours)
        process = subprocess.Popen([sys.executable, '-m', 'publication.worker', 'once'],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=environment)
        seen, polls = set(), 0
        active_reads = dict.fromkeys(('point', 'position', 'tile', 'wms'), 0)
        try:
            deadline = time.monotonic() + 600
            while process.poll() is None:
                self.assertLess(time.monotonic(), deadline)
                # Read the retained selection before enumerating a potentially
                # large history. Confirm process liveness after each response;
                # an old snapshot followed by worker completion is not evidence
                # that every intermediate revision could be polled in time.
                pq, eq = self.queries(retained)
                self.assertEqual(self.get(retained['point'], pq).json()['value'], self.old_value)
                active_reads['point'] += int(process.poll() is None)
                self.assertEqual(self.get(retained['position'], eq).json()['ranges']['T_G']['values'], [self.old_value])
                active_reads['position'] += int(process.poll() is None)
                self.assertEqual(self.get(self.old_tile).content, self.old_bytes)
                active_reads['tile'] += int(process.poll() is None)
                self.caps(retained)
                active_reads['wms'] += int(process.poll() is None)
                catalogue = self.catalogue()
                collections = self.get('/org/ogc/collections').json()['collections']
                # Both discoveries expose eligible selections, never staging workspaces.
                self.assertTrue({v['id'] for v in collections}.issubset(
                    {v['selection'] for v in self.catalogue()}))
                for item in catalogue:
                    if item['publication_job'] == job:
                        seen.add(item['revision'])
                        self.caps(item)
                        pq, eq = self.queries(item)
                        self.assertEqual(self.get(item['position'], eq).json()['selection'],
                                         self.get(item['point'], pq).json())
                        self.get(item['tiles'])
                polls += 1
            stdout, stderr = process.communicate(timeout=10)
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()
        self.assertEqual(process.returncode == 0, failure is None, stdout + stderr)
        status = self.get('/org/api/v1/jobs/' + job).json()
        self.assertEqual(status['state'], 'failed' if failure else 'published')
        final_choices = [v for v in self.catalogue() if v['publication_job'] == job]
        final_revisions = sorted({v['revision'] for v in final_choices})
        self.publications.append({'job': job, 'failure': failure, 'polls': polls,
            'revisions_seen_while_polling': sorted(seen), 'published_revisions': final_revisions,
            'retained_responses_before_worker_exit': active_reads, 'native_exit_code': process.returncode})
        Path('/evidence/t12-publications.json').write_text(json.dumps(self.publications, indent=2) + '\n')
        if failure:
            self.assertEqual(seen, set())
            self.assertEqual(final_choices, [])
        else:
            self.assertTrue(final_choices)
            self.assertTrue(all(active_reads.values()), active_reads)
        self.assertGreater(active_reads['point'], 0, 'retained point response must finish while worker is alive')
        self.assertGreater(polls, 0)

    def test_protected_consistency_policy_and_expiry(self):
        self.requests: list[dict] = []
        self.observations: list[dict] = []
        self.publications: list[dict] = []
        self.baseline = json.loads(Path('/app/baseline-a1.json').read_bytes())['messages']
        self.raw = {i: decoded_arrays(frame, [657, 1377])[0] for i, frame in
                    enumerate(bounded_frames(Path('/input/ICON_EU_T_G_2026101500.grib2')), 1) if i in (1, 2, 3)}
        with tempfile.TemporaryDirectory() as directory:
            key = Path(directory) / 'key'
            identity = issue('t12-integrated', 'all', key)
            self.token = key.read_text().strip()
            actual = [v for v in self.catalogue() if v['fixture'] == 'actual']
            gap = min((v for v in actual if len(v['valid_times']) == 2), key=lambda v: v['valid_time'])
            self.assertNotIn('2026-10-15T02:00:00Z', gap['valid_times'])
            choices = [v for v in actual if v['revision'] == gap['revision']]
            for item in choices:
                self.check_selection(item)
            pq, eq = self.queries(gap)
            self.get(gap['point'], {**pq, 'valid_time': '2026-10-15T02:00:00Z'}, 404)
            self.get(gap['position'], {**eq, 'datetime': '2026-10-15T02:00:00Z'}, 404)
            self.old_value = self.get(gap['point'], pq).json()['value']
            metadata = self.get(gap['tiles']).json()
            self.old_tile = metadata['url'].replace('{z}', '3').replace('{x}', '4').replace('{y}', '2')
            self.old_bytes = self.get(self.old_tile).content
            self.publish(gap, '2,3')
            corrected = [v for v in self.catalogue() if v['fixture'] == 'correction' and
                         v['publication_job'] == self.publications[-1]['job']]
            self.assertEqual({v['valid_time'] for v in corrected}, {'2026-10-15T02:00:00Z', '2026-10-15T03:00:00Z'})
            self.assertGreaterEqual(len(self.publications[-1]['published_revisions']), 1)
            for item in corrected:
                self.check_selection(item)
            for failure, hour in (('tiles', '6'), ('index', '7')):
                before = {v['selection'] for v in self.catalogue()}
                self.publish(gap, hour, failure=failure)
                self.assertEqual({v['selection'] for v in self.catalogue()}, before)
            endpoints = [(gap['collection'], {}), (gap['position'], eq), (gap['point'], pq),
                (gap['tiles'], {}), (self.old_tile, {}),
                (gap['wms'], {'SERVICE': 'WMS', 'REQUEST': 'GetCapabilities'})]
            marker = Path('/assets/.t6-generation')
            # Collections enumerates tile metadata for the whole history and
            # can evict bytes from the shared two-tile cache. Reproduce eviction
            # explicitly even in Development, then establish the warm state
            # immediately before disabling generation for the policy checks.
            for x in (5, 6, 7):
                self.get(self.old_tile.replace('/3/4/2.f32', f'/3/{x}/2.f32'))
            marker.touch()
            try:
                self.get(self.old_tile, expected=503)
            finally:
                marker.unlink(missing_ok=True)
            self.get(gap['tiles'])
            self.assertEqual(self.get(self.old_tile).content, self.old_bytes)
            marker.touch()
            try:
                self.get(self.old_tile.replace('/3/4/2.f32', '/6/32/20.f32'), expected=503)
                self.assertEqual(self.get(self.old_tile).content, self.old_bytes)
                for path, params in endpoints:
                    self.get(path, params, 401, token='invalid')
                revoked_key = Path(directory) / 'revoked'
                revoked = issue('t12-revoked', 'all', revoked_key)
                revoked_token = revoked_key.read_text().strip()
                for path, params in endpoints:
                    self.get(path, params, token=revoked_token)
                self.command('publication.access', 'revoke', '--id', revoked['id'])
                for path, params in endpoints:
                    self.get(path, params, 401, token=revoked_token)
                policy = Path(directory) / 'policy.json'
                policy.write_text(json.dumps({'requests': 1}))
                self.get(self.old_tile)  # Fresh usage immediately before the sliding-window policy.
                self.command('publication.budgets', 'configure', '--organization', 't12-integrated', '--file', policy)
                for path, params in endpoints:
                    response = self.get(path, params, 429)
                    self.assertIn('Retry-After', response.headers)
                policy.write_text('{}')
                self.command('publication.budgets', 'configure', '--organization', 't12-integrated', '--file', policy)
            finally:
                marker.unlink(missing_ok=True)
            self.command('publication.retention', 'configure', '--clock', '2026-11-14T00:00:00Z')
            try:
                for path, params in endpoints:
                    self.get(path, params, 410)
                self.assertEqual(self.catalogue(), [])
                self.assertEqual(self.get('/org/ogc/collections').json()['collections'], [])
            finally:
                self.command('publication.retention', 'configure', '--clock', self.clock)
            for path in ('/geoserver/wms', '/geoserver/rest', '/org/geoserver/wms', '/assets',
                         '/org/api:8000/api/v1/catalogue'):
                self.get(path, expected=404)
            rows = self.command('publication.budgets', 'usage', '--organization', 't12-integrated')['requests']
            by_id = {row['request_id']: row for row in rows}
            matched = [v for v in self.requests if v['request_id'] in by_id]
            # Anonymous/invalid/revoked events live in the unidentified bucket.
            self.assertGreater(len(matched), 30)
            for event in matched:
                row = by_id[event['request_id']]
                self.assertEqual(row['key_id'], identity['id'])
                self.assertEqual((row['status'], row['bytes']), (event['status'], event['bytes']))
            self.assertTrue(any(v['operation'] == 'tile' and v['cache'] == 'hit' for v in rows))
            self.assertTrue({'point', 'position', 'wms', 'tile', 'tile-metadata', 'discovery'}.issubset(
                {v['operation'] for v in rows}))
            Path('/evidence/t12-integrated.json').write_text(json.dumps({'status': 'passed',
                'clock': self.clock, 'observations': self.observations, 'publications': self.publications,
                'policy_endpoints': [v[0] for v in endpoints], 'usage': rows, 'matched_requests': len(matched),
                'warm_cache': 'generation disabled; cold=503, retained bytes=200',
                'evicted_then_rewarmed': True,
                'expired': 410, 'invalid_revoked': 401, 'quota': 429,
                'limitations': 'No GPU/interpolation/browser A2/A3/A8 or production capacity claim'}, indent=2) + '\n')
