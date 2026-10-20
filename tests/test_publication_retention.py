"""Retention policy boundaries; HTTP cases use the agreed real gateway seam."""

import unittest
import os
import json
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

from publication.retention import decisions, policy


class RetentionBoundaries(unittest.TestCase):
    def test_reference_time_controls_all_valid_times_and_fixed_demo_pin(self):
        roots = [{'root': 'old', 'run': 'ICON-EU/2026-10-15T00:00:00Z',
                  'published_at': '2026-10-20T00:00:00Z', 'managed_bytes': 100,
                  'expired_at': None, 'superseded_at': None}]
        self.assertEqual(decisions(roots, policy(), '2026-10-21T23:59:59Z')[0]['state'], 'eligible')
        self.assertEqual(decisions(roots, policy(), '2026-10-22T00:00:00Z')[0]['reason'], 'reference-time')
        self.assertEqual(decisions(roots, policy(days=30), '2026-11-13T23:59:59Z')[0]['state'], 'eligible')
        self.assertEqual(decisions(roots, policy(days=30), '2026-11-14T00:00:00Z')[0]['state'], 'expired')
        pinned = policy(demo_runs=[roots[0]['run']])
        self.assertEqual(decisions(roots, pinned, '2027-01-01T00:00:00Z')[0]['state'], 'eligible')

    def test_superseded_grace_budgets_and_tombstones_are_bounded(self):
        roots = [dict(root='a', run='ICON-EU/2026-10-15T00:00:00Z', ordinal=1,
                      published_at='2026-10-19T00:00:00Z', managed_bytes=100,
                      expired_at=None, superseded_at='2026-10-19T01:00:00Z'),
                 dict(root='b', run='ICON-EU/2026-10-15T00:00:00Z', ordinal=2,
                      published_at='2026-10-19T01:00:00Z', managed_bytes=100,
                      expired_at=None, superseded_at=None)]
        self.assertEqual(decisions(roots, policy(), '2026-10-20T00:59:59Z')[0]['state'], 'eligible')
        self.assertEqual(decisions(roots, policy(), '2026-10-20T01:00:00Z')[0]['state'], 'expired')
        for configuration in [policy(superseded_count=0), policy(superseded_bytes=99)]:
            result = decisions(roots, configuration, '2026-10-19T02:00:00Z')
            self.assertEqual([row['state'] for row in result], ['expired', 'eligible'])
            self.assertEqual(result[0]['reason'], 'superseded-budget')
        roots[0]['expired_at'] = '2026-10-19T02:00:00Z'
        self.assertEqual(decisions(roots, policy(days=30, demo_runs=[roots[0]['run']]),
                                   '2026-10-20T00:00:00Z')[0]['state'], 'expired')
        self.assertEqual(decisions(roots, policy(), '2026-10-19T01:00:00Z')[0]['state'], 'expired')
        invalid_policies: list[dict] = [dict(days=31), dict(reader_grace_seconds=3601), dict(superseded_count=-1),
                                       dict(clock='2026-10-20T00:00:00')]
        for changes in invalid_policies:
            with self.assertRaises(ValueError):
                policy(**changes)


