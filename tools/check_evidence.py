"""Verify archived evidence against its recorded byte hashes; no sample required."""

import argparse
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
from typing import Any


def verify(path: Path, expected: str, size: int | None = None) -> None:
    payload = path.read_bytes()
    if hashlib.sha256(payload).hexdigest() != expected:
        raise ValueError(f'evidence checksum mismatch: {path}')
    if size is not None and len(payload) != size:
        raise ValueError(f'evidence length mismatch: {path}')


def check_browser_archive(root: Path, ticket: str = 't22') -> int:
    """Check mockup archive bytes and identities, not future live inputs."""
    prefix = f'docs/evidence/{ticket}/'
    index = json.loads((root / prefix / 'artifact-index.json').read_bytes())
    if index['schema'] != 1:
        raise ValueError('unsupported browser evidence schema')
    artifacts: dict[str, Any] = {}
    count = 0
    for artifact in index['artifacts']:
        name = artifact['path']
        path = PurePosixPath(name)
        if (path.is_absolute() or '..' in path.parts or '\\' in name
                or ':' in name or path.as_posix() != name):
            raise ValueError(f'invalid browser artifact path: {name}')
        if name in artifacts:
            raise ValueError(f'duplicate browser artifact: {name}')
        artifacts[name] = artifact
        if name.startswith(prefix):
            verify(root / name, artifact['sha256'], artifact['bytes'])
            payload = (root / name).read_bytes()
            blob = b'blob ' + str(len(payload)).encode() + b'\0' + payload
            if hashlib.sha1(blob).hexdigest() != artifact['git_object']:
                raise ValueError(f'evidence Git object mismatch: {name}')
            count += 1
    selections = (index['selected_reports'] if 'selected_reports' in index else
                  [{'report': index['selected_report'], 'checks': index['selected_checks']}])
    if ticket == 't24':
        if len(selections) != 2 or {item.get('browser') for item in selections} != {'chrome', 'edge'}:
            raise ValueError('T24 browser matrix is incomplete')
        actual = {path.relative_to(root).as_posix() for path in (root / prefix).rglob('*')
                  if path.is_file() and path.name != 'artifact-index.json'}
        if actual != {name for name in artifacts if name.startswith(prefix)}:
            raise ValueError('T24 artifact coverage is incomplete')
    for selection in selections:
        check_browser_report(root, prefix, selection, artifacts, ticket)
    return count


def check_browser_report(root: Path, prefix: str, selection: dict[str, Any],
                         artifacts: dict[str, Any], ticket: str) -> None:
    selected = selection['report']
    if selected not in artifacts or not selected.startswith(prefix):
        raise ValueError('browser selected report is not archived')
    report = json.loads((root / selected).read_bytes())
    if (report['status'] != 'passed' or len(report['checks']) != selection['checks']
            or report['errors'] or report['external_requests']):
        raise ValueError('browser selected report is not passing')
    cleanup = report['cleanup']
    if (cleanup['browser_processes_remaining'] != 0 or cleanup['profile_removed'] is not True
            or cleanup['compose_projects_created'] != 0 or cleanup['servers_created'] != 0):
        raise ValueError('browser evidence cleanup is incomplete')
    for name, checksum in report['inputs'].items():
        if name not in artifacts or artifacts[name]['sha256'] != checksum:
            raise ValueError(f'browser input identity mismatch: {name}')
        if ticket == 't24':
            verify((root / selected).parent / 'inputs' / name, checksum)
    if ticket == 't24':
        if report.get('scope') != ('T24 projection mockup; desktop browser and emulated mobile viewport, '
                                   'not real hardware or production GPU/API'):
            raise ValueError('T24 selected report is not full acceptance')
        sizes = {(1038, 465), (844, 390), (740, 360), (667, 375), (640, 360)}
        observed = {tuple(item['viewport']) for item in report.get('landscape_repro', [])}
        if not sizes.issubset(observed):
            raise ValueError('T24 landscape matrix is incomplete')
        required = set()
        for width, height in sizes:
            name = f'landscape-{width}x{height}'
            required.update({name+' controls start collapsed',
                             name+' collapsed panels are inside viewport without intersections',
                             name+' rotating to portrait retains forecast and point',
                             name+' rotating back retains point with clear layout'})
            required.update(name+' '+panel+' replaces point drawer without losing selection'
                            for panel in ('forecastPanel', 'navigationPanel', 'legendPanel', 'timelinePanel'))
        if not required.issubset(report['checks']):
            raise ValueError('T24 layout interactions are incomplete')
        reference = json.loads(((root / selected).parent / 'geometry-reference.json').read_bytes())
        executable = report.get('browser_executable', '').lower()
        expected = 'chrome.exe' if selection['browser'] == 'chrome' else 'msedge.exe'
        if not executable.endswith(expected):
            raise ValueError('T24 browser executable identity mismatch')
        if (reference['status'] != 'passed' or reference['controls'] < 50
                or reference['max_error_px'] > .05 or reference['forward_tolerance_px'] != .05
                or reference['inverse_tolerance_deg'] != 1e-5):
            raise ValueError('T24 geometry reference failed')


