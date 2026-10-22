"""T5 gateway acceptance seam; real services and explicitly labelled fixtures."""

import os
import json
import hashlib
import subprocess
import sys
import time
import unittest
from pathlib import Path
import xml.etree.ElementTree as ET

import requests


@unittest.skipUnless(os.environ.get('T5_HTTP') == '1', 'requires isolated T5 Compose services')
class IncrementalPublication(unittest.TestCase):
    base = 'http://gateway:8000'

    def catalogue(self):
        response = requests.get(self.base + '/api/v1/catalogue', timeout=90)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['selections']

    def point(self, selected, *, valid_time=None, expected=200):
        response = requests.get(self.base + selected['point'], params={
            **{key: selected[key] for key in ('selection', 'run', 'revision', 'valid_time')},
            'valid_time': valid_time or selected['valid_time'],
            'layer': selected['field'], 'lon': -23.5, 'lat': 29.5}, timeout=90)
        self.assertEqual(response.status_code, expected, response.text)
        return response.json()

    def tile(self, selected, zxy=(3, 4, 2)):
        metadata = requests.get(self.base + selected['tiles'], timeout=90)
        self.assertEqual(metadata.status_code, 200, metadata.text)
        metadata = metadata.json()
        self.assertEqual(metadata['identity']['revision'], selected['revision'])
        self.assertEqual(metadata['identity']['valid_time'], selected['valid_time'])
        url = metadata['url']
        for key, value in zip(('z', 'x', 'y'), zxy):
            url = url.replace('{' + key + '}', str(value))
        result = requests.get(self.base + url, timeout=90)
        self.assertEqual(result.status_code, 200, result.text[:100])
        digest = hashlib.sha256(result.content).hexdigest()
        self.assertEqual(result.headers['ETag'], '"' + digest + '"')
        for representative in metadata['representative_tiles']:
            if representative['zxy'] == list(zxy):
                self.assertEqual(digest, representative['sha256'])
        return result.content

    def wms(self, selected, operation='GetCapabilities', valid_time=None):
        params = {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': operation}
        if operation != 'GetCapabilities':
            params.update(LAYERS='temperature', STYLES='', TIME=valid_time or selected['valid_time'],
                          CRS='EPSG:3857', BBOX='-1000000,5000000,3000000,9000000',
                          WIDTH=64, HEIGHT=64, FORMAT='image/png')
        return requests.get(self.base + selected['wms'], params=params, timeout=90)

    def publish(self, hours, fixture='actual', retained=None, failure=None, fail_hour='4'):
        submitted = subprocess.run([sys.executable, '-m', 'publication.worker', 'submit',
                                    '--clock', '2026-10-19T05:00:00Z', '--hours', hours, '--fixture', fixture],
                                   capture_output=True, text=True)
        self.assertEqual(submitted.returncode, 0, submitted.stderr)
        job = submitted.stdout.strip()
        environment = dict(os.environ)
        if failure:
            environment.update(T4_TEST_FAILURE=failure, T5_FAIL_HOUR=fail_hour)
        observed = set()
        # Pipe output is bounded (worker prints only terminal failures).
        processed = subprocess.Popen([sys.executable, '-m', 'publication.worker', 'once'],
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=environment)
        try:
            deadline = time.monotonic() + 600
            while processed.poll() is None:
                self.assertLess(time.monotonic(), deadline, 'publication exceeded test deadline')
                selections = self.catalogue()
                for item in selections:
                    if item.get('publication_job') == job:
                        observed.add(item['revision'])
                        self.assertEqual(self.point(item)['revision'], item['revision'])
                if retained:
                    self.assertEqual(self.point(retained)['value'], 298.2274169921875)
                    self.assertEqual(self.tile(retained), self.retained_bytes)
                time.sleep(0.1)
            stdout, stderr = processed.communicate(timeout=5)
        finally:
            if processed.poll() is None:
                processed.kill()
                processed.communicate()
        if not failure:
            self.assertEqual(processed.returncode, 0, stdout + stderr)
        else:
            self.assertNotEqual(processed.returncode, 0, stdout + stderr)
        status = requests.get(self.base + '/api/v1/jobs/' + job, timeout=90).json()
        self.assertEqual(status['state'], 'failed' if failure else 'published', status)
        self.observations.append({'job': job, 'hours': hours, 'fixture': fixture, 'failure': failure,
                                  'native_exit_code': processed.returncode, 'observed_revisions': sorted(observed)})
        choices = [item for item in self.catalogue() if item['selection'] == status['selection']]
        return choices[0] if choices else None

    def test_incremental_times_corrections_and_retained_readers(self):
        self.observations: list[dict] = []
        selected = self.publish('1')
        self.assertIsNotNone(selected)
        self.assertEqual(selected['completeness'], 'unknown')
        self.assertEqual(selected['valid_times'], ['2026-10-15T01:00:00Z'])
        self.assertEqual(self.point(selected)['value'], 298.2274169921875)
        self.retained_bytes = self.tile(selected)
        original_map = self.wms(selected, 'GetMap')
        self.assertEqual(original_map.status_code, 200)
        gap = self.publish('3', retained=selected)
        self.assertEqual(gap['valid_times'], ['2026-10-15T01:00:00Z', '2026-10-15T03:00:00Z'])
        self.point(gap, valid_time='2026-10-15T02:00:00Z', expected=404)
        self.assertEqual(self.wms(gap, 'GetMap', '2026-10-15T02:00:00Z').status_code, 404)
        caps = self.wms(gap)
        self.assertEqual(caps.status_code, 200, caps.text)
        times = ET.fromstring(caps.content).findall('.//{*}Dimension')
        self.assertEqual([node.text for node in times if node.get('name') == 'time'],
                         ['2026-10-15T01:00:00Z,2026-10-15T03:00:00Z'])
        # Guessing a later batch key inside the earlier revision never grants access.
        guessed = selected['revision'] + '.' + gap['selection'].split('.')[1]
        for suffix in ('/tiles.json', '/tiles/2/3/4/2.f32'):
            self.assertEqual(requests.get(self.base + '/api/v1/selections/' + guessed + suffix, timeout=90).status_code, 404)
        late = self.publish('2', retained=selected)
        self.assertEqual(len(late['valid_times']), 3)
        before_repeat = {item['selection'] for item in self.catalogue()}
        repeated = self.publish('2', retained=selected)
        self.assertEqual(repeated['selection'], late['selection'])
        self.assertEqual({item['selection'] for item in self.catalogue()}, before_repeat)
        overlap = self.publish('1,2', 'overlap', retained=selected)
        self.assertNotEqual(overlap['run'], late['run'])
        self.assertEqual(overlap['fixture'], 'overlap')
        all_times = self.publish(','.join(map(str, range(1, 25))), retained=selected)
        self.assertEqual(len(all_times['valid_times']), 24)
        self.assertGreater(len(self.observations[-1]['observed_revisions']), 1,
                           'readers must observe usable intermediate revisions before all times finish')
        baseline = json.loads(Path('/app/baseline-a1.json').read_bytes())['messages']
        latest = [item for item in self.catalogue() if item['revision'] == all_times['revision']]
        self.assertEqual(len(latest), 24)
        for item in latest:
            hour = int(item['valid_time'][11:13]) or 24
            self.assertEqual(self.point(item)['value'], baseline[hour - 1]['grid']['cell_centres'][0]['value'])
            self.assertEqual(self.wms(item, 'GetMap').status_code, 200)
        corrected = self.publish('1', 'correction', retained=selected)
        self.assertEqual(self.point(corrected)['value'], 299.2274169921875)
        self.assertNotEqual(self.tile(corrected), self.retained_bytes)
        from publication.tiles import MAP_TO_NATIVE
        mx, my, _ = MAP_TO_NATIVE.transform(-23.5, 29.5, 0., direction='INVERSE')
        identify = requests.get(self.base + corrected['wms'], params={
            'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetFeatureInfo',
            'LAYERS': 'temperature', 'QUERY_LAYERS': 'temperature', 'STYLES': '',
            'TIME': corrected['valid_time'], 'CRS': 'EPSG:3857',
            'BBOX': f'{mx-50},{my-50},{mx+50},{my+50}', 'WIDTH': 3, 'HEIGHT': 3,
            'I': 1, 'J': 1, 'FORMAT': 'image/png', 'INFO_FORMAT': 'text/plain'}, timeout=90)
        self.assertEqual(identify.status_code, 200, identify.text)
        import re
        match = re.search(r'GRAY_INDEX\s*=\s*([0-9.eE+-]+)', identify.text)
        self.assertIsNotNone(match, identify.text)
        assert match is not None
        self.assertAlmostEqual(float(match.group(1)), 299.2274169921875, delta=0.0001)
        self.assertEqual(self.point(selected)['value'], 298.2274169921875)
        self.assertEqual(self.tile(selected), self.retained_bytes)
        # The unchanged hour-three batch is reused across every later revision.
        unchanged = next(item for item in self.catalogue() if item['revision'] == corrected['revision']
                         and item['valid_time'] == gap['valid_time'])
        hour_three = next(item for item in latest if item['valid_time'] == gap['valid_time'])
        self.assertEqual(hour_three['batch'], gap['batch'])
        self.assertEqual(unchanged['batch'], hour_three['batch'])
        self.assertEqual(self.tile(unchanged), self.tile(hour_three))
        for failure in ('tiles', 'index'):
            before = {item['selection'] for item in self.catalogue()}
            failed = self.publish('4', retained=selected, failure=failure)
            self.assertIsNone(failed)
            self.assertEqual({item['selection'] for item in self.catalogue()}, before)
        partial = self.publish('4,5', retained=selected, failure='tiles', fail_hour='5')
        self.assertIsNotNone(partial, 'validated hour four remains published when hour five fails')
        self.assertEqual(partial['valid_time'], '2026-10-15T04:00:00Z')
        self.assertEqual(len(partial['valid_times']), 24)
        previous_five = next(item for item in self.catalogue() if item['revision'] == corrected['revision']
                             and item['valid_time'] == '2026-10-15T05:00:00Z')
        partial_five = next(item for item in self.catalogue() if item['revision'] == partial['revision']
                            and item['valid_time'] == previous_five['valid_time'])
        self.assertEqual(previous_five['batch'], partial_five['batch'])
        self.assertEqual(self.wms(selected, 'GetMap').content, original_map.content)
        self.assertEqual(self.wms(selected).status_code, 200)
        # A non-representative tile exercises lazy generation after correction.
        self.assertEqual(self.tile(corrected, (4, 8, 5)), self.tile(corrected, (4, 8, 5)))
        Path('/evidence/t5-acceptance.json').write_text(json.dumps({
            'status': 'passed', 'seam': 'gateway with real worker/PostGIS/GeoServer',
            'actual_source_sha256': 'dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a',
            'clock': '2026-10-19T05:00:00Z', 'observations': self.observations,
            'old_selection': selected['selection'], 'final_revision': corrected['revision'],
            'old_tile_sha256': hashlib.sha256(self.retained_bytes).hexdigest(),
            'all_actual_times': 24, 'completeness': 'unknown',
            'synthetic_supplements': ['overlap run', 'missing time 02 before late batch', '+1 K correction'],
            'limitations': 'No browser navigation/GPU, desktop QGIS, operational capacity or retention claims'}, indent=2))