@unittest.skipUnless(os.environ.get('T7_HTTP') == '1', 'requires isolated T7 Compose services')
class RetentionGateway(unittest.TestCase):
    base = 'http://gateway:8000'

    def command(self, module, *args, cwd=None):
        environment = {**os.environ, 'PYTHONPATH': '/app'}
        result = subprocess.run([sys.executable, '-m', module, *args], cwd=cwd, env=environment,
                                capture_output=True, text=True, timeout=600)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout.strip()

    def configure(self, days=7, clock='2026-10-19T05:00:00Z', **changes):
        args = ['configure', '--days', str(days), '--clock', clock]
        for key, value in changes.items():
            args.extend(['--' + key.replace('_', '-'), str(value)])
        return json.loads(self.command('publication.retention', *args))

    def catalogue(self):
        response = requests.get(self.base + '/api/v1/catalogue', timeout=90)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['selections']

    def publish(self, hours, fixture='actual'):
        job = self.command('publication.worker', 'submit', '--recoverable', '--clock', '2026-10-19T05:00:00Z',
                           '--hours', hours, '--fixture', fixture, '--delivery-sha256',
                           'dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a')
        self.command('publication.worker', 'once')
        status = requests.get(self.base + '/api/v1/jobs/' + job, timeout=90).json()
        self.assertEqual(status['state'], 'published', status)
        return next(item for item in self.catalogue() if item['selection'] == status['selection'])

    def read(self, selected, status=200):
        query = {key: selected[key] for key in ('selection', 'run', 'revision', 'valid_time')}
        query.update(layer=selected['field'], lon=-23.5, lat=29.5)
        tile = '/api/v1/selections/' + selected['selection'] + '/tiles/2/3/4/2.f32'
        urls = [(selected['point'], query), (selected['tiles'], {}), (tile, {}),
                (selected['wms'], {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetCapabilities'})]
        for url, parameters in urls:
            response = requests.get(self.base + url, params=parameters, timeout=90)
            self.assertEqual(response.status_code, status, url + ': ' + response.text[:200])
            if status == 410:
                self.assertEqual(response.json()['code'], 'Expired')
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
            if url == tile and status == 200:
                self.assertEqual(len(response.content), 332820)
        return selected['selection']

    def collect(self, apply=False):
        return json.loads(self.command('publication.retention', 'collect', *(['--apply'] if apply else [])))

    def test_00_upgrade_mixed_legacy_and_incremental_publications(self):
        historical = Path('/evidence/legacy-source')
        self.assertTrue((historical / 'publication/worker.py').is_file(), 'runner must provide frozen pre-T7 worker')
        self.command('publication.worker', 'submit', '--clock', '2026-10-19T03:00:00Z',
                     '--legacy-one-time', cwd=historical)
        self.command('publication.worker', 'once', cwd=historical)
        job = self.command('publication.worker', 'submit', '--clock', '2026-10-19T04:00:00Z',
                           '--hours', '1', cwd=historical)
        self.command('publication.worker', 'once', cwd=historical)
        self.command('publication.worker', 'once')  # additive upgrade/backfill
        status = requests.get(self.base + '/api/v1/jobs/' + job, timeout=90).json()
        selected = next(item for item in self.catalogue() if item['selection'] == status['selection'])
        observed = self.collect()
        latest = next(row for row in observed['roots'] if row['root'] == selected['revision'])
        self.configure(clock=latest['event_clock'], demo_run=selected['run'],
                       superseded_grace_seconds=2592000, superseded_count=0, reader_grace_seconds=0)
        self.read(selected)
        self.assertEqual({item['revision'] for item in self.catalogue()}, {selected['revision']})
        report = self.collect(True)
        self.read(selected)
        self.assertGreater(len(report['removed']), 0)
        Path('/evidence/t7-upgrade.json').write_text(json.dumps({
            'status': 'passed', 'latest_selection': selected['selection'],
            'fixture': 'pre-T7 T4 and T5 workers; current additive migration',
            'report': report}, default=str, indent=2))

    def test_policy_cleanup_and_warm_cache_expiry(self):
        from decoder.sampling import file_hash
        source = Path('/input/ICON_EU_T_G_2026101500.grib2')
        source_before = file_hash(source)
        self.configure()
        old = self.publish('1')
        late = self.publish('24')
        corrected = self.publish('1', 'correction')
        self.read(old)
        self.read(late)
        self.read(corrected)
        # All valid times survive reference-time policy, including the last
        # forecast time beyond the reference cutoff in this boundary supplement.
        self.configure(days=30, clock='2026-11-13T23:59:59Z', superseded_grace_seconds=2592000)
        self.read(corrected)
        report30 = self.collect()
        self.assertEqual(report30['removed'], [])
        self.assertEqual(file_hash(source), source_before)
        # Demo run is explicit, and its pin does not exempt superseded budgets.
        self.configure(clock='2027-01-01T00:00:00Z', demo_run=corrected['run'])
        self.read(corrected)
        self.configure(clock='2026-10-19T05:30:00Z', superseded_grace_seconds=3600, reader_grace_seconds=60)
        self.read(old)
        self.configure(clock='2026-10-19T06:00:00Z', superseded_grace_seconds=3600, reader_grace_seconds=60)
        self.read(old, 410)
        self.read(corrected)
        before = self.collect()
        self.assertFalse(before['apply'])
        applied = self.collect(True)
        # Old root manifests are still present throughout physical reader grace.
        old_roots = [row for row in applied['roots'] if row['root'] == old['revision']]
        self.assertEqual(len(old_roots), 1)
        self.assertEqual(applied['removed'], [])
        self.configure(clock='2026-10-19T06:01:00Z', superseded_grace_seconds=3600, reader_grace_seconds=60)
        stop = threading.Event()
        outcomes = []
        traffic_ready = [threading.Event() for _ in range(4)]
        def traffic(index):
            while not stop.is_set():
                response = requests.get(self.base + corrected['wms'], params={
                    'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetCapabilities'}, timeout=90)
                outcomes.append((time.monotonic(), response.status_code))
                traffic_ready[index].set()
        with ThreadPoolExecutor(max_workers=4) as readers:
            futures = [readers.submit(traffic, index) for index in range(4)]
            try:
                for event in traffic_ready:
                    self.assertTrue(event.wait(90), 'gateway reader did not start')
                collection_start = time.monotonic()
                swept = self.collect(True)
                collection_end = time.monotonic()
            finally:
                stop.set()
                for future in futures:
                    future.result(timeout=95)
        self.assertTrue(outcomes, 'exercise collection with active gateway read traffic')
        self.assertTrue(all(code in (200, 503) for _, code in outcomes), outcomes)
        self.assertTrue(any(collection_start <= observed <= collection_end for observed, _ in outcomes),
                        'gateway traffic must overlap collection')
        self.assertGreater(len(swept['removed']), 0, 'traffic must not pin expired assets forever')
        self.read(old, 410)
        self.read(corrected)
        # Shared hour 24 is still usable after deleting superseded roots.
        retained24 = next(item for item in self.catalogue() if item['revision'] == corrected['revision']
                          and item['valid_time'] == '2026-10-16T00:00:00Z')
        self.read(retained24)
        self.assertEqual(self.collect(True)['removed'], [])
        # Run expiry must precede both a warm tile hit and managed deletion.
        self.configure(clock='2026-10-22T00:00:00Z', reader_grace_seconds=60)
        self.read(corrected, 410)
        self.assertEqual(self.catalogue(), [])
        expired7 = self.collect(True)
        self.assertEqual(expired7['removed'], [])
        self.configure(clock='2026-10-22T00:01:00Z', reader_grace_seconds=60)
        dry7 = self.collect()
        self.assertGreater(dry7['reclaimable']['categories']['numeric_tiles'], 0)
        self.assertGreater(dry7['reclaimable']['categories']['cogs'], 0)
        self.assertGreater(dry7['reclaimable']['categories']['originals'], 0)
        removed7 = self.collect(True)
        self.assertEqual(removed7['removed'], dry7['candidates'])
        self.assertEqual(file_hash(source), source_before)
        self.read(corrected, 410)
        # Lengthening policy cannot resurrect tombstoned/deleted selections.
        self.configure(days=30, clock='2026-10-23T00:00:00Z')
        self.read(corrected, 410)
        self.assertEqual(self.catalogue(), [])
        second = self.publish('2')
        self.read(second)
        self.configure(days=30, clock='2026-11-14T00:00:00Z', reader_grace_seconds=60)
        self.read(second, 410)
        self.collect(True)
        self.configure(days=30, clock='2026-11-14T00:01:00Z', reader_grace_seconds=60)
        dry30 = self.collect()
        removed30 = self.collect(True)
        self.assertGreater(dry30['reclaimable']['categories']['numeric_tiles'], 0)
        self.assertEqual(removed30['removed'], dry30['candidates'])
        self.assertEqual(file_hash(source), source_before)
        Path('/evidence/t7-retention.json').write_text(json.dumps({
            'status': 'passed', 'source_sha256_before_after': [source_before, file_hash(source)],
            'report30': report30, 'superseded': swept, 'dry7': dry7, 'removed7': removed7,
            'dry30': dry30, 'removed30': removed30,
            'concurrent_reader_statuses': outcomes,
            'expired_selections': [old['selection'], corrected['selection']],
            'checks': ['gateway point/WMS/metadata/tile', 'warm-cache expiry', 'bounded old-reader grace',
                       'shared incremental batches', 'seven/30-day boundary', 'demo pin', 'idempotent cleanup',
                       'tombstones survive policy extension', 'read-only source unchanged']}, default=str, indent=2))
