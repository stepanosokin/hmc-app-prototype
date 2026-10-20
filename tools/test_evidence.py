"""Archive integrity through the same entry point used by CI; synthetic bytes."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

from check_evidence import check, check_native_display


class BrowserEvidence(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        evidence = self.root / 'docs/evidence'
        for name in ('t3', 't5', 't6', 't7', 't8', 't9', 't10', 't11', 't12'):
            (evidence / name).mkdir(parents=True)
            (evidence / name / 'artifact-index.json').write_text('{"artifacts": []}')
        (evidence / 't4').mkdir()
        (self.root / 'publication').mkdir()
        contract = b'historical contract fixture'
        (self.root / 'publication/contract.v2.json').write_bytes(contract)
        (evidence / 't4/selection.json').write_text(json.dumps({
            'evidence_sha256': {}, 'contract_sha256': hashlib.sha256(contract).hexdigest(),
        }))
        self.archive = evidence / 't22'
        self.archive.mkdir()
        self.picture = self.archive / 'screenshot.png'
        self.picture.write_bytes(b'explicit synthetic screenshot bytes')
        self.source = self.root / 'prototype.js'
        self.source.write_bytes(b'historical runtime input')
        self.report: dict[str, Any] = {
            'status': 'passed', 'checks': ['visible control'], 'errors': [],
            'external_requests': [],
            'cleanup': {'browser_processes_remaining': 0, 'profile_removed': True,
                        'compose_projects_created': 0, 'servers_created': 0},
            'inputs': {'prototype.js': hashlib.sha256(self.source.read_bytes()).hexdigest()},
        }
        self.save_report()

    def save_report(self) -> None:
        (self.archive / 'validation.json').write_text(json.dumps(self.report))
        artifacts: list[dict[str, Any]] = []
        for path in (self.picture, self.archive / 'validation.json', self.source):
            payload = path.read_bytes()
            artifacts.append({
                'path': path.relative_to(self.root).as_posix(), 'bytes': len(payload),
                'sha256': hashlib.sha256(payload).hexdigest(),
                'git_object': hashlib.sha1(b'blob ' + str(len(payload)).encode() + b'\0' + payload).hexdigest(),
            })
        self.index: dict[str, Any] = {'schema': 1, 'selected_report': 'docs/evidence/t22/validation.json',
                      'selected_checks': 1, 'artifacts': artifacts}
        self.save_index()

    def save_index(self) -> None:
        (self.archive / 'artifact-index.json').write_text(json.dumps(self.index))

    def test_accepts_archive_and_historical_input_after_workspace_changes(self) -> None:
        self.source.write_bytes(b'a later implementation is allowed')
        self.assertEqual(check(self.root), 3)

    def test_rejects_corrupted_screenshot(self) -> None:
        self.picture.write_bytes(b'corruption')
        with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
            check(self.root)

    def test_rejects_incorrect_length_and_git_object(self) -> None:
        for key, value, message in (('bytes', -1, 'length mismatch'),
                                    ('git_object', '0' * 40, 'Git object mismatch')):
            with self.subTest(key=key):
                self.save_report()
                self.index['artifacts'][0][key] = value
                self.save_index()
                with self.assertRaisesRegex(ValueError, message):
                    check(self.root)

    def test_rejects_unbound_runtime_identity(self) -> None:
        self.report['inputs'] = {'prototype.js': '0' * 64}
        self.save_report()
        with self.assertRaisesRegex(ValueError, 'input identity'):
            check(self.root)

    def test_rejects_failed_selected_report_even_with_valid_hashes(self) -> None:
        self.report['status'] = 'failed'
        self.save_report()
        with self.assertRaisesRegex(ValueError, 'selected report'):
            check(self.root)

    def test_rejects_incomplete_browser_cleanup(self) -> None:
        self.report['cleanup'] = {'browser_processes_remaining': 1, 'profile_removed': False,
                                  'compose_projects_created': 0, 'servers_created': 0}
        self.save_report()
        with self.assertRaisesRegex(ValueError, 'cleanup'):
            check(self.root)

    def test_rejects_duplicate_and_escaping_paths(self) -> None:
        self.index['artifacts'].append(dict(self.index['artifacts'][0]))
        self.save_index()
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            check(self.root)
        self.index['artifacts'].pop()
        self.index['artifacts'][0]['path'] = '../outside'
        self.save_index()
        with self.assertRaisesRegex(ValueError, 'artifact path'):
            check(self.root)


class NativeEvidence(unittest.TestCase):
    """Synthetic archive at the CI entry point; no GRIB/browser/Compose required."""

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.archive = self.root / 'docs/evidence/t23a'
        self.archive.mkdir(parents=True)
        self.sources = {'probe.js': b'synthetic renderer', 'land.js': b'synthetic basemap'}
        inputs = [{'path': name, 'sha256': hashlib.sha256(value).hexdigest()}
                  for name, value in self.sources.items()]
        sizes = [(1440, 900), (390, 844), (360, 740)]
        modes = ['hmc:orthographic', 'EPSG:3576']
        comparison = {'status': 'passed', 'max_abs_error_K': .001, 'mask_differences': 0,
                      'geometry_max_error_pixels': 0, 'synthetic_projection_error_m': 0,
                      'views': [{'viewport': size, 'mode': mode, 'scope': scope,
                                 'valid_samples': 1, 'max_abs_error_K': .001, 'server_max_abs_error_K': .001}
                                for size in sizes for mode in modes
                                for scope in ('map', 'server-screen-comparison')]}
        report = {'status': 'compatibility-probe-complete', 'external_requests': [], 'exceptions': [],
                  'inputs': {item['path']: item['sha256'] for item in inputs},
                  'cleanup': {'browser_processes_remaining': 0, 'profile_removed': True,
                              'http_server_closed': True},
                  'viewports': [{'width': width, 'height': height, 'transfer_bytes': 100,
                                 'cold_first_show_ms': 100, 'warm_mode_switch_ms': 10,
                                 'views': [{'mode': mode, 'scripted_pan_zoom_p95_ms': 10,
                                            'estimated_managed_bytes': 100} for mode in modes]}
                                for width, height in sizes]}
        self.documents: dict[str, Any] = {
            'contract.json': {'contract': 'hmc-native-display/1', 'status': 'approved'},
            'inputs.json': inputs, 'inputs-end.json': json.loads(json.dumps(inputs)),
            'blocks.json': {'status': 'passed', 'encoding_max_abs_error_K': 0, 'blocks': 18},
        }
        selected = []
        for browser, executable in (('chrome', 'chrome.exe'), ('edge', 'msedge.exe')):
            browser_report = json.loads(json.dumps(report))
            browser_report['browser_executable'] = executable
            self.documents[browser+'.json'] = browser_report
            self.documents[browser+'-comparison.json'] = json.loads(json.dumps(comparison))
            selected.append({'browser': browser, 'project': 'native', 'report': browser+'.json',
                             'comparison': browser+'-comparison.json', 'inputs_end': 'inputs-end.json'})
        regressions = []
        for gate in ('t12', 't6'):
            self.documents[gate+'.json'] = {'status': 'passed', 'development': False}
            self.documents[gate+'-inputs.json'] = {'inputs': inputs}
            regressions.append({'name': gate, 'project': gate, 'result': gate+'.json',
                                'inputs': gate+'-inputs.json'})
        retirements = []
        for project in ('native', 't12', 't6'):
            name = project+'-retirement.json'
            self.documents[name] = {'project': project, 'status': 'retired', 'archive_verified': True,
                                    'remaining': {'container': [], 'network': [], 'volume': []}}
            retirements.append(name)
        self.index: dict[str, Any] = {'schema': 1, 'contract': 'contract.json', 'input_inventory': 'inputs.json',
                                     'selected': selected, 'blocks': 'blocks.json',
                                     'regressions': regressions, 'retirements': retirements}
        self.write_archive()

    def write_archive(self) -> None:
        for name, value in self.documents.items():
            (self.archive / name).write_text(json.dumps(value))
        for name, payload in self.sources.items():
            target = self.archive / 'inputs' / name
            target.parent.mkdir(exist_ok=True)
            target.write_bytes(payload)
        self.index['artifacts'] = [
            {'name': path.relative_to(self.archive).as_posix(), 'bytes': path.stat().st_size,
             'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            for path in sorted(self.archive.rglob('*')) if path.is_file() and path.name != 'artifact-index.json']
        (self.archive / 'artifact-index.json').write_text(json.dumps(self.index))

    def test_accepts_complete_archive_after_workspace_changes(self) -> None:
        (self.root / 'probe.js').write_bytes(b'later implementation')
        self.assertEqual(check_native_display(self.root), len(self.index['artifacts']))

    def test_rejects_incomplete_comparisons_with_valid_hashes(self) -> None:
        original = json.dumps(self.documents['chrome-comparison.json'])
        for missing in ('all', 'EPSG:3576', 'server-screen-comparison', 'viewport', 'samples'):
            with self.subTest(missing=missing):
                value = json.loads(original)
                value['views'] = [view for view in value['views'] if missing != 'all'
                                  and view['mode'] != missing and view['scope'] != missing
                                  and not (missing == 'viewport' and view['viewport'] == [360, 740])]
                if missing == 'samples':
                    value['views'][0]['valid_samples'] = 0
                self.documents['chrome-comparison.json'] = value
                self.write_archive()
                with self.assertRaisesRegex(ValueError, 'representative samples'):
                    check_native_display(self.root)

    def test_rejects_empty_renderer_and_missing_viewport(self) -> None:
        self.documents['chrome.json']['viewports'][0]['views'] = []
        self.write_archive()
        with self.assertRaisesRegex(ValueError, 'mode matrix'):
            check_native_display(self.root)
        self.documents['chrome.json']['viewports'].pop()
        self.write_archive()
        with self.assertRaisesRegex(ValueError, 'viewport matrix'):
            check_native_display(self.root)

    def test_rejects_missing_or_unrelated_retirement(self) -> None:
        for names in ([], ['native-retirement.json'], ['t12-retirement.json', 't6-retirement.json']):
            with self.subTest(receipts=names):
                self.index['retirements'] = names
                self.write_archive()
                with self.assertRaisesRegex(ValueError, 'retirement is missing'):
                    check_native_display(self.root)

    def test_rejects_live_resources(self) -> None:
        self.documents['native-retirement.json']['remaining']['container'] = ['live']
        self.write_archive()
        with self.assertRaisesRegex(ValueError, 'retirement is incomplete'):
            check_native_display(self.root)

    def test_rejects_changed_and_unbound_inputs(self) -> None:
        self.documents['inputs-end.json'][0]['sha256'] = '0'*64
        self.write_archive()
        with self.assertRaisesRegex(ValueError, 'inputs changed'):
            check_native_display(self.root)
        self.documents['inputs-end.json'] = json.loads(json.dumps(self.documents['inputs.json']))
        self.documents['chrome.json']['inputs']['unrecorded-land.js'] = '0'*64
        self.write_archive()
        with self.assertRaisesRegex(ValueError, 'browser input mismatch'):
            check_native_display(self.root)

    def test_rejects_budget_overruns(self) -> None:
        original = json.dumps(self.documents['chrome.json'])
        for key, limit, is_view in (('cold_first_show_ms', 3000, False), ('warm_mode_switch_ms', 1000, False),
                                    ('transfer_bytes', 8*1024**2, False),
                                    ('scripted_pan_zoom_p95_ms', 33, True),
                                    ('estimated_managed_bytes', 128*1024**2, True)):
            with self.subTest(budget=key):
                report = json.loads(original)
                target = report['viewports'][0]['views'][0] if is_view else report['viewports'][0]
                target[key] = limit+1
                self.documents['chrome.json'] = report
                self.write_archive()
                with self.assertRaisesRegex(ValueError, 'budget did not pass'):
                    check_native_display(self.root)

    def test_rejects_missing_or_development_regression(self) -> None:
        self.documents['t12.json']['development'] = True
        self.write_archive()
        with self.assertRaisesRegex(ValueError, 'regression did not pass'):
            check_native_display(self.root)
        self.index['regressions'].pop()
        self.write_archive()
        with self.assertRaisesRegex(ValueError, 'regressions are incomplete'):
            check_native_display(self.root)

    def test_rejects_corrupted_native_artifact(self) -> None:
        (self.archive / 'blocks.json').write_bytes(b'corruption')
        with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
            check_native_display(self.root)
