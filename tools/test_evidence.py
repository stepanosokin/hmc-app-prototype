"""Archive integrity through the same entry point used by CI; synthetic bytes."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

from check_evidence import check, check_browser_archive, check_native_display, check_t23_archives, check_viewer_navigation


class T14Evidence(unittest.TestCase):
    """Synthetic archives exercise the same public checker as historical CI."""

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.archive = self.root / 'docs/evidence/t14'
        self.reports = self.archive / 'attempts/final1/reports'
        self.inputs = {}
        for name in ['viewer/main.ts', 'viewer/selection.ts', 'viewer/field.ts',
                     'viewer/weather-layer.ts', 'viewer/native-layer.js', 'viewer/geometry.js',
                     'tools/check-weather-viewer.mjs', 'tools/viewer-navigation.mjs',
                     'tools/run-weather-viewer.ps1', 'tools/weather-viewer-inputs.mjs',
                     'docs/prototypes/forecast-interaction.prototype.html']:
            payload = ('explicit synthetic source: ' + name).encode()
            path = self.reports / 'inputs' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
            self.inputs[name] = {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
        for phase in ('start', 'end'):
            self.write(self.reports / f'inputs-{phase}.json', self.inputs)
        empty: dict[str, list[str]] = {'container': [], 'network': [], 'volume': []}
        self.write(self.archive / 'attempts/final1/retirement.json', {
            'project': 'synthetic-t14', 'status': 'retired', 'archive_verified': True, 'remaining': empty})
        self.write(self.archive / 'attempts/final1/artifact-index.json', {'artifacts': []})
        self.write(self.archive / 'final-resource-inventory.json', {
            'status': 'passed', 'live_projects_retained': [], 'projects': [{'project': 'synthetic-t14', 'remaining': empty}]})
        self.write(self.archive / 'checks/preflight.json', {'sample_sha256': '1' * 64})
        self.processes = [{'check': name, 'native_exit_code': 0} for name in (
            'browser', 'comparison', 'edge', 'edge-comparison', 'unavailable', 'full-suite', 'inputs-end')]
        self.save_processes()
        sizes = [(1440, 900), (390, 844), (360, 740), (640, 360)]
        cleanup = {'page_released': True, 'browser_stopped': True, 'profile_removed': True, 'browser_processes_remaining': 0}
        races = [{'stage': stage, 'destination': destination, 'obsolete_completion_rejected': True,
                  'history': [{'stage': stage, 'event': 'real texture write before pause' if stage == 'upload' else 'held'},
                              {'stage': stage, 'event': 'released'}]}
                 for stage in ('fetch', 'decode', 'upload') for destination in ('gap', 'run')]
        races.append({'stage': 'point', 'different_run_after_release': True,
                      'history': [{'stage': 'point', 'event': 'held'}, {'stage': 'point', 'event': 'released'}]})
        for browser, executable, comparison in [('browser', 'chrome.exe', 'native-comparison.json'),
                                                ('browser-edge', 'msedge.exe', 'native-comparison-edge.json')]:
            self.write(self.reports / browser / 'browser.json', {
                'status': 'passed', 'executable': executable, 'errors': [], 'cleanup': cleanup,
                'configuration': {'gpu_disabled': False, 'focused': False},
                'viewports': [{'width': w, 'height': h} for w, h in sizes],
                'prototype_comparison': {'source_sha256': self.inputs['docs/prototypes/forecast-interaction.prototype.html']['sha256'],
                                         'states': [{'Forecast lead': '+1 hours', 'Run reference': 'synthetic-new', 'Published snapshot': 'r1'},
                                                    {'Run reference': 'synthetic-new', 'Published snapshot': 'r1', 'Current frame': 'Unavailable'},
                                                    {'Forecast lead': '+1 hours', 'Run reference': 'synthetic-old'}],
                                         'matched_rules': ['first available time', 'run change resets time',
                                                           'time navigation pins reference and revision', 'gap clears overlay and point value']},
                'navigation': {'races': races},
            })
            self.write(self.reports / comparison, {
                'status': 'passed', 'source_sha256': '1' * 64, 'mask_differences': 0, 'max_abs_error_K': .001,
                'views': [{'viewport': size, 'mode': mode, 'valid_samples': 1}
                          for size in sizes for mode in ('mercator', 'hmc:orthographic', 'EPSG:3576')]})
            self.write(self.reports / (browser + '-canonical.json'), {
                'status': 'passed', 'source_sha256': '1' * 64,
                'canonical_picks': [{'viewport': size, 'mode': mode} for size in sizes for mode in ('mercator', 'orthographic', 'laea')]})
        self.write(self.reports / 'browser-unavailable/browser.json', {
            'status': 'passed', 'configuration': {'gpu_disabled': True}, 'errors': [], 'cleanup': cleanup})
        self.save_index()

    def write(self, path: Path, data: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))

    def save_processes(self) -> None:
        (self.reports / 'process-results.jsonl').write_text('\n'.join(json.dumps(item) for item in self.processes))

    def save_index(self) -> None:
        artifacts = []
        for path in sorted(self.archive.rglob('*')):
            if path.is_file() and path != self.archive / 'artifact-index.json':
                payload = path.read_bytes()
                artifacts.append({'path': path.relative_to(self.root).as_posix(), 'bytes': len(payload),
                                  'sha256': hashlib.sha256(payload).hexdigest()})
        self.write(self.archive / 'artifact-index.json', {'artifacts': artifacts})

    def alter(self, relative: str, change: Any) -> None:
        path = self.reports / relative
        data = json.loads(path.read_bytes())
        change(data)
        self.write(path, data)
        self.save_index()

    def test_accepts_historical_archive_after_live_source_changes(self) -> None:
        (self.root / 'viewer').mkdir()
        (self.root / 'viewer/main.ts').write_bytes(b'later runtime')
        self.assertGreater(check_viewer_navigation(self.root), 20)

    def test_rejects_corrupt_bytes(self) -> None:
        (self.reports / 'browser/browser.json').write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            check_viewer_navigation(self.root)

    def test_rejects_missing_input_after_rehash(self) -> None:
        (self.reports / 'inputs/viewer/main.ts').unlink()
        self.save_index()
        with self.assertRaises(FileNotFoundError):
            check_viewer_navigation(self.root)

    def test_rejects_changed_end_identity_after_rehash(self) -> None:
        self.alter('inputs-end.json', lambda data: data.pop('viewer/main.ts'))
        with self.assertRaisesRegex(ValueError, 'frozen inputs'):
            check_viewer_navigation(self.root)

    def test_rejects_focused_matrix_after_rehash(self) -> None:
        self.alter('browser/browser.json', lambda data: data['configuration'].update(focused=True))
        with self.assertRaisesRegex(ValueError, 'full matrix'):
            check_viewer_navigation(self.root)

    def test_rejects_missing_viewport_after_rehash(self) -> None:
        self.alter('browser-edge/browser.json', lambda data: data['viewports'].pop())
        with self.assertRaisesRegex(ValueError, 'full matrix'):
            check_viewer_navigation(self.root)

    def test_rejects_missing_upload_race_after_rehash(self) -> None:
        self.alter('browser/browser.json', lambda data: data['navigation']['races'].pop(5))
        with self.assertRaisesRegex(ValueError, 'numeric race'):
            check_viewer_navigation(self.root)

    def test_rejects_point_without_release_after_rehash(self) -> None:
        self.alter('browser/browser.json', lambda data: data['navigation']['races'][-1]['history'].pop())
        with self.assertRaisesRegex(ValueError, 'point race'):
            check_viewer_navigation(self.root)

    def test_rejects_prototype_link_without_observations_after_rehash(self) -> None:
        self.alter('browser/browser.json', lambda data: data.pop('prototype_comparison'))
        with self.assertRaisesRegex(ValueError, 'prototype comparison'):
            check_viewer_navigation(self.root)

    def test_rejects_empty_numeric_report_even_when_marked_passed(self) -> None:
        self.alter('native-comparison.json', lambda data: data.update(views=[], max_abs_error_K=0))
        with self.assertRaisesRegex(ValueError, 'numeric matrix'):
            check_viewer_navigation(self.root)

    def test_rejects_nonfinite_numeric_error_after_rehash(self) -> None:
        self.alter('native-comparison.json', lambda data: data.update(max_abs_error_K=float('nan')))
        with self.assertRaisesRegex(ValueError, 'numeric matrix'):
            check_viewer_navigation(self.root)

    def test_rejects_browser_profile_left_behind_after_rehash(self) -> None:
        self.alter('browser/browser.json', lambda data: data['cleanup'].update(profile_removed=False))
        with self.assertRaisesRegex(ValueError, 'browser cleanup'):
            check_viewer_navigation(self.root)

    def test_rejects_unretired_project_after_rehash(self) -> None:
        path = self.archive / 'attempts/final1/retirement.json'
        receipt = json.loads(path.read_bytes())
        receipt['remaining']['volume'].append('synthetic-leftover')
        self.write(path, receipt)
        self.save_index()
        with self.assertRaisesRegex(ValueError, 'retirement'):
            check_viewer_navigation(self.root)

    def test_rejects_failed_full_suite_after_rehash(self) -> None:
        self.processes[-2]['native_exit_code'] = 1
        self.save_processes()
        self.save_index()
        with self.assertRaisesRegex(ValueError, 'processes'):
            check_viewer_navigation(self.root)

    def test_rejects_unindexed_artifact(self) -> None:
        path = self.archive / 'artifact-index.json'
        index = json.loads(path.read_bytes())
        index['artifacts'].pop()
        self.write(path, index)
        with self.assertRaisesRegex(ValueError, 'coverage'):
            check_viewer_navigation(self.root)

    def test_rejects_path_outside_archive(self) -> None:
        path = self.archive / 'artifact-index.json'
        index = json.loads(path.read_bytes())
        index['artifacts'][0]['path'] = '../outside.json'
        self.write(path, index)
        with self.assertRaisesRegex(ValueError, 'artifact path'):
            check_viewer_navigation(self.root)

    def test_rejects_prototype_gap_borrowing_another_revision(self) -> None:
        self.alter('browser/browser.json', lambda data: data['prototype_comparison']['states'][1].update({'Published snapshot': 'r2'}))
        with self.assertRaisesRegex(ValueError, 'prototype comparison'):
            check_viewer_navigation(self.root)

    def test_rejects_unavailable_renderer_without_cleanup(self) -> None:
        self.alter('browser-unavailable/browser.json', lambda data: data['cleanup'].update(profile_removed=False))
        with self.assertRaisesRegex(ValueError, 'unavailable GPU'):
            check_viewer_navigation(self.root)


class T24Evidence(unittest.TestCase):
    """The mockup archive boundary rejects incomplete browser/geometry evidence."""
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.archive = self.root / 'docs/evidence/t24'
        self.archive.mkdir(parents=True)
        source = b'synthetic historical mockup'
        (self.root / 'prototype.js').write_bytes(source)
        self.source = source
        self.selections = []
        sizes = [(1038, 465), (844, 390), (740, 360), (667, 375), (640, 360)]
        layout_checks = []
        for width, height in sizes:
            name = f'landscape-{width}x{height}'
            layout_checks += [name+' controls start collapsed',
                             name+' collapsed panels are inside viewport without intersections',
                             name+' rotating to portrait retains forecast and point',
                             name+' rotating back retains point with clear layout']
            layout_checks += [name+' '+panel+' replaces point drawer without losing selection'
                              for panel in ('forecastPanel', 'navigationPanel', 'legendPanel', 'timelinePanel')]
        for browser, executable in (('chrome', 'chrome.exe'), ('edge', 'msedge.exe')):
            directory = self.archive / browser
            (directory / 'inputs').mkdir(parents=True)
            (directory / 'inputs/prototype.js').write_bytes(source)
            (directory / 'validation.json').write_text(json.dumps({
                'status': 'passed', 'checks': layout_checks, 'errors': [], 'external_requests': [],
                'scope': 'T24 projection mockup; desktop browser and emulated mobile viewport, not real hardware or production GPU/API',
                'landscape_repro': [{'viewport': list(size)} for size in sizes],
                'inputs': {'prototype.js': hashlib.sha256(source).hexdigest()},
                'browser_executable': executable,
                'cleanup': {'browser_processes_remaining': 0, 'profile_removed': True,
                            'compose_projects_created': 0, 'servers_created': 0},
            }))
            (directory / 'geometry-reference.json').write_text(json.dumps({
                'status': 'passed', 'controls': 57, 'max_error_px': .001,
                'forward_tolerance_px': .05, 'inverse_tolerance_deg': 1e-5,
            }))
            self.selections.append({'browser': browser, 'report': f'docs/evidence/t24/{browser}/validation.json', 'checks': len(layout_checks)})
        self.save_index()

    def save_index(self) -> None:
        artifacts = []
        for path in [self.root / 'prototype.js', *sorted(self.archive.rglob('*'))]:
            if not path.is_file() or path.name == 'artifact-index.json':
                continue
            payload = path.read_bytes()
            artifacts.append({'path': path.relative_to(self.root).as_posix(), 'bytes': len(payload),
                              'sha256': hashlib.sha256(payload).hexdigest(),
                              'git_object': hashlib.sha1(b'blob '+str(len(payload)).encode()+b'\0'+payload).hexdigest()})
        (self.archive / 'artifact-index.json').write_text(json.dumps({
            'schema': 1, 'artifacts': artifacts, 'selected_reports': self.selections,
        }))

    def test_accepts_frozen_inputs_after_live_workspace_changes(self) -> None:
        # Preserve the original identity in the index, as the real archive does.
        (self.root / 'prototype.js').write_bytes(b'later implementation')
        self.assertEqual(check_browser_archive(self.root, 't24'), 6)

    def test_rejects_missing_browser_even_after_rehash(self) -> None:
        self.selections.pop()
        self.save_index()
        with self.assertRaisesRegex(ValueError, 'matrix'):
            check_browser_archive(self.root, 't24')

    def test_rejects_frozen_input_drift_even_after_rehash(self) -> None:
        (self.archive / 'edge/inputs/prototype.js').write_bytes(b'changed')
        self.save_index()
        with self.assertRaisesRegex(ValueError, 'checksum'):
            check_browser_archive(self.root, 't24')

    def test_rejects_failed_geometry_even_after_rehash(self) -> None:
        path = self.archive / 'edge/geometry-reference.json'
        reference = json.loads(path.read_bytes())
        reference['max_error_px'] = .1
        path.write_text(json.dumps(reference))
        self.save_index()
        with self.assertRaisesRegex(ValueError, 'geometry'):
            check_browser_archive(self.root, 't24')

    def test_rejects_unindexed_artifact(self) -> None:
        (self.archive / 'unindexed.png').write_bytes(b'forgotten evidence')
        with self.assertRaisesRegex(ValueError, 'coverage'):
            check_browser_archive(self.root, 't24')

    def test_rejects_focused_success_even_after_rehash(self) -> None:
        path = self.archive / 'edge/validation.json'
        report = json.loads(path.read_bytes())
        report['scope'] = 'Focused landscape layout regression only; not full T24 acceptance'
        path.write_text(json.dumps(report))
        self.save_index()
        with self.assertRaisesRegex(ValueError, 'full acceptance'):
            check_browser_archive(self.root, 't24')

    def test_rejects_missing_landscape_size_even_after_rehash(self) -> None:
        path = self.archive / 'edge/validation.json'
        report = json.loads(path.read_bytes())
        report['landscape_repro'].pop()
        path.write_text(json.dumps(report))
        self.save_index()
        with self.assertRaisesRegex(ValueError, 'landscape matrix'):
            check_browser_archive(self.root, 't24')

    def test_rejects_missing_transition_even_with_matching_count_and_hashes(self) -> None:
        path = self.archive / 'edge/validation.json'
        report = json.loads(path.read_bytes())
        report['checks'].pop()
        path.write_text(json.dumps(report))
        self.selections[1]['checks'] = len(report['checks'])
        self.save_index()
        with self.assertRaisesRegex(ValueError, 'layout interactions'):
            check_browser_archive(self.root, 't24')


class T23Evidence(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for phase in ('continuation', 'diagnosis', 'implementation'):
            archive = self.root / 'docs/evidence/t23' / phase
            archive.mkdir(parents=True)
            payload = b'synthetic frozen input or failed attempt'
            (archive / 'report.json').write_bytes(payload)
            (archive / 'artifact-index.json').write_text(json.dumps({'schema': 1, 'artifacts': [{
                'path': 'report.json', 'bytes': len(payload),
                'sha256': hashlib.sha256(payload).hexdigest(),
            }]}))
        self.archive = self.root / 'docs/evidence/t23/implementation'

    def test_accepts_all_three_historical_archives(self) -> None:
        self.assertEqual(check_t23_archives(self.root), 3)

    def test_rejects_corruption_in_each_phase(self) -> None:
        for phase in ('continuation', 'diagnosis', 'implementation'):
            path = self.root / 'docs/evidence/t23' / phase / 'report.json'
            original = path.read_bytes()
            path.write_bytes(b'corrupt')
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                check_t23_archives(self.root)
            path.write_bytes(original)

    def test_rejects_invalid_index_and_missing_coverage(self) -> None:
        path = self.archive / 'artifact-index.json'
        original = json.loads(path.read_bytes())
        for kind in ('duplicate', 'escape', 'empty', 'length', 'schema'):
            with self.subTest(kind=kind):
                index = json.loads(json.dumps(original))
                if kind == 'duplicate':
                    index['artifacts'] *= 2
                elif kind == 'escape':
                    index['artifacts'][0]['path'] = '../outside'
                elif kind == 'empty':
                    index['artifacts'] = []
                elif kind == 'length':
                    index['artifacts'][0]['bytes'] = -1
                else:
                    index['schema'] = 2
                path.write_text(json.dumps(index))
                with self.assertRaises(ValueError):
                    check_t23_archives(self.root)

    def test_rejects_unindexed_file(self) -> None:
        (self.archive / 'unindexed.png').write_bytes(b'new bytes')
        with self.assertRaisesRegex(ValueError, 'coverage'):
            check_t23_archives(self.root)

    def test_rejects_missing_artifact(self) -> None:
        (self.archive / 'report.json').unlink()
        with self.assertRaises(FileNotFoundError):
            check_t23_archives(self.root)


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
