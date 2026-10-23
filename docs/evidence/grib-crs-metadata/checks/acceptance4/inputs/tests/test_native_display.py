"""Native display contract observed through the approved real gateway seam."""

import os
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest

import numpy as np
import requests


@unittest.skipUnless(os.environ.get('T23A_HTTP') == '1', 'requires isolated native display gateway')
class NativeDisplay(unittest.TestCase):
    base = 'http://gateway:8000'

    def get(self, path, expected=200, **kwargs):
        response = requests.get(self.base + path, timeout=60, **kwargs)
        self.assertEqual(response.status_code, expected, response.text[:200] if expected != 200 else path)
        return response

    def test_native_metadata_and_first_cell_preserve_selection(self):
        selected = next(item for item in self.get('/api/v1/catalogue').json()['selections']
                        if item['fixture'] == 'actual')
        path = f"/api/v1/selections/{selected['selection']}/display/1/native.json"
        metadata = self.get(path).json()
        self.assertEqual(metadata['contract'], 'hmc-native-display/1')
        self.assertEqual(metadata['selection'], selected['selection'])
        self.assertEqual(metadata['grid']['shape_yx'], [657, 1377])
        payload = self.get(metadata['url'].replace('{column}', '0').replace('{row}', '0')).content
        self.assertEqual(len(payload), 332820)
        values = np.frombuffer(payload[:258*258*4], dtype='<f4').reshape(258, 258)
        valid = np.frombuffer(payload[258*258*4:], dtype='uint8').reshape(258, 258)
        # Literal established independently from the source GRIB first cell.
        self.assertEqual(float(values[1, 1]), 298.2274169921875)
        self.assertEqual(int(valid[1, 1]), 1)
        self.assertFalse(np.any(valid[0]))
        self.assertFalse(np.any(valid[:, 0]))
        self.assertEqual(self.get(selected['tiles']).json()['contract'], 'hmc-temperature-tile/2')

    def test_all_blocks_equal_independent_grib_and_share_halos(self):
        from decoder.inspect_forecast import SAMPLE_SHA256
        from decoder.storage import bounded_frames, decoded_arrays
        source = Path('/input/ICON_EU_T_G_2026101500.grib2')
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), SAMPLE_SHA256)
        raw, missing = decoded_arrays(next(bounded_frames(source)), [657, 1377])
        selected = next(item for item in self.get('/api/v1/catalogue').json()['selections'] if item['fixture'] == 'actual')
        metadata = self.get(f"/api/v1/selections/{selected['selection']}/display/1/native.json").json()
        maximum, byte_count, blocks = 0., 0, {}
        for row in range(3):
            for column in range(6):
                url = metadata['url'].replace('{column}', str(column)).replace('{row}', str(row))
                payload = self.get(url).content
                byte_count += len(payload)
                values = np.frombuffer(payload[:258*258*4], dtype='<f4').reshape(258, 258)
                valid = np.frombuffer(payload[258*258*4:], dtype='uint8').reshape(258, 258)
                blocks[column, row] = (values, valid)
                for r in range(258):
                    j = row*256+r-1
                    for c in range(258):
                        i = column*256+c-1
                        expected_valid = 0 <= j < 657 and 0 <= i < 1377 and not missing[j, i]
                        self.assertEqual(bool(valid[r, c]), expected_valid)
                        if expected_valid:
                            maximum = max(maximum, abs(float(values[r, c])-float(raw[j, i])))
                        else:
                            self.assertEqual(float(values[r, c]), 0.)
                if column:
                    for left, right in zip(blocks[column-1, row], blocks[column, row]):
                        np.testing.assert_array_equal(left[:, -2:], right[:, :2])
                if row:
                    for lower, upper in zip(blocks[column, row-1], blocks[column, row]):
                        np.testing.assert_array_equal(lower[-2:, :], upper[:2, :])
        self.assertLessEqual(maximum, .001)
        self.assertLess(byte_count + len(json.dumps(metadata).encode()), 8*1024**2)
        Path('/evidence/native-blocks.json').write_text(json.dumps({'status': 'passed',
            'selection': selected, 'source_sha256': SAMPLE_SHA256, 'blocks': 18, 'bytes': byte_count,
            'encoding_max_abs_error_K': maximum, 'all_padding_and_halos': 'passed'}))

    def test_gateway_native_access_and_validation(self):
        selected = next(item for item in self.get('/api/v1/catalogue').json()['selections'] if item['fixture'] == 'actual')
        path = f"/api/v1/selections/{selected['selection']}/display/1/native.json"
        block = path.replace('native.json', 'native/0/0.f32')
        self.get(block)
        for suffix in ('native/6/0.f32', 'native/0/3.f32'):
            self.get(path.replace('native.json', suffix), 400)
        self.get(path, 400, params={'unknown': '1'})
        self.get('/api/v1/selections/' + '0'*64 + '/display/1/native.json', 404)
        with tempfile.TemporaryDirectory() as directory:
            def command(*args):
                result = subprocess.run([sys.executable, '-m', 'publication.access', *map(str, args)],
                                        capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stderr)
                return json.loads(result.stdout)
            key = Path(directory) / 'native.key'
            created = command('create', '--organization', 'native-display', '--profile', 'numeric', '--out', key)
            headers = {'Authorization': 'Bearer ' + key.read_text().strip()}
            protected = self.get('/org'+path, headers=headers).json()
            self.assertTrue(protected['url'].startswith('/org/'))
            self.assertEqual(protected['url'], protected['url_template'])
            self.assertEqual(protected['metadata_url'], '/org'+path)
            warm = self.get('/org'+block, headers=headers)
            command('revoke', '--id', created['id'])
            self.get('/org'+block, 401, headers={**headers, 'If-None-Match': warm.headers['ETag']})
            self.get('/org'+path, 401, headers=headers)

    def test_warm_storage_loss_expiry_and_deadline(self):
        from publication.domain import ROOT, resolve, sampler
        from publication import retention
        selected = next(item for item in self.get('/api/v1/catalogue').json()['selections'] if item['fixture'] == 'actual')
        path = f"/api/v1/selections/{selected['selection']}/display/1/native.json"
        block = path.replace('native.json', 'native/0/0.f32')
        self.get(path)
        self.get(block)
        numerical = sampler(resolve(selected['selection']))
        item = numerical.manifest['fields'][0]
        chunk = next(p for p in (numerical.root/item['zarr']/'temperature').iterdir() if p.name[0].isdigit())
        hidden = chunk.with_name(chunk.name+'.hidden')
        chunk.rename(hidden)
        try:
            self.get(block, 503)
            self.get(path, 503)
        finally:
            hidden.rename(chunk)
        self.get(block)
        configuration, _, _ = retention.snapshot()
        marker = ROOT/'.t6-generation'
        marker.touch()
        try:
            # Warm cache continues working with generation deliberately unavailable.
            self.get(block)
            retention.configure({**configuration, 'clock': '2026-10-22T00:00:00Z'})
            self.get(block, 410)
            self.get(path, 410)
        finally:
            marker.unlink(missing_ok=True)
            retention.configure(configuration)
        self.get(block)
        delay = ROOT/'.t23a-source-delay'
        # Timeout reservation must not consume the public browser's two slots.
        # Reproduce its conservative accounting in a separate organization.
        from publication.access import issue
        with tempfile.TemporaryDirectory() as directory:
            key_path = Path(directory)/'timeout.key'
            issue('native-timeout', 'numeric', key_path)
            headers = {'X-API-Key': key_path.read_text().strip()}
            limits = Path(directory)/'limits.json'
            limits.write_text('{"concurrency":1}')
            configured = subprocess.run([sys.executable, '-m', 'publication.budgets', 'configure',
                '--organization', 'native-timeout', '--file', str(limits)], capture_output=True, text=True, timeout=30)
            self.assertEqual(configured.returncode, 0, configured.stderr)
            delay.touch()
            try:
                timed_out = self.get('/org'+block, 504, headers=headers)
            finally:
                delay.unlink(missing_ok=True)
            reserved = self.get('/org'+block, 429, headers=headers)
            self.assertEqual(reserved.json()['code'], 'TooManyRequests')
            public = self.get(block)
            Path('/evidence/native-timeout-budget.json').write_text(json.dumps({
                'status': 'passed', 'organization_timeout': timed_out.status_code,
                'organization_reservation': reserved.status_code, 'reservation_code': reserved.json()['code'],
                'public_unaffected': public.status_code, 'request_ids': [response.headers['X-Request-ID']
                    for response in (timed_out, reserved, public)],
                'cause': 'existing conservative timeout reservation belongs to its admission bucket'}))
        self.get(block)


if __name__ == '__main__':
    unittest.main()
