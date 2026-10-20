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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    print(f'Verified {check(args.root)} archived evidence references')


if __name__ == '__main__':
    main()
