"""Verify archived evidence against its recorded byte hashes; no sample required."""

import argparse
import hashlib
import json
from pathlib import Path


def verify(path: Path, expected: str, size: int | None = None) -> None:
    payload = path.read_bytes()
    if hashlib.sha256(payload).hexdigest() != expected:
        raise ValueError(f'evidence checksum mismatch: {path}')
    if size is not None and len(payload) != size:
        raise ValueError(f'evidence length mismatch: {path}')


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
    for name in ('t5', 't6', 't7', 't8', 't9', 't10'):
        archive = evidence / name
        index = json.loads((archive / 'artifact-index.json').read_bytes())
        for artifact in index['artifacts']:
            verify(archive / artifact['name'], artifact['sha256'], artifact['bytes'])
            count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    print(f'Verified {check(args.root)} archived evidence references')


if __name__ == '__main__':
    main()
