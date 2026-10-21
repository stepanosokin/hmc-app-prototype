"""Historical T15 acceptance: archive bytes, desktop/device coverage and transitions."""

import hashlib
import json
import math
from pathlib import Path, PurePosixPath
from typing import Any


def read(path: Path) -> Any:
    return json.loads(path.read_bytes())


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError('T15 ' + message)


def relative(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    require(bool(name) and not path.is_absolute() and '..' not in path.parts
            and ':' not in name and '\\' not in name and path.as_posix() == name,
            'invalid artifact path')
    return path


def verify(path: Path, item: dict[str, Any]) -> None:
    payload = path.read_bytes()
    require(len(payload) == item['bytes'] and hashlib.sha256(payload).hexdigest() == item['sha256'].lower(),
            'checksum mismatch: ' + str(path))


def budget(value: Any, limit: float) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= limit


def browser_report(report: dict[str, Any], sizes: set[tuple[int, int]], phone: bool,
                   inputs: dict[str, Any]) -> None:
    require(report['status'] == 'passed' and not report['errors']
            and report['configuration'] == {'gpu_disabled': False, 'focused': False}
            and {(v['width'], v['height']) for v in report['viewports']} == sizes, 'full browser matrix incomplete')
    cleanup = report['cleanup']
    keys = ('page_released', 'test_tab_closed', 'adb_forward_removed', 'adb_reverse_removed',
            'ui_dump_removed', 'user_chrome_retained') if phone else ('page_released', 'browser_stopped', 'profile_removed')
    require(all(cleanup.get(k) is True for k in keys)
            and (phone or cleanup.get('browser_processes_remaining') == 0), 'browser cleanup incomplete')
    if phone:
        require(bool(report.get('android', {}).get('model')) and bool(report.get('gpu', {}).get('renderer'))
                and bool(report.get('native_selections'))
                and all(v.get('committed') is True for v in report['native_selections']), 'physical input evidence incomplete')
    updates = report['updates']
    expected = {'catalogue': 'newer response', 'fetch': 'projection', 'decode': 'projection',
                'upload': 'decline', 'point': 'projection'}
    for stage, cancel in expected.items():
        race: dict[str, Any] = next((r for r in updates['races'] if r.get('stage') == stage), {})
        require(race.get('pinned') is True and race.get('cancel') == cancel, 'update race incomplete: ' + stage)
        if stage in ('fetch', 'decode', 'upload'):
            events = {e['event'] for e in race.get('history', []) if e.get('stage') == stage}
            held = 'real texture write before pause' if stage == 'upload' else 'held'
            require({held, 'released'}.issubset(events), 'held/released update race incomplete')
        if stage == 'upload':
            require(race.get('retired_texture') is True, 'cancelled texture not retired')
    required_failures = {'real API outage during revision load preserves field and point',
                         'real catalogue failure clears obsolete acceptance action',
                         'labelled injected GPU upload failure preserves pinned field',
                         'real GPU context loss during staged update retains publication after recovery'}
    require(required_failures.issubset(updates['failures']), 'failure coverage incomplete')
    before, after = updates['before'], updates['after']
    require(updates['declined'] is True and before['run'] == after['run']
            and before['valid_time'] == after['valid_time'] and before['revision'] != after['revision']
            and before['selection'] != after['selection'], 'explicit revision transition incomplete')
    atomic = updates['atomic']
    identity, point = atomic['cache_identity'], atomic['point']
    require(atomic['geometry_preserved'] is True and budget(atomic['managed_bytes'], 128*1024**2)
            and identity['selection'] == point['selection'] == after['selection']
            and all(point[k] == after[k] == identity['identity'][k] for k in ('run', 'revision', 'valid_time')),
            'atomic field/point identity mismatch')
    require(updates['gap_refresh']['run'] == after['run']
            and updates['gap_refresh']['revision'] == after['revision']
            and updates['gap_refresh']['valid_time'] != after['valid_time']
            and updates['new_run']['run'] != after['run']
            and updates['new_run']['valid_time'] == updates['new_run']['valid_times'][0], 'explicit availability/run transition incomplete')
    resources = updates['resources']
    require(0 < resources['max_arrays'] <= 2 and budget(resources['max_array_bytes'], 128*1024**2), 'GPU resource bound exceeded')
    require({r['mode'] for r in updates['replacements']} == {'mercator', 'orthographic', 'laea'}
            and all(budget(r['managed_bytes'], 128*1024**2) for r in updates['replacements']), 'replacement matrix incomplete')
    expected_layouts = sizes if phone else {(390, 844), (360, 740), (640, 360), (700, 740), (701, 740)}
    require({(v['width'], v['height']) for v in updates['layouts']} == expected_layouts, 'responsive matrix incomplete')
    for layout in updates['layouts']:
        if layout['width'] <= 700:
            require(0 <= layout['sheet']['top'] < layout['sheet']['bottom'] <= layout['time']['top']
                    < layout['time']['bottom'] <= layout['height'], 'sheet/time overlap')
    require(updates['mockup']['sha256'] == inputs['docs/prototypes/weather-map.prototype.html']['sha256'], 'mockup identity mismatch')


def check_updates(root: Path) -> int:
    archive = root / 'docs/evidence/t15'
    verified: dict[Path, tuple[int, str]] = {}

    def checked(path: Path, item: dict[str, Any]) -> None:
        identity = (item['bytes'], item['sha256'].lower())
        if path in verified:
            require(verified[path] == identity, 'conflicting recorded identity')
        else:
            verify(path, item)
            verified[path] = identity

    index = read(archive / 'artifact-index.json')
    names: set[str] = set()
    for item in index['artifacts']:
        path = relative(item['name'])
        require(str(path) not in names, 'duplicate artifact path')
        names.add(str(path))
        checked(archive / path, item)
    actual = {p.relative_to(archive).as_posix() for p in archive.rglob('*')
              if p.is_file() and p != archive / 'artifact-index.json'}
    require(names == actual, 'artifact coverage incomplete')
    empty: dict[str, list[str]] = {'container': [], 'network': [], 'volume': []}
    for attempt in (archive / 'attempts').iterdir():
        receipt = read(attempt / 'retirement.json')
        require(receipt['status'] == 'retired' and receipt['archive_verified'] is True
                and receipt['remaining'] == empty, 'retirement incomplete')
        for item in read(attempt / 'artifact-index.json')['artifacts']:
            checked(attempt / relative(item['name'].replace('\\', '/')), item)
        for input_name, item in read(attempt / 'reports/inputs-start.json').items():
            checked(attempt / 'reports/inputs' / relative(input_name), item)
    frozen = read(archive / 'attempts/final2/reports/inputs-start.json')
    required = {'viewer/main.ts', 'viewer/selection.ts', 'viewer/weather-layer.ts', 'tools/viewer-updates.mjs',
                'tools/viewer-navigation.mjs', 'tools/check-weather-viewer.mjs', 'tools/run-weather-viewer.ps1',
                'tools/viewer-update-reference.py', 'tools/publish-viewer-update.ps1',
                'docs/prototypes/weather-map.prototype.html'}
    require(required.issubset(frozen), 'frozen inputs incomplete')
    source = read(archive / 'attempts/final2/reports/browser-updates-comparison.json')['source_sha256']
    for attempt_name, phone in [('final2', False), ('android-final2', True)]:
        reports = archive / 'attempts' / attempt_name / 'reports'
        require(frozen == read(reports / 'inputs-start.json') == read(reports / 'inputs-end.json'), 'frozen inputs differ')
        processes = [json.loads(line) for line in (reports / 'process-results.jsonl').read_text().splitlines()]
        required_processes = {'browser', 'comparison', 'update-comparison', 'inputs-end'}
        if not phone:
            required_processes.update({'edge', 'edge-comparison', 'edge-update-comparison', 'unavailable', 'full-suite'})
        require(required_processes.issubset(p['check'] for p in processes)
                and all(p['native_exit_code'] == 0 for p in processes), 'process matrix failed')
        sizes = {(384, 694)} if phone else {(1440, 900), (390, 844), (360, 740), (640, 360)}
        for browser in (['browser'] if phone else ['browser', 'browser-edge']):
            report = read(reports / browser / 'browser.json')
            browser_report(report, sizes, phone, frozen)
            expected_executable = 'msedge.exe' if browser == 'browser-edge' else 'chrome.exe'
            require(phone or report['executable'].lower().endswith(expected_executable), 'desktop browser identity mismatch')
            numeric = read(reports / f'{browser}-updates-comparison.json')
            require(numeric['status'] == 'passed' and numeric['source_sha256'] == source
                    and numeric['valid_gpu_samples'] > 0 and numeric['mask_differences'] == 0
                    and budget(numeric['max_abs_error_K'], .01) and numeric['edr_equal'] is True
                    and numeric['point']['selection'] == report['updates']['after']['selection']
                    and numeric['wms_value_K'] == numeric['point']['value'], 'update numeric comparison failed')
            comparison = 'native-comparison.json' if browser == 'browser' else 'native-comparison-edge.json'
            native = read(reports / comparison)
            expected_views = {(size, mode) for size in sizes for mode in ('mercator', 'hmc:orthographic', 'EPSG:3576')}
            require(native['status'] == 'passed' and native['source_sha256'] == source
                    and native['mask_differences'] == 0 and budget(native['max_abs_error_K'], .01)
                    and expected_views.issubset({(tuple(v['viewport']), v['mode']) for v in native['views']
                                                if v.get('valid_samples', 0) > 0}), 'baseline numeric matrix incomplete')
            canonical = read(reports / f'{browser}-canonical.json')
            require(canonical['status'] == 'passed' and canonical['source_sha256'] == source
                    and {(tuple(v['viewport']), v['mode']) for v in canonical['canonical_picks']}
                    == {(size, mode) for size in sizes for mode in ('mercator', 'orthographic', 'laea')},
                    'canonical point matrix incomplete')
        if not phone:
            unavailable = read(reports / 'browser-unavailable/browser.json')
            require(unavailable['status'] == 'passed' and not unavailable['errors']
                    and unavailable['configuration']['gpu_disabled'] is True
                    and unavailable['cleanup']['browser_processes_remaining'] == 0
                    and all(unavailable['cleanup'][k] is True for k in ('page_released', 'browser_stopped', 'profile_removed')),
                    'unavailable GPU evidence incomplete')
    cleanup = read(archive / 'checks/final-cleanup.json')
    require(cleanup['t15_resources_remaining'] == 0 and cleanup['no_live_stack_retained'] is True, 'final resource cleanup incomplete')
    host = read(archive / 'android-tools/cleanup.json')
    require(all(host.get(k) is True for k in ('owned_server_stopped', 'owned_keys_verified_before_removal', 'profile_removed', 'sdk_removed'))
            and host['owned_processes_remaining'] == host['owned_listeners_remaining'] == 0, 'ADB host cleanup incomplete')
    device = read(archive / 'android-tools/device-cleanup.json')
    require(device['owner_confirmed_usb_debugging_disabled'] is True
            and device['owner_confirmed_cable_disconnected'] is True, 'device cleanup incomplete')
    return len(names)
