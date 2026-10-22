"""Run agreed HTTP contracts and bind their result to this toolchain/data."""

import argparse
import hashlib
import json
import unittest
from pathlib import Path

from decoder.sampling import file_hash
from trials import ROOT
from trials.fixture import atomic_json


def fingerprint() -> str:
    paths = sorted([*Path('/app/trials').glob('*.py'), *Path('/app/decoder').glob('*.py'),
                    *Path('/app').glob('requirements*.lock'), Path('/app/baseline-a1.json'),
                    Path('/app/trials/agreement.json'), ROOT / 'index.json', ROOT / 'catalog.json'])
    return hashlib.sha256(json.dumps([(str(path), file_hash(path)) for path in paths]).encode()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--include-storage', action='store_true')
    parser.add_argument('--unavailable-candidate', choices=['narrow', 'pygeoapi'])
    args = parser.parse_args()
    if args.unavailable_candidate:
        from trials.test_http import request
        identity = json.loads((ROOT / 'index.json').read_text())['actual']
        status, body, _ = request(f'/{args.unavailable_candidate}/ogc/collections', identity)
        passed = status == 503 and 'value' not in body and 'collections' not in body
        report = {'status': 'passed' if passed else 'failed', 'http_status': status,
                  'candidate': args.unavailable_candidate, 'body': body,
                  'scope': 'real stopped backend; gateway transient-failure behavior'}
        atomic_json(Path('/reports') / f'unavailable-{args.unavailable_candidate}.json', report)
        print(json.dumps(report))
        return 0 if passed else 1
    suite = unittest.defaultTestLoader.loadTestsFromName('trials.test_http')
    if args.include_storage:
        suite.addTests(unittest.defaultTestLoader.discover('/app/tests'))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    report = {'status': 'passed' if result.wasSuccessful() else 'failed', 'tests': result.testsRun,
              'failures': len(result.failures), 'errors': len(result.errors), 'fingerprint': fingerprint(),
              'scope': 'HTTP + actual decoder/storage' if args.include_storage else 'agreed HTTP seam'}
    atomic_json(Path('/reports') / ('full-validation.json' if args.include_storage else 'correctness.json'), report)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
