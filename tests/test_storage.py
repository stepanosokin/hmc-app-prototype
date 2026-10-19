"""Storage CLI and manifest sampler contracts; real sample is mandatory."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SAMPLE = '/input/ICON_EU_T_G_2026101500.grib2'
CLOCK = '2026-10-19T00:00:00Z'


def storage(*args):
    result = subprocess.run([sys.executable, '-m', 'decoder.storage', *map(str, args)],
                            capture_output=True, text=True, check=False)
    return result, json.loads(result.stdout) if result.stdout else {}


class StorageContract(unittest.TestCase):
    def test_synthetic_nodata_is_explicit_and_never_becomes_a_temperature(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'fixture'
            result, report = storage('build', SAMPLE, target, '--clock', CLOCK, '--synthetic-nodata')
            self.assertEqual(result.returncode, 0, result.stderr + str(report))
            self.assertEqual(report['gate'], 'synthetic-mask-supplement')
            self.assertEqual(report['fields'][0]['missing_cells'], 2)
            from decoder.sampling import ManifestSampler
            sampler = ManifestSampler(target / 'manifest.json')
            selection = dict(run='ICON-EU/2026-10-15T00:00:00Z', revision=sampler.revision,
                             field='T_G:surface:0', valid_time='2026-10-15T01:00:00Z')
            point = sampler.sample(**selection, lon=-23.5, lat=29.5)
            self.assertIsNone(point['value'])
            self.assertEqual(point['reason'], 'native_nodata')
            self.assertEqual(sampler.sample(**selection, lon=62.5, lat=29.5)['value'], 289.7391357421875)

    def test_actual_sample_round_trip_and_exact_manifest_selection(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'batch'
            result, report = storage('build', SAMPLE, target, '--clock', CLOCK)
            self.assertEqual(result.returncode, 0, result.stderr + str(report))
            self.assertEqual(report['status'], 'passed')
            self.assertEqual(len(report['fields']), 24)
            self.assertEqual(report['zarr_max_abs_error'], 0)
            self.assertLessEqual(report['cog_max_abs_error'], 0.0001)
            from decoder.sampling import ManifestSampler
            sampler = ManifestSampler(target / 'manifest.json')
            point = sampler.sample(run='ICON-EU/2026-10-15T00:00:00Z',
                                   revision=sampler.revision, field='T_G:surface:0',
                                   valid_time='2026-10-15T01:00:00Z', lon=336.5, lat=29.5)
            self.assertEqual(point['value'], 298.2274169921875)
            self.assertEqual(point['cell'], {'row': 0, 'column': 0, 'lon': -23.5, 'lat': 29.5})
            self.assertEqual(point['units'], 'K')
            self.assertEqual(point['method'], 'native_cell')
            selection = dict(run=point['run'], revision=sampler.revision, field='T_G:surface:0',
                             valid_time='2026-10-15T01:00:00Z')
            for lon, lat in [(-23.53125, 29.46875), (-23.5001, 29.5001)]:
                self.assertEqual(sampler.sample(**selection, lon=lon, lat=lat)['value'], 298.2274169921875)
            # Half-cell tie belongs to the next northern row, not the nearest edge.
            self.assertEqual(sampler.sample(**selection, lon=-23.5, lat=29.53125)['value'], 298.2479248046875)
            for lon, lat in [(-23.531251, 29.5), (62.53125, 29.5), (0, 70.53125), (0, 29.468749)]:
                outside = sampler.sample(**selection, lon=lon, lat=lat)
                self.assertIsNone(outside['value'])
                self.assertEqual(outside['reason'], 'outside_coverage')
            for key, value in [('run', 'another-run'), ('revision', 'another-revision'),
                               ('field', '2t'), ('valid_time', '2026-10-15T00:00:00Z')]:
                with self.subTest(key=key), self.assertRaises(KeyError):
                    sampler.sample(**{**selection, key: value}, lon=0, lat=50)
            from decoder.inspect_forecast import ValidationError
            for lon, lat in [(float('nan'), 50), (0, float('inf')), (0, 91)]:
                with self.assertRaises(ValidationError):
                    sampler.sample(**selection, lon=lon, lat=lat)
            before = (target / 'manifest.json').read_bytes()
            result, failed = storage('build', SAMPLE, target, '--clock', CLOCK)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(failed['status'], 'failed')
            self.assertEqual((target / 'manifest.json').read_bytes(), before)
            # Damage an actual stored asset; CLI must replace an earlier success report.
            asset = target / 'hour-01.zarr' / 'temperature' / '0.0'
            asset.chmod(0o644)
            asset.write_bytes(b'corrupted chunk')
            report_path = Path(directory) / 'report.json'
            report_path.write_text('{"status":"passed"}')
            result, _ = storage('verify', SAMPLE, target / 'manifest.json', '--clock', CLOCK,
                                '--report', report_path)
            self.assertEqual(result.returncode, 1, result.stderr)
            failed = json.loads(report_path.read_text())
            self.assertEqual(failed['status'], 'failed')
            self.assertNotIn('fields', failed)
            self.assertIn('integrity', failed['error']['message'])
            with self.assertRaises(ValidationError):
                ManifestSampler(target / 'manifest.json')

    def test_invalid_source_and_clock_never_create_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'truncated.grib2'
            source.write_bytes(Path(SAMPLE).read_bytes()[:-32])
            for source_path, clock in [(source, CLOCK), (Path(SAMPLE), 'not-utc')]:
                target = Path(directory) / 'rejected'
                result, report = storage('build', source_path, target, '--clock', clock)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertEqual(report['status'], 'failed')
                self.assertFalse((target / 'manifest.json').exists())


if __name__ == '__main__':
    unittest.main()