def check(root: Path) -> int:
    evidence = root / 'docs/evidence'
    t3 = evidence / 't3'
    index = json.loads((t3 / 'artifact-index.json').read_bytes())
    count = 0
    for artifact in index['artifacts']:
        verify(t3 / artifact['name'], artifact['sha256'], artifact['bytes'])
        count += 1
    t4 = evidence / 't4'
    selected = json.loads((t4 / 'selection.json').read_bytes())
    for name, checksum in selected['evidence_sha256'].items():
        verify(t4 / name, checksum)
        count += 1
    # Historical T4 evidence belongs to frozen v2, even after a future v3 exists.
    verify(root / 'publication/contract.v2.json', selected['contract_sha256'])
    count += 1
    for name in ('t5', 't6', 't7', 't8', 't9', 't10', 't11', 't12'):
        archive = evidence / name
        index = json.loads((archive / 'artifact-index.json').read_bytes())
        for artifact in index['artifacts']:
            verify(archive / artifact['name'], artifact['sha256'], artifact['bytes'])
            count += 1
    return count + check_browser_archive(root)


def check_native_display(root: Path) -> int:
    """Verify the selected T23a proof without comparing future workspace bytes."""
    archive = root / 'docs/evidence/t23a'
    index = json.loads((archive / 'artifact-index.json').read_bytes())
    if index['schema'] != 1:
        raise ValueError('unsupported native display evidence schema')
    artifacts = {}
    for artifact in index['artifacts']:
        name = artifact['name']
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name or path.as_posix() != name:
            raise ValueError('invalid native artifact path')
        if name in artifacts:
            raise ValueError('duplicate native artifact')
        verify(archive / name, artifact['sha256'], artifact['bytes'])
        artifacts[name] = artifact

    def read(name):
        if name not in artifacts:
            raise ValueError('native reference is not archived: ' + name)
        return json.loads((archive / name).read_bytes())

    contract = read(index['contract'])
    if contract['contract'] != 'hmc-native-display/1' or 'approved' not in contract['status']:
        raise ValueError('native contract is not approved')
    sources = {item['path']: item['sha256'] for item in read(index['input_inventory'])}
    for path, checksum in sources.items():
        if artifacts.get('inputs/'+path, {}).get('sha256') != checksum:
            raise ValueError('native source identity is not archived: ' + path)
    if len(index['selected']) != 2 or {item['browser'] for item in index['selected']} != {'chrome', 'edge'}:
        raise ValueError('native desktop browser matrix is incomplete')
    required_projects = set()
    dimensions = {(1440, 900), (390, 844), (360, 740)}
    modes = {'hmc:orthographic', 'EPSG:3576'}
    expected = {(size, mode, scope) for size in dimensions for mode in modes
                for scope in ('map', 'server-screen-comparison')}
    for selection in index['selected']:
        required_projects.add(selection['project'])
        report, comparison = read(selection['report']), read(selection['comparison'])
        if read(selection['inputs_end']) != read(index['input_inventory']):
            raise ValueError('native inputs changed during validation')
        if report['status'] != 'compatibility-probe-complete' or report['external_requests'] or report['exceptions']:
            raise ValueError('native browser probe did not pass')
        if not report['browser_executable'].lower().endswith('msedge.exe' if selection['browser'] == 'edge' else 'chrome.exe'):
            raise ValueError('native browser identity mismatch')
        for path, checksum in report['inputs'].items():
            if sources.get(path) != checksum:
                raise ValueError('native browser input mismatch: ' + path)
        cleanup = report['cleanup']
        if (cleanup['browser_processes_remaining'] or not cleanup['profile_removed'] or not cleanup['http_server_closed']):
            raise ValueError('native browser cleanup is incomplete')
        if (comparison['status'] != 'passed' or comparison['max_abs_error_K'] > .01 or comparison['mask_differences']
                or comparison['geometry_max_error_pixels'] > .001 or comparison['synthetic_projection_error_m'] > 10):
            raise ValueError('native numeric proof did not pass')
        actual = [(tuple(item['viewport']), item['mode'], item['scope']) for item in comparison['views']]
        if (len(actual) != len(expected) or set(actual) != expected
                or any(item['valid_samples'] <= 0 or item['max_abs_error_K'] > .01
                       or item['server_max_abs_error_K'] > .01 for item in comparison['views'])):
            raise ValueError('native comparison has no representative samples')
        if (len(report['viewports']) != len(dimensions)
                or {(item['width'], item['height']) for item in report['viewports']} != dimensions):
            raise ValueError('native viewport matrix is incomplete')
        for viewport in report['viewports']:
            if len(viewport['views']) != 2 or {view['mode'] for view in viewport['views']} != modes:
                raise ValueError('native renderer mode matrix is incomplete')
            if (viewport['transfer_bytes'] > 8*1024**2 or viewport['cold_first_show_ms'] > 3000
                    or viewport['warm_mode_switch_ms'] > 1000):
                raise ValueError('native delivery budget did not pass')
            if any(view['scripted_pan_zoom_p95_ms'] > 33 or view['estimated_managed_bytes'] > 128*1024**2
                   for view in viewport['views']):
                raise ValueError('native desktop frame or memory budget did not pass')
    blocks = read(index['blocks'])
    if blocks['status'] != 'passed' or blocks['encoding_max_abs_error_K'] > .001 or blocks['blocks'] != 18:
        raise ValueError('native block encoding proof did not pass')
    if {gate['name'] for gate in index['regressions']} != {'t12', 't6'}:
        raise ValueError('native service regressions are incomplete')
    for gate in index['regressions']:
        required_projects.add(gate['project'])
        result = read(gate['result'])
        if result['status'] != 'passed' or result.get('development', False):
            raise ValueError('native service regression did not pass')
        for item in read(gate['inputs'])['inputs']:
            if sources.get(item['path']) != item['sha256']:
                raise ValueError('native regression input mismatch: ' + item['path'])
    retired_projects = set()
    for name in index['retirements']:
        receipt = read(name)
        retired_projects.add(receipt['project'])
        if (receipt['status'] != 'retired' or not receipt['archive_verified']
                or any(receipt['remaining'][kind] for kind in ('container', 'network', 'volume'))):
            raise ValueError('native retirement is incomplete')
    if not required_projects.issubset(retired_projects):
        raise ValueError('native validation project retirement is missing')
    return len(artifacts)


