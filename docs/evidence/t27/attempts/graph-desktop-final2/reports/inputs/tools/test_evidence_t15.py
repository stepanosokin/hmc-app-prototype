"""Synthetic positive/negative archives through the public T15 CI boundary."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

from evidence_t15 import check_updates


class T15Evidence(unittest.TestCase):
    def write(self, path: Path, value: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf-8')

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.archive = self.root / 'docs/evidence/t15'
        inputs = {}
        names = ['viewer/main.ts', 'viewer/selection.ts', 'viewer/weather-layer.ts', 'tools/viewer-updates.mjs',
                 'tools/viewer-navigation.mjs', 'tools/check-weather-viewer.mjs', 'tools/run-weather-viewer.ps1',
                 'tools/viewer-update-reference.py', 'tools/publish-viewer-update.ps1',
                 'docs/prototypes/weather-map.prototype.html']
        for name in names:
            payload = ('synthetic source ' + name).encode()
            inputs[name] = {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
        for attempt, phone in [('final2', False), ('android-final2', True)]:
            base = self.archive / 'attempts' / attempt
            reports = base / 'reports'
            for name in names:
                target = reports / 'inputs' / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(('synthetic source ' + name).encode())
            for phase in ('start', 'end'):
                self.write(reports / f'inputs-{phase}.json', inputs)
            self.write(base / 'artifact-index.json', {'artifacts': []})
            self.write(base / 'retirement.json', {'status': 'retired', 'archive_verified': True,
                                                 'remaining': {'container': [], 'network': [], 'volume': []}})
            processes = ['browser', 'comparison', 'update-comparison', 'inputs-end']
            if not phone:
                processes += ['edge', 'edge-comparison', 'edge-update-comparison', 'unavailable', 'full-suite']
            (reports / 'process-results.jsonl').write_text('\n'.join(
                json.dumps({'check': p, 'native_exit_code': 0}) for p in processes))
            sizes = [(384, 694)] if phone else [(1440, 900), (390, 844), (360, 740), (640, 360)]
            before = {'run': 'synthetic-run', 'revision': 'old', 'selection': 'old.s3', 'valid_time': '03:00'}
            after = {**before, 'revision': 'new', 'selection': 'new.s3'}
            point = {**after, 'value': 280.0}
            races = [{'stage': s, 'cancel': c, 'pinned': True,
                      'retired_texture': s == 'upload', 'history': [
                          {'stage': s, 'event': 'real texture write before pause' if s == 'upload' else 'held'},
                          {'stage': s, 'event': 'released'}]}
                     for s, c in [('catalogue', 'newer response'), ('fetch', 'projection'), ('decode', 'projection'),
                                  ('upload', 'decline'), ('point', 'projection')]]
            updates = {'races': races, 'before': before, 'after': after, 'declined': True,
                       'failures': ['real API outage during revision load preserves field and point',
                                    'real catalogue failure clears obsolete acceptance action',
                                    'labelled injected GPU upload failure preserves pinned field',
                                    'real GPU context loss during staged update retains publication after recovery'],
                       'atomic': {'geometry_preserved': True, 'managed_bytes': 4096, 'point': point,
                                  'cache_identity': {'selection': after['selection'], 'identity': after}},
                       'gap_refresh': {**after, 'valid_time': '02:00'},
                       'new_run': {'run': 'synthetic-new-run', 'valid_time': '01:00', 'valid_times': ['01:00', '03:00']},
                       'resources': {'max_arrays': 2, 'max_array_bytes': 2048},
                       'replacements': [{'mode': m, 'managed_bytes': 4096} for m in ('mercator', 'orthographic', 'laea')],
                       'layouts': [{'width': w, 'height': h, 'sheet': {'top': 30, 'bottom': 150},
                                    'time': {'top': 200, 'bottom': 230}} for w, h in
                                   (sizes if phone else [(390, 844), (360, 740), (640, 360), (700, 740), (701, 740)])],
                       'mockup': {'sha256': inputs[names[-1]]['sha256']}}
            for browser in (['browser'] if phone else ['browser', 'browser-edge']):
                cleanup: dict[str, Any] = ({'page_released': True, 'test_tab_closed': True, 'adb_forward_removed': True,
                            'adb_reverse_removed': True, 'ui_dump_removed': True, 'user_chrome_retained': True}
                           if phone else {'page_released': True, 'browser_stopped': True, 'profile_removed': True,
                                          'browser_processes_remaining': 0})
                self.write(reports / browser / 'browser.json', {
                    'status': 'passed', 'errors': [], 'configuration': {'gpu_disabled': False, 'focused': False},
                    'viewports': [{'width': w, 'height': h} for w, h in sizes], 'cleanup': cleanup, 'updates': updates,
                    'executable': 'msedge.exe' if browser == 'browser-edge' else 'chrome.exe',
                    'android': {'model': 'explicit synthetic device'}, 'gpu': {'renderer': 'synthetic GPU'},
                    'native_selections': [{'committed': True}]})
                self.write(reports / f'{browser}-updates-comparison.json', {
                    'status': 'passed', 'source_sha256': '1'*64, 'valid_gpu_samples': 1, 'mask_differences': 0,
                    'max_abs_error_K': .001, 'edr_equal': True, 'point': point, 'wms_value_K': 280.0})
                comparison = 'native-comparison.json' if browser == 'browser' else 'native-comparison-edge.json'
                self.write(reports / comparison, {
                    'status': 'passed', 'source_sha256': '1'*64, 'mask_differences': 0, 'max_abs_error_K': .001,
                    'views': [{'viewport': size, 'mode': mode, 'valid_samples': 1}
                              for size in sizes for mode in ('mercator', 'hmc:orthographic', 'EPSG:3576')]})
                self.write(reports / f'{browser}-canonical.json', {
                    'status': 'passed', 'source_sha256': '1'*64,
                    'canonical_picks': [{'viewport': size, 'mode': mode}
                                        for size in sizes for mode in ('mercator', 'orthographic', 'laea')]})
            if not phone:
                self.write(reports / 'browser-unavailable/browser.json', {
                    'status': 'passed', 'errors': [], 'configuration': {'gpu_disabled': True},
                    'cleanup': {'page_released': True, 'browser_stopped': True, 'profile_removed': True,
                                'browser_processes_remaining': 0}})
        self.write(self.archive / 'checks/final-cleanup.json', {'t15_resources_remaining': 0, 'no_live_stack_retained': True})
        self.write(self.archive / 'android-tools/cleanup.json', {
            'owned_server_stopped': True, 'owned_keys_verified_before_removal': True, 'profile_removed': True,
            'sdk_removed': True, 'owned_processes_remaining': 0, 'owned_listeners_remaining': 0})
        self.write(self.archive / 'android-tools/device-cleanup.json', {
            'owner_confirmed_usb_debugging_disabled': True, 'owner_confirmed_cable_disconnected': True})
        self.save_index()

    def save_index(self) -> None:
        artifacts = []
        for path in sorted(self.archive.rglob('*')):
            if path.is_file() and path != self.archive / 'artifact-index.json':
                payload = path.read_bytes()
                artifacts.append({'name': path.relative_to(self.archive).as_posix(), 'bytes': len(payload),
                                  'sha256': hashlib.sha256(payload).hexdigest()})
        self.write(self.archive / 'artifact-index.json', {'artifacts': artifacts})

    def test_accepts_historical_inputs_after_workspace_changes(self) -> None:
        (self.root / 'viewer').mkdir()
        (self.root / 'viewer/main.ts').write_bytes(b'later live source')
        self.assertGreater(check_updates(self.root), 30)

    def test_rejects_changed_bytes_without_rehash(self) -> None:
        (self.archive / 'attempts/final2/reports/browser/browser.json').write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            check_updates(self.root)

    def test_rejects_semantic_corruption_even_after_rehash(self) -> None:
        report = 'attempts/final2/reports/browser/browser.json'
        cases = [
            (report, lambda d: d['configuration'].update(focused=True), 'full browser matrix'),
            (report, lambda d: d['viewports'].pop(), 'full browser matrix'),
            (report, lambda d: d['updates']['races'].pop(), 'update race'),
            (report, lambda d: d['updates']['races'][3].update(retired_texture=False), 'texture'),
            (report, lambda d: d['updates']['races'][2]['history'].pop(), 'held/released'),
            (report, lambda d: d['updates']['failures'].pop(), 'failure coverage'),
            (report, lambda d: d['updates']['after'].update(valid_time='04:00'), 'revision transition'),
            (report, lambda d: d['updates']['atomic']['point'].update(selection='stale'), 'atomic'),
            (report, lambda d: d['updates']['resources'].update(max_arrays=3), 'resource bound'),
            (report, lambda d: d['updates']['replacements'].pop(), 'replacement matrix'),
            (report, lambda d: d['updates']['layouts'].pop(), 'responsive matrix'),
            (report, lambda d: d['updates']['layouts'][0]['sheet'].update(bottom=300), 'overlap'),
            (report, lambda d: d['cleanup'].update(profile_removed=False), 'browser cleanup'),
            (report, lambda d: d['updates']['mockup'].update(sha256='0'*64), 'mockup identity'),
            ('attempts/android-final2/reports/browser/browser.json', lambda d: d['native_selections'][0].update(committed=False), 'physical input'),
            ('attempts/android-final2/reports/inputs-end.json', lambda d: d.pop('viewer/main.ts'), 'frozen inputs'),
            ('attempts/final2/reports/browser-updates-comparison.json', lambda d: d.update(valid_gpu_samples=0), 'numeric'),
            ('attempts/final2/reports/browser-updates-comparison.json', lambda d: d.update(max_abs_error_K=float('nan')), 'numeric'),
            ('attempts/final2/reports/browser-updates-comparison.json', lambda d: d.update(edr_equal=False), 'numeric'),
            ('attempts/final2/reports/browser-updates-comparison.json', lambda d: d.update(wms_value_K=281), 'numeric'),
            ('attempts/final2/reports/native-comparison-edge.json', lambda d: d.update(views=[]), 'baseline numeric'),
            ('attempts/android-final2/reports/browser-canonical.json', lambda d: d['canonical_picks'].pop(), 'canonical'),
            ('attempts/final2/reports/browser-unavailable/browser.json', lambda d: d['cleanup'].update(profile_removed=False), 'unavailable GPU'),
            ('attempts/final2/retirement.json', lambda d: d['remaining']['volume'].append('leftover'), 'retirement'),
            ('android-tools/cleanup.json', lambda d: d.update(sdk_removed=False), 'ADB'),
            ('android-tools/device-cleanup.json', lambda d: d.update(owner_confirmed_cable_disconnected=False), 'device'),
        ]
        for name, mutation, message in cases:
            with self.subTest(name=name, message=message):
                path = self.archive / name
                original = path.read_bytes()
                data = json.loads(original)
                mutation(data)
                self.write(path, data)
                self.save_index()
                with self.assertRaisesRegex(ValueError, message):
                    check_updates(self.root)
                path.write_bytes(original)
                self.save_index()

    def test_rejects_missing_frozen_copy_after_rehash(self) -> None:
        (self.archive / 'attempts/final2/reports/inputs/viewer/main.ts').unlink()
        self.save_index()
        with self.assertRaises(FileNotFoundError):
            check_updates(self.root)

    def test_rejects_unindexed_artifact(self) -> None:
        path = self.archive / 'artifact-index.json'
        index = json.loads(path.read_bytes())
        index['artifacts'].pop()
        self.write(path, index)
        with self.assertRaisesRegex(ValueError, 'coverage'):
            check_updates(self.root)

    def test_rejects_failed_process_after_rehash(self) -> None:
        path = self.archive / 'attempts/final2/reports/process-results.jsonl'
        processes = [json.loads(line) for line in path.read_text().splitlines()]
        processes[-1]['native_exit_code'] = 1
        path.write_text('\n'.join(json.dumps(p) for p in processes))
        self.save_index()
        with self.assertRaisesRegex(ValueError, 'process matrix'):
            check_updates(self.root)

    def test_rejects_missing_process_and_unsafe_or_duplicate_index(self) -> None:
        path = self.archive / 'attempts/final2/reports/process-results.jsonl'
        path.write_text('\n'.join(line for line in path.read_text().splitlines() if 'full-suite' not in line))
        self.save_index()
        with self.assertRaisesRegex(ValueError, 'process matrix'):
            check_updates(self.root)
        index_path = self.archive / 'artifact-index.json'
        index = json.loads(index_path.read_bytes())
        for name in ('../outside.json', '/outside.json', 'C:/outside.json'):
            with self.subTest(name=name):
                broken = json.loads(json.dumps(index))
                broken['artifacts'][0]['name'] = name
                self.write(index_path, broken)
                with self.assertRaisesRegex(ValueError, 'artifact path'):
                    check_updates(self.root)
        index['artifacts'].append(index['artifacts'][0])
        self.write(index_path, index)
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            check_updates(self.root)
