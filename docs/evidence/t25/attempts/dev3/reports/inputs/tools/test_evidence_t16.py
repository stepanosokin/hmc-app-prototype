"""Synthetic T16 archives through the same entry point used by CI."""

import hashlib
import json
import shutil
import unittest
from pathlib import Path
from typing import Any

import test_evidence_t15 as fixtures
from evidence_t15 import check_updates, read
from evidence_t16 import ATTEMPTS, NEW_CLEANUP, OLD_CLEANUP


class T16Evidence(unittest.TestCase):
    def write(self, path: Path, value: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf-8')

    def setUp(self) -> None:
        # Reuse the complete synthetic GPU/update matrix without inheriting T15 tests.
        fixture = fixtures.T15Evidence()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.root = fixture.root
        self.archive = self.root / 'docs/evidence/t16'
        fixture.archive.rename(self.archive)
        fixture.archive = self.archive
        self.fixture = fixture
        attempts = self.archive / 'attempts'
        (attempts / 'final2').rename(attempts / 'desktop-final2')
        (attempts / 'android-final2').rename(attempts / 'android-repeat1')
        identities = {}
        for attempt, phone in [('desktop-final2', False), ('android-repeat1', True)]:
            reports = attempts / attempt / 'reports'
            inputs = read(reports / 'inputs-start.json')
            runner = "    }else{\n        await clean('browser_stopped',async()=>{\n" + (OLD_CLEANUP if phone else NEW_CLEANUP)
            for name, payload in [('tools/check-weather-viewer.mjs', runner.encode()),
                                  ('tools/viewer-network.mjs', b'synthetic network interceptor')]:
                (reports / 'inputs' / name).write_bytes(payload)
                inputs[name] = {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
            for phase in ('start', 'end'):
                self.write(reports / f'inputs-{phase}.json', inputs)
            identities['android' if phone else 'desktop'] = inputs['tools/check-weather-viewer.mjs']
            receipt = read(attempts / attempt / 'retirement.json')
            self.write(attempts / attempt / 'retirement.json', {**receipt, 'project': attempt})
            for browser in (['browser'] if phone else ['browser', 'browser-edge']):
                path = reports / browser / 'browser.json'
                report = read(path)
                report['configuration']['public_runtime_blocked'] = True
                report['network'] = {'origin': 'http://127.0.0.1:8140', 'status': 'passed',
                                     'probes': {'page': True, 'worker': True},
                                     'allowed': [{'url': 'http://127.0.0.1:8140/main.js'}],
                                     'blocked': [{'url': 'https://hmc-runtime-check.invalid/' + p}
                                                 for p in ('page', 'worker', 'nested-worker')]}
                report['navigation'] = {'races': [
                    {'stage': s, 'destination': d, 'obsolete_completion_rejected': True,
                     'history': [{'stage': s, 'event': 'real texture write before pause' if s == 'upload' else 'held'},
                                 {'stage': s, 'event': 'released'}]}
                    for s in ('fetch', 'decode', 'upload') for d in ('gap', 'run')] + [
                    {'stage': 'point', 'different_run_after_release': True,
                     'history': [{'event': 'held'}, {'event': 'released'}]}]}
                if phone:
                    del report['navigation']
                self.write(path, report)
        for attempt in ATTEMPTS - {'desktop-final2', 'android-repeat1'}:
            shutil.copytree(attempts / 'android-repeat1', attempts / attempt)
            receipt = read(attempts / attempt / 'retirement.json')
            self.write(attempts / attempt / 'retirement.json', {**receipt, 'project': attempt})
        self.write(self.archive / 'checks/validation-input-difference.json', {
            'files': [{'path': 'tools/check-weather-viewer.mjs', **identities}]})
        self.write(self.archive / 'checks/final-cleanup.json', {
            'retired_projects': 8, 'owned_browser_adb_processes_remaining': 0, 'owned_listeners_remaining': 0,
            'retained_task_stacks': [], 'projects': [{'project': p, 'container': 0, 'network': 0, 'volume': 0}
                                                  for p in sorted(ATTEMPTS)]})
        self.write(self.archive / 'android-tools/cleanup.json', {
            **{k: True for k in ('runner_mappings_tab_ui_dump_retired', 'diagnostic_tab_server_mappings_retired',
                                'owned_keys_removed', 'owned_server_stopped', 'sdk_removed',
                                'owned_keys_verified_before_removal', 'user_adb_5037_preserved')},
            'owned_listeners_remaining': 0})
        self.write(self.archive / 'android-tools/device-cleanup.json', {
            'owner_confirmed_pairing_removed': True, 'owner_confirmed_wireless_debugging_disabled': True})
        self.save_index()

    def save_index(self) -> None:
        self.fixture.save_index()
        path = self.archive / 'artifact-index.json'
        index = read(path)
        for item in index['artifacts']:
            payload = (self.archive / item['name']).read_bytes()
            item['git_object'] = hashlib.sha1(b'blob ' + str(len(payload)).encode() + b'\0' + payload).hexdigest()
        self.write(path, index)

    def test_accepts_archive_independent_of_current_workspace(self) -> None:
        (self.root / 'viewer').mkdir()
        (self.root / 'viewer/main.ts').write_bytes(b'future viewer')
        self.assertGreater(check_updates(self.root, offline=True), 30)

    def test_rejects_semantic_corruption_after_rehash(self) -> None:
        report = 'attempts/desktop-final2/reports/browser/browser.json'
        cases = [
            (report, lambda d: d['configuration'].update(public_runtime_blocked=False), 'offline mode'),
            (report, lambda d: d['network']['blocked'].pop(), 'probe matrix'),
            (report, lambda d: d['network']['blocked'].append({'url': 'https://public.example/font'}), 'probe matrix'),
            (report, lambda d: d['network']['probes'].update(worker=False), 'probe matrix'),
            (report, lambda d: d['network'].update(status='failed'), 'probe matrix'),
            (report, lambda d: d['network'].update(origin='https://public.example'), 'local origin'),
            (report, lambda d: d['network']['allowed'].append({'url': 'http://127.0.0.1:8141/foo'}), 'public runtime'),
            (report, lambda d: d['network'].update(allowed=[]), 'public runtime'),
            (report, lambda d: d['configuration'].update(focused=True), 'full browser matrix'),
            (report, lambda d: d['updates']['races'].pop(), 'update race'),
            (report, lambda d: d['navigation']['races'].pop(), 'delayed point race'),
            (report, lambda d: d['navigation']['races'][2]['history'].pop(), 'navigation race'),
            (report, lambda d: d['cleanup'].update(profile_removed=False), 'browser cleanup'),
            ('attempts/android-repeat1/reports/browser/browser.json', lambda d: d['native_selections'][0].update(committed=False), 'physical input'),
            ('attempts/android-repeat1/reports/inputs-end.json', lambda d: d.pop('viewer/main.ts'), 'frozen inputs'),
            ('attempts/desktop-final2/reports/native-comparison-edge.json', lambda d: d.update(max_abs_error_K=float('nan')), 'baseline numeric'),
            ('attempts/desktop-final2/reports/browser-updates-comparison.json', lambda d: d.update(edr_equal=False), 'numeric'),
            ('attempts/android-repeat1/reports/browser-canonical.json', lambda d: d['canonical_picks'].pop(), 'canonical'),
            ('checks/validation-input-difference.json', lambda d: d['files'][0]['android'].update(bytes=0), 'difference record'),
            ('checks/final-cleanup.json', lambda d: d['projects'].pop(), 'final cleanup'),
            ('checks/final-cleanup.json', lambda d: d['projects'][0].update(volume=1), 'final cleanup'),
            ('android-tools/cleanup.json', lambda d: d.update(owned_keys_removed=False), 'wireless ADB'),
            ('android-tools/device-cleanup.json', lambda d: d.update(owner_confirmed_pairing_removed=False), 'device cleanup'),
        ]
        for name, mutation, message in cases:
            with self.subTest(name=name, message=message):
                path = self.archive / name
                original = path.read_bytes()
                data = read(path)
                mutation(data)
                self.write(path, data)
                self.save_index()
                with self.assertRaisesRegex(ValueError, message):
                    check_updates(self.root, offline=True)
                path.write_bytes(original)
                self.save_index()

    def test_rejects_removed_failed_attempt_after_rehash(self) -> None:
        shutil.rmtree(self.archive / 'attempts/dev1')
        self.save_index()
        with self.assertRaisesRegex(ValueError, 'attempt history'):
            check_updates(self.root, offline=True)

    def test_rejects_unapproved_runner_change_despite_matching_manifests(self) -> None:
        reports = self.archive / 'attempts/android-repeat1/reports'
        name = 'tools/check-weather-viewer.mjs'
        payload = (reports / 'inputs' / name).read_bytes() + b'changed Android code\n'
        (reports / 'inputs' / name).write_bytes(payload)
        identity = {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
        for phase in ('start', 'end'):
            path = reports / f'inputs-{phase}.json'
            manifest = read(path)
            manifest[name] = identity
            self.write(path, manifest)
        path = self.archive / 'checks/validation-input-difference.json'
        delta = read(path)
        delta['files'][0]['android'] = identity
        self.write(path, delta)
        self.save_index()
        with self.assertRaisesRegex(ValueError, 'exceeds desktop cleanup'):
            check_updates(self.root, offline=True)

    def test_rejects_changed_bytes_and_git_identity(self) -> None:
        path = self.archive / 'attempts/desktop-final2/reports/browser/browser.json'
        path.write_bytes(path.read_bytes() + b' ')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            check_updates(self.root, offline=True)
        self.save_index()
        path = self.archive / 'artifact-index.json'
        index = read(path)
        index['artifacts'][0]['git_object'] = '0'*40
        self.write(path, index)
        with self.assertRaisesRegex(ValueError, 'Git blob'):
            check_updates(self.root, offline=True)
