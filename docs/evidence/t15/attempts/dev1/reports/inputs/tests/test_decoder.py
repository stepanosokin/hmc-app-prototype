"""CLI contract tests. Actual sample is required, never replaced by fixtures."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SAMPLE = Path('/input/ICON_EU_T_G_2026101500.grib2')
CLI = '/app/decoder/inspect_forecast.py'


def inspect(path: Path) -> tuple[subprocess.CompletedProcess[str], dict]:
    result = subprocess.run(
        [sys.executable, CLI, str(path), '--clock', '2026-10-19T00:00:00Z'],
        capture_output=True, text=True, check=False,
    )
    return result, json.loads(result.stdout)


class DecoderContract(unittest.TestCase):
    def test_actual_sample_decodes_all_hours_and_native_cell_positions(self):
        result, report = inspect(SAMPLE)
        self.assertEqual(result.returncode, 0, result.stderr + str(report.get('error', '')))
        self.assertEqual(report['status'], 'passed')
        self.assertEqual(report['input']['sha256'], 'dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a')
        self.assertEqual(len(report['messages']), 24)
        self.assertIn('AEC', report['tools']['features'])
        for hour, message in enumerate(report['messages'], 1):
            self.assertEqual(message['lead_hours'], hour)
            self.assertEqual(message['identity']['shortName'], 'T_G')
            self.assertEqual(message['identity']['typeOfLevel'], 'surface')
            self.assertEqual(message['identity']['units'], 'K')
            self.assertEqual(message['values']['finite_count'], 904689)
            self.assertEqual(message['values']['missing_count'], 0)
            self.assertEqual(message['grid']['shape_yx'], [657, 1377])
            self.assertEqual(message['grid']['cell_centres'][0]['lon'], -23.5)
            self.assertEqual(message['grid']['cell_centres'][0]['lat'], 29.5)
            self.assertEqual(message['grid']['cell_centres'][-1]['lon'], 62.5)
            self.assertEqual(message['grid']['cell_centres'][-1]['lat'], 70.5)
        self.assertEqual(report['messages'][-1]['valid_time'], '2026-10-16T00:00:00Z')

    def test_truncated_input_fails_without_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'truncated.grib2'
            path.write_bytes(SAMPLE.read_bytes()[:-32])
            result, report = inspect(path)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report['status'], 'failed')
        self.assertEqual(report['messages'], [])
        self.assertIn('truncated', report['error']['message'].lower())

    def test_unsupported_packing_has_diagnostic_without_values(self):
        # Explicit corrupted-input supplement: change first template 5.42 to 5.99.
        data = bytearray(SAMPLE.read_bytes())
        data[180] = 99
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'unsupported.grib2'
            path.write_bytes(data)
            result, report = inspect(path)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report['messages'], [])
        self.assertIn('unsupported packing', report['error']['message'])

    def test_header_mutations_never_pass_as_sample(self):
        # Known binary offsets from independent preliminary header inspection.
        cases = [
            ('table', 25, 20, 'identity'),
            ('surface', 158, 103, 'identity'),
            ('time', 157, 61, 'hourly lead'),
            ('scanning', 135, 0, 'scanning'),
            ('cell shift', 117, 33, 'extent'),
        ]
        for label, offset, replacement, diagnostic in cases:
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                data = bytearray(SAMPLE.read_bytes())
                data[offset] = replacement
                path = Path(directory) / 'mutated.grib2'
                path.write_bytes(data)
                result, report = inspect(path)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(report['messages'], [])
                self.assertIn(diagnostic, report['error']['message'])

    def test_empty_non_grib_and_missing_hours_fail(self):
        sample = SAMPLE.read_bytes()
        first_length = int.from_bytes(sample[8:16], 'big')
        cases = [(b'', 'empty'), (b'not a GRIB input!' * 2, 'not GRIB'),
                 (sample[:first_length], 'expected 24')]
        for data, diagnostic in cases:
            with self.subTest(diagnostic=diagnostic), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'invalid.grib2'
                path.write_bytes(data)
                result, report = inspect(path)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(report['messages'], [])
                self.assertIn(diagnostic, report['error']['message'])

    def test_failure_atomically_replaces_previous_success_report(self):
        with tempfile.TemporaryDirectory() as directory:
            report_path = Path(directory) / 'report.json'
            report_path.write_text('{"status":"passed","messages":[{"value":273.15}]}')
            path = Path(directory) / 'incomplete.grib2'
            path.write_bytes(SAMPLE.read_bytes()[:-32])
            result = subprocess.run(
                [sys.executable, CLI, str(path), '--clock', '2026-10-19T00:00:00Z',
                 '--report', str(report_path)], capture_output=True, text=True, check=False,
            )
            report = json.loads(report_path.read_text())
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, '')
            self.assertEqual(report['status'], 'failed')
            self.assertEqual(report['messages'], [])
            self.assertFalse(report_path.with_suffix('.json.tmp').exists())


if __name__ == '__main__':
    unittest.main()