def check_t23_archives(root: Path) -> int:
    """Verify T23's three frozen archives, including unsuccessful attempts."""
    count = 0
    for phase in ('continuation', 'diagnosis', 'implementation'):
        archive = root / 'docs/evidence/t23' / phase
        index = json.loads((archive / 'artifact-index.json').read_bytes())
        if index.get('schema', 1) != 1:
            raise ValueError('unsupported T23 evidence schema')
        names = set()
        for artifact in index['artifacts']:
            name = artifact['path']
            path = PurePosixPath(name)
            if (path.is_absolute() or '..' in path.parts or '\\' in name
                    or ':' in name or path.as_posix() != name):
                raise ValueError('invalid T23 artifact path: ' + name)
            if name in names:
                raise ValueError('duplicate T23 artifact: ' + name)
            names.add(name)
            verify(archive / name, artifact['sha256'], artifact['bytes'])
            count += 1
        actual = {path.relative_to(archive).as_posix() for path in archive.rglob('*')
                  if path.is_file() and path != archive / 'artifact-index.json'}
        if not names or names != actual:
            raise ValueError('T23 artifact coverage is incomplete: ' + phase)
    return count


def check_viewer_navigation(root: Path) -> int:
    """Verify historical T14 bytes and full acceptance, independently of live inputs."""
    archive = root / 'docs/evidence/t14'
    index = json.loads((archive / 'artifact-index.json').read_bytes())
    names: set[str] = set()
    for item in index['artifacts']:
        name = item['path']
        path = PurePosixPath(name)
        if (not name.startswith('docs/evidence/t14/') or '..' in path.parts
                or '\\' in name or ':' in name or path.as_posix() != name or name in names):
            raise ValueError('invalid or duplicate T14 artifact path')
        names.add(name)
        verify(root / name, item['sha256'], item['bytes'])
    actual = {path.relative_to(root).as_posix() for path in archive.rglob('*')
              if path.is_file() and path != archive / 'artifact-index.json'}
    if names != actual:
        raise ValueError('T14 artifact coverage is incomplete')

    def read(path: Path) -> Any:
        return json.loads(path.read_bytes())

    inventory = read(archive / 'final-resource-inventory.json')
    if inventory['status'] != 'passed' or inventory['live_projects_retained']:
        raise ValueError('T14 resource inventory is incomplete')
    projects = {item['project']: item['remaining'] for item in inventory['projects']}
    empty: dict[str, list[str]] = {'container': [], 'network': [], 'volume': []}
    for attempt in (archive / 'attempts').iterdir():
        receipt = read(attempt / 'retirement.json')
        if (receipt['status'] != 'retired' or receipt['archive_verified'] is not True
                or receipt['remaining'] != empty or projects.get(receipt['project']) != empty):
            raise ValueError('T14 retirement is incomplete')
        for item in read(attempt / 'artifact-index.json')['artifacts']:
            path = PurePosixPath(item['name'].replace('\\', '/'))
            if path.is_absolute() or '..' in path.parts or ':' in str(path):
                raise ValueError('invalid T14 retirement artifact path')
            verify(attempt / path, item['sha256'].lower(), item['bytes'])
        reports = attempt / 'reports'
        for name, item in read(reports / 'inputs-start.json').items():
            path = PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name:
                raise ValueError('invalid T14 frozen input path')
            verify(reports / 'inputs' / path, item['sha256'], item['bytes'])

    reports = archive / 'attempts/final1/reports'
    inputs = read(reports / 'inputs-start.json')
    required_inputs = {'viewer/main.ts', 'viewer/selection.ts', 'viewer/field.ts',
                       'viewer/weather-layer.ts', 'viewer/native-layer.js', 'viewer/geometry.js',
                       'tools/check-weather-viewer.mjs', 'tools/viewer-navigation.mjs',
                       'tools/run-weather-viewer.ps1', 'tools/weather-viewer-inputs.mjs',
                       'docs/prototypes/forecast-interaction.prototype.html'}
    if not required_inputs.issubset(inputs) or inputs != read(reports / 'inputs-end.json'):
        raise ValueError('T14 final frozen inputs are incomplete or changed')
    processes = [json.loads(line) for line in (reports / 'process-results.jsonl').read_text().splitlines()]
    required_processes = {'browser', 'comparison', 'edge', 'edge-comparison', 'unavailable', 'full-suite', 'inputs-end'}
    if (not required_processes.issubset(item['check'] for item in processes)
            or any(item['native_exit_code'] != 0 for item in processes)):
        raise ValueError('T14 final processes did not pass')

    sizes = {(1440, 900), (390, 844), (360, 740), (640, 360)}
    expected_views = {(size, mode) for size in sizes for mode in ('mercator', 'hmc:orthographic', 'EPSG:3576')}
    source = read(archive / 'checks/preflight.json')['sample_sha256']
    for browser, executable, comparison in [('browser', 'chrome.exe', 'native-comparison.json'),
                                            ('browser-edge', 'msedge.exe', 'native-comparison-edge.json')]:
        report = read(reports / browser / 'browser.json')
        if (report['status'] != 'passed' or report['errors']
                or report['configuration'] != {'gpu_disabled': False, 'focused': False}
                or not report['executable'].lower().endswith(executable)
                or {tuple((v['width'], v['height'])) for v in report['viewports']} != sizes):
            raise ValueError('T14 browser full matrix is incomplete')
        cleanup = report['cleanup']
        if (cleanup.get('browser_processes_remaining') != 0
                or any(cleanup.get(key) is not True for key in ('page_released', 'browser_stopped', 'profile_removed'))):
            raise ValueError('T14 browser cleanup is incomplete')
        prototype = report.get('prototype_comparison', {})
        states = prototype.get('states', [])
        rules = {'first available time', 'run change resets time', 'time navigation pins reference and revision',
                 'gap clears overlay and point value'}
        if (prototype.get('source_sha256') != inputs['docs/prototypes/forecast-interaction.prototype.html']['sha256']
                or len(states) != 3 or set(prototype.get('matched_rules', [])) != rules
                or states[0].get('Forecast lead') != '+1 hours' or states[2].get('Forecast lead') != '+1 hours'
                or states[1].get('Current frame') != 'Unavailable'
                or not states[0].get('Run reference') or not states[0].get('Published snapshot')
                or states[0]['Run reference'] != states[1].get('Run reference')
                or states[0]['Published snapshot'] != states[1].get('Published snapshot')
                or states[2].get('Run reference') == states[0]['Run reference']):
            raise ValueError('T14 prototype comparison is incomplete')
        races = report['navigation']['races']
        for stage in ('fetch', 'decode', 'upload'):
            for destination in ('gap', 'run'):
                race: dict[str, Any] = next((r for r in races if r.get('stage') == stage and r.get('destination') == destination), {})
                events = {item['event'] for item in race.get('history', []) if item['stage'] == stage}
                held = 'real texture write before pause' if stage == 'upload' else 'held'
                if race.get('obsolete_completion_rejected') is not True or not {held, 'released'}.issubset(events):
                    raise ValueError('T14 controlled numeric race is incomplete')
        if not any(r.get('stage') == 'point' and r.get('different_run_after_release') is True
                   and {'held', 'released'}.issubset({e['event'] for e in r.get('history', [])}) for r in races):
            raise ValueError('T14 delayed point race is incomplete')
        numeric = read(reports / comparison)
        views = {(tuple(v['viewport']), v['mode']) for v in numeric['views'] if v.get('valid_samples', 0) > 0}
        if (numeric['status'] != 'passed' or numeric['source_sha256'] != source
                or not expected_views.issubset(views) or numeric['mask_differences'] != 0
                or not math.isfinite(numeric['max_abs_error_K']) or not 0 <= numeric['max_abs_error_K'] <= .01):
            raise ValueError('T14 independent numeric matrix is incomplete or failed')
        canonical = read(reports / (browser + '-canonical.json'))
        if (canonical['status'] != 'passed' or canonical['source_sha256'] != source
                or {(tuple(v['viewport']), v['mode']) for v in canonical['canonical_picks']}
                != {(size, mode) for size in sizes for mode in ('mercator', 'orthographic', 'laea')}):
            raise ValueError('T14 canonical point matrix is incomplete')
    unavailable = read(reports / 'browser-unavailable/browser.json')
    if (unavailable['status'] != 'passed' or unavailable['errors']
            or unavailable['configuration']['gpu_disabled'] is not True
            or unavailable['cleanup'].get('browser_processes_remaining') != 0
            or any(unavailable['cleanup'].get(key) is not True
                   for key in ('page_released', 'browser_stopped', 'profile_removed'))):
        raise ValueError('T14 unavailable GPU check failed')
    return len(names)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument('--native-display', action='store_true', help='Require the complete T23a numerical/service archive')
    selection.add_argument('--t23', action='store_true', help='Verify T23 continuation, diagnosis and implementation archive bytes')
    selection.add_argument('--t24', action='store_true', help='Verify T24 Chrome/Edge mockup and independent geometry archive')
    selection.add_argument('--t14', action='store_true', help='Verify T14 full viewer navigation, races and cleanup archive')
    selection.add_argument('--t15', action='store_true', help='Verify T15 desktop/physical Android updates and cleanup archive')
    args = parser.parse_args()
    checker = check_viewer_navigation if args.t14 else check_t23_archives if args.t23 else check_native_display if args.native_display else check
    if args.t15:
        from evidence_t15 import check_updates
        count = check_updates(args.root)
    else:
        count = check_browser_archive(args.root, 't24') if args.t24 else checker(args.root)
    print(f'Verified {count} archived evidence references')


if __name__ == '__main__':
    main()
