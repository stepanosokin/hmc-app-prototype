"""Verify archived evidence against its recorded byte hashes; no sample required."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
from typing import Any


def verify(path: Path, expected: str, size: int | None = None) -> None:
    payload = path.read_bytes()
    if hashlib.sha256(payload).hexdigest() != expected:
        raise ValueError(f'evidence checksum mismatch: {path}')
    if size is not None and len(payload) != size:
        raise ValueError(f'evidence length mismatch: {path}')


def check_browser_archive(root: Path) -> int:
    """Check T22's archived bytes and recorded identities, not future live inputs."""
    prefix = 'docs/evidence/t22/'
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
    selected = index['selected_report']
    if selected not in artifacts or not selected.startswith(prefix):
        raise ValueError('browser selected report is not archived')
    report = json.loads((root / selected).read_bytes())
    if (report['status'] != 'passed' or len(report['checks']) != index['selected_checks']
            or report['errors'] or report['external_requests']):
        raise ValueError('browser selected report is not passing')
    cleanup = report['cleanup']
    if (cleanup['browser_processes_remaining'] != 0 or cleanup['profile_removed'] is not True
            or cleanup['compose_projects_created'] != 0 or cleanup['servers_created'] != 0):
        raise ValueError('browser evidence cleanup is incomplete')
    for name, checksum in report['inputs'].items():
        if name not in artifacts or artifacts[name]['sha256'] != checksum:
            raise ValueError(f'browser input identity mismatch: {name}')
    return count


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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument('--native-display', action='store_true', help='Require the complete T23a numerical/service archive')
    selection.add_argument('--t23', action='store_true', help='Verify T23 continuation, diagnosis and implementation archive bytes')
    args = parser.parse_args()
    checker = check_t23_archives if args.t23 else check_native_display if args.native_display else check
    print(f'Verified {checker(args.root)} archived evidence references')


if __name__ == '__main__':
    main()
