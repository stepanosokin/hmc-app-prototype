"""Archive integrity through the same entry point used by CI; synthetic bytes."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

from check_evidence import check


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
