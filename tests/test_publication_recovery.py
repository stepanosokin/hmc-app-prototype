"""A6: worker CLI and gateway against actual input and real Compose services."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest

import requests


@unittest.skipUnless(os.environ.get('T6_HTTP') == '1', 'requires isolated T6 Compose services')
class Recovery(unittest.TestCase):
    base = 'http://gateway:8000'

    def cli(self, *args, expected=0, env=None):
        result = subprocess.run([sys.executable, '-m', 'publication.worker', *args],
                                capture_output=True, text=True, env={**os.environ, **(env or {})}, timeout=240)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result.stdout.strip()

    def status(self, job):
        response = requests.get(self.base + '/api/v1/jobs/' + job, timeout=90)
        response.raise_for_status()
        return response.json()

    def catalogue(self):
        response = requests.get(self.base + '/api/v1/catalogue', timeout=90)
        response.raise_for_status()
        return response.json()['selections']

    def selected_bytes(self, selected):
        query = {key: selected[key] for key in ('selection', 'run', 'revision', 'valid_time')}
        query.update(layer=selected['field'], lon=-23.5, lat=29.5)
        point = requests.get(self.base + '/api/v1/point', params=query, timeout=90)
        self.assertEqual(point.status_code, 200, point.text)
        metadata = requests.get(self.base + selected['tiles'], timeout=90)
        self.assertEqual(metadata.status_code, 200, metadata.text)
        url = metadata.json()['url'].replace('{z}', '3').replace('{x}', '4').replace('{y}', '2')
        tile = requests.get(self.base + url, timeout=90)
        self.assertEqual(tile.status_code, 200, tile.text[:100])
        wms = requests.get(self.base + selected['wms'], params={
            'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap', 'LAYERS': 'temperature',
            'TIME': selected['valid_time'], 'CRS': 'EPSG:3857',
            'BBOX': '-1000000,5000000,3000000,9000000', 'WIDTH': 64, 'HEIGHT': 64,
            'FORMAT': 'image/png', 'STYLES': ''}, timeout=90)
        self.assertEqual(wms.status_code, 200, wms.text[:100])
        return point.json()['value'], hashlib.sha256(tile.content).hexdigest(), hashlib.sha256(wms.content).hexdigest()

    def test_worker_crashes_preserve_readers_and_retry_without_duplicates(self):
        baseline = self.catalogue()[0]
        original = self.selected_bytes(baseline)
        observations = []
        for hour, stage in enumerate(('decoding', 'normalization', 'tiles', 'derivatives',
                                      'indexing', 'readiness', 'metadata', 'publication', 'committed'), 2):
            with self.subTest(stage=stage):
                job = self.cli('submit', '--clock', '2026-10-19T07:00:00Z', '--hours', str(hour), '--recoverable')
                marker = Path('/evidence') / ('pause-' + job + '.json')
                worker = subprocess.Popen([sys.executable, '-m', 'publication.worker', 'once'],
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                          env={**os.environ, 'T6_PAUSE_STAGE': stage})
                try:
                    deadline = time.monotonic() + 240
                    while not marker.exists() and worker.poll() is None and time.monotonic() < deadline:
                        time.sleep(0.1)
                    self.assertTrue(marker.exists(), self.status(job))
                    before = self.catalogue()
                    if stage != 'committed':
                        self.assertFalse(any(item.get('publication_job') == job for item in before))
                        for path in (Path('/assets') / job).rglob('tiles.json'):
                            staged_selection = json.loads(path.read_bytes())['selection']
                            hidden = requests.get(self.base + '/api/v1/selections/' + staged_selection + '/tiles.json', timeout=90)
                            self.assertEqual(hidden.status_code, 404)
                        for path in (Path('/assets') / job).rglob('revision.json'):
                            revision = json.loads(path.read_bytes())
                            staged_selection = revision['revision'] + '.' + revision['batches'][-1]['key']
                            hidden = requests.get(self.base + '/api/v1/selections/' + staged_selection + '/tiles.json', timeout=90)
                            self.assertEqual(hidden.status_code, 404)
                    self.assertEqual(self.selected_bytes(baseline), original)
                finally:
                    worker.kill()
                    worker.wait(timeout=10)
                self.assertLess(worker.returncode, 0, 'actual process must be killed')
                self.cli('once')
                self.assertEqual(self.status(job)['state'], 'published')
                after = self.catalogue()
                # A commit acknowledged only after the crash still must not duplicate.
                expected_new = 0 if stage == 'committed' else 1
                self.assertEqual(len({item['revision'] for item in after}) - len({item['revision'] for item in before}), expected_new)
                self.assertEqual(self.selected_bytes(baseline), original)
                observations.append({'stage': stage, 'job': job, 'killed_exit_code': worker.returncode,
                                     'status': self.status(job), 'retained_reader': original})
        collected = json.loads(self.cli('collect'))
        self.assertGreater(len(collected['candidates']), 0)
        self.assertEqual(collected['removed'], [])
        removed = json.loads(self.cli('collect', '--apply'))
        self.assertEqual(removed['removed'], collected['candidates'])
        self.assertEqual(self.selected_bytes(baseline), original)
        Path('/evidence/t6-crashes.json').write_text(json.dumps({'observations': observations,
            'collection': removed, 'old_selection': baseline['selection']}, indent=2))

    def test_z_lazy_tile_failures_retry_same_selection(self):
        baseline = self.catalogue()[0]
        original = self.selected_bytes(baseline)
        metadata = requests.get(self.base + baseline['tiles'], timeout=90).json()
        observations = []
        for stage, x in (('generation', 7), ('cache', 8)):
            url = metadata['url'].replace('{z}', '4').replace('{x}', str(x)).replace('{y}', '5')
            fault = Path('/assets') / ('.t6-' + stage)
            fault.touch()
            try:
                response = requests.get(self.base + url, timeout=90)
                self.assertEqual(response.status_code, 503, response.text[:100])
                self.assertEqual(response.headers['Retry-After'], '2')
                self.assertEqual(self.selected_bytes(baseline), original, 'warm old tiles survive lazy failures')
            finally:
                fault.unlink()
            recovered = requests.get(self.base + url, timeout=90)
            self.assertEqual(recovered.status_code, 200)
            self.assertEqual(recovered.content, requests.get(self.base + url, timeout=90).content)
            observations.append({'stage': stage, 'status': response.status_code,
                                 'recovered_sha256': hashlib.sha256(recovered.content).hexdigest()})
        Path('/evidence/t6-lazy.json').write_text(json.dumps(observations, indent=2))

    def test_a_recoverable_delivery_is_idempotent(self):
        args = ('submit', '--clock', '2026-10-19T07:00:00Z', '--hours', '1', '--recoverable')
        first = self.cli(*args)
        second = self.cli(*args)
        self.assertEqual(first, second, 'same source checksum/pipeline/request has one durable job')
        self.cli('once', '--migrate')
        status = self.status(first)
        self.assertEqual(status['state'], 'published', status)
        before = self.catalogue()
        self.assertEqual(self.cli(*args), first)
        self.cli('once')
        self.assertEqual(self.catalogue(), before)
        Path('/evidence/t6-idempotence.json').write_text(json.dumps(status, indent=2))

    def test_b_bad_deliveries_are_quarantined_with_original_bytes(self):
        before = self.catalogue()
        observations = []
        for name in ('partial.grib2', 'truncated.grib2', 'unsupported.grib2'):
            job = self.cli('submit', '--clock', '2026-10-19T07:00:00Z', '--hours', '1',
                           '--recoverable', '--source-name', name, '--stability-seconds', '1')
            self.cli('once', expected=1)
            status = self.status(job)
            self.assertEqual(status['state'], 'failed')
            self.assertEqual(status['error'], 'DeliveryInvalid')
            self.assertFalse(status['retryable'])
            self.assertEqual(status['stage'], 'decoding')
            original = Path('/assets') / job / 'original.grib2'
            self.assertEqual(original.read_bytes(), (Path('/input') / name).read_bytes())
            self.assertEqual(self.catalogue(), before)
            observations.append({'source': name, 'job': job, 'status': status,
                                 'retained_sha256': hashlib.sha256(original.read_bytes()).hexdigest()})
        Path('/evidence/t6-quarantine.json').write_text(json.dumps(observations, indent=2))

    def test_d_derivative_failures_retry_with_bounded_attempts(self):
        old = self.catalogue()[0]
        original = self.selected_bytes(old)
        observations = []
        for hour, failure, exhausted in ((11, 'tiles', False), (12, 'index', False), (13, 'tiles', True)):
            job = self.cli('submit', '--clock', '2026-10-19T07:00:00Z', '--hours', str(hour), '--recoverable')
            before = self.catalogue()
            for attempt in range(1, 4 if exhausted else 2):
                self.cli('once', expected=1, env={'T4_TEST_FAILURE': failure})
                status = self.status(job)
                self.assertEqual(status['state'], 'failed')
                self.assertEqual(status['attempts'], attempt)
                self.assertEqual(status['retryable'], attempt < 3)
                self.assertEqual(self.catalogue(), before)
                self.assertEqual(self.selected_bytes(old), original)
                time.sleep(2.1)
            self.cli('once')
            status = self.status(job)
            self.assertEqual(status['state'], 'failed' if exhausted else 'published')
            if exhausted:
                self.assertEqual(status['attempts'], 3)
            observations.append({'failure': failure, 'exhausted': exhausted, 'status': status})
            if exhausted:
                self.cli('retry', '--job', job)
                self.cli('once')
                self.assertEqual(self.status(job)['state'], 'published')
                observations[-1]['after_operator_retry'] = self.status(job)
        Path('/evidence/t6-failures.json').write_text(json.dumps(observations, indent=2))

    def test_e_partial_job_collects_only_abandoned_hours(self):
        old = self.catalogue()[0]
        original = self.selected_bytes(old)
        job = self.cli('submit', '--clock', '2026-10-19T07:00:00Z', '--hours', '14,15', '--recoverable')
        self.cli('once', expected=1, env={'T4_TEST_FAILURE': 'tiles', 'T5_FAIL_HOUR': '15'})
        status = self.status(job)
        self.assertEqual(status['state'], 'failed')
        published = next(item for item in self.catalogue() if item['selection'] == status['selection'])
        self.assertEqual(published['valid_time'], '2026-10-15T14:00:00Z')
        retained = self.selected_bytes(published)
        report = json.loads(self.cli('collect', '--apply'))
        self.assertTrue(any(path.endswith('/hour-15') for path in report['removed']), report)
        self.assertEqual(self.selected_bytes(published), retained)
        before = {item['revision'] for item in self.catalogue()}
        time.sleep(2.1)
        self.cli('once')
        self.assertEqual(self.status(job)['state'], 'published')
        self.assertEqual(len({item['revision'] for item in self.catalogue()} - before), 1)
        self.assertEqual(self.selected_bytes(old), original)
        Path('/evidence/t6-partial-job.json').write_text(json.dumps({'status': self.status(job),
            'collection': report, 'retained_published_hour': retained}, indent=2))
