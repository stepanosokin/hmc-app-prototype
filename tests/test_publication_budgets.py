"""T9 actual gateway/cache acceptance, using the operator policy/usage interface."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import time
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED

import requests


@unittest.skipUnless(os.environ.get('T9_HTTP') == '1', 'requires isolated T9 actual-sample services')
class UsageBudgets(unittest.TestCase):
    def command(self, *args):
        result = subprocess.run([sys.executable, '-m', 'publication.budgets', *map(str, args)],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_rate_before_warm_cache_and_organization_identity(self):
        from publication.access import issue
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'key'
            identity = issue('t9-alpha', 'all', path)
            token = path.read_text().strip()
            selected = next(item for item in requests.get('http://gateway:8000/api/v1/catalogue', timeout=30)
                            .json()['selections'] if item['fixture'] == 'actual')
            tile = '/org' + selected['tiles'].replace('tiles.json', 'tiles/2/3/4/2.f32')
            policy = Path(directory) / 'policy.json'
            policy.write_text(json.dumps({'requests': 1}))
            self.command('configure', '--organization', 't9-alpha', '--file', policy)
            headers = {'Authorization': 'Bearer ' + token}
            first = requests.get('http://gateway:8000' + tile, headers=headers, timeout=40)
            self.assertEqual(first.status_code, 200)
            denied = requests.get('http://gateway:8000' + tile, headers=headers, timeout=40)
            self.assertEqual(denied.status_code, 429)
            self.assertTrue(int(denied.headers['Retry-After']) > 0)
            self.assertEqual(denied.headers['Cache-Control'], 'no-store')
            rows = self.command('usage', '--organization', 't9-alpha')['requests']
            self.assertEqual([row['status'] for row in rows], [200, 429])
            self.assertTrue(all(row['key_id'] == identity['id'] for row in rows))
            self.assertEqual(rows[0]['bytes'], 332820)
            (Path('/evidence') / 't9-rate.json').write_text(json.dumps({'status': 'passed', 'requests': rows}, indent=2) + '\n')

    def test_resources_demo_cache_rejections_and_retention(self):
        from publication.access import issue
        base = 'http://gateway:8000'
        observations = []
        gis_limits = self.command('gis-limits')
        self.assertEqual(gis_limits, {'maxRenderingTime': 20, 'maxRequestMemory': 16384})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            policy = root / 'policy.json'

            def configure(organization=None, **limits):
                policy.write_text(json.dumps(limits))
                return self.command('configure', *(('--organization', organization) if organization else ('--public',)), '--file', policy)

            def key(organization):
                path = root / str(len(list(root.iterdir())))
                identity = issue(organization, 'all', path)
                return identity, path.read_text().strip()

            identity, token = key('t9-resources')
            other, other_token = key('t9-independent')
            selected = next(item for item in requests.get(base + '/api/v1/catalogue', timeout=30)
                            .json()['selections'] if item['fixture'] == 'actual')
            metadata = '/org' + selected['tiles']
            tile = metadata.replace('tiles.json', 'tiles/2/3/4/2.f32')

            def get(path, expected=200, credential=token, **kwargs):
                headers = {'Authorization': 'Bearer ' + credential} if credential else {}
                headers.update(kwargs.pop('headers', {}))
                result = requests.get(base + path, headers=headers, timeout=40, **kwargs)
                self.assertIn(result.status_code, expected if isinstance(expected, tuple) else (expected,), path)
                self.assertEqual(result.headers['Cache-Control'], 'no-store' if result.status_code >= 400 else result.headers['Cache-Control'])
                observations.append({'request_id': result.headers['X-Request-ID'], 'status': result.status_code,
                                     'bytes': len(result.content)})
                return result

            get(metadata)
            get(metadata)
            get(tile)
            marker = Path('/assets/.t6-generation')
            marker.touch()
            try:
                get(tile)  # Proven cache hit while actual generation is disabled.
                get(metadata)
                configure('t9-resources', output=1024)
                get(tile, 413)
            finally:
                marker.unlink(missing_ok=True)
            rows = self.command('usage', '--organization', 't9-resources')['requests']
            rejected = rows[-1]
            self.assertEqual(rejected['cache'], 'hit')
            self.assertEqual(rejected['run'], selected['run'])
            self.assertEqual(rejected['revision'], selected['revision'])
            self.assertEqual(rejected['product'], selected['model'])
            self.assertTrue(any(row['operation'] == 'tile-metadata' and row['cache'] == 'hit' for row in rows))
            self.assertEqual(rows[0]['key_id'], identity['id'])

            # Aggregate response-byte reservations, independently from request rate.
            _, byte_token = key('t9-bytes')
            configure('t9-bytes', output=332820, bytes=332820)
            get(tile, credential=byte_token)
            get(tile, 429, credential=byte_token)
            get(tile, credential=other_token)

            # Two keys of one organization share a quota; a second organization does not.
            _, shared_a = key('t9-shared')
            _, shared_b = key('t9-shared')
            configure('t9-shared', requests=1)
            get(metadata, credential=shared_a)
            get(tile, 429, credential=shared_b)
            get(tile, credential=other_token)

            # Aggregate demo prefetch budget is independent of both organizations and IP headers.
            # The earlier public catalogue already used this minute. Lifetime
            # usage is not the sliding-window count after a long T5 regression.
            get(metadata[4:], credential=None)
            configure(requests=1)
            try:
                get(metadata[4:], 429, credential=None)
                get(tile[4:], 429, credential=None, headers={'X-Forwarded-For': '192.0.2.1', 'X-Organization': 'fake'})
                get(metadata[4:], 429, credential=None)
                get(tile, credential=other_token)
            finally:
                configure()
            get(metadata[4:], credential=None)

            configure('t9-resources', zoom=3, dimension=32)
            get(tile.replace('/3/4/2.f32', '/4/8/4.f32'), 400)
            get(tile.replace('/3/4/2.f32', '/3/8/2.f32'), 400)
            caps = {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetCapabilities'}
            get('/org' + selected['wms'], params=caps)
            for width in ('33', '²', '9' * 100):
                get('/org' + selected['wms'], 400, params={**caps, 'REQUEST': 'GetMap', 'WIDTH': width, 'HEIGHT': '32'})
            query = {name: selected[name] for name in ('selection', 'run', 'revision', 'valid_time')}
            query.update(layer=selected['field'], lon=-23.5, lat=29.5)
            get('/org/api/v1/point', params=query)

            # Invalid credentials cannot borrow a known key ID prefix.
            unknown = token[:-1] + ('A' if token[-1] != 'A' else 'B')
            invalid = get(tile, 401, credential=unknown)
            missing = get(tile, 401, credential=None)
            revoked = subprocess.run([sys.executable, '-m', 'publication.access', 'revoke', '--id', identity['id']], capture_output=True)
            self.assertEqual(revoked.returncode, 0)
            get(tile, 401, headers={'If-None-Match': 'cached'})
            get(tile, credential=other_token)
            all_rows = self.command('usage', '--limit', '10000')['requests']
            for response in (invalid, missing):
                row = next(row for row in all_rows if row['request_id'] == response.headers['X-Request-ID'])
                self.assertIsNone(row['organization'])
                self.assertIsNone(row['key_id'])
                self.assertEqual(row['cache'], 'not-accessed')

            # Actual cold generation is slow, so a second concurrent organization
            # request and a post-timeout retry must remain rejected.
            _, slow_token = key('t9-slow')
            configure('t9-slow', seconds=4, concurrency=1)
            _, generator_token = key('t9-generator')
            configure('t9-generator', seconds=4, concurrency=1)
            slow_marker = Path('/assets/.t9-tile-delay')
            slow_marker.touch()
            cold = tile.replace('/3/4/2.f32', '/6/33/20.f32')
            try:
                started = time.monotonic()
                with ThreadPoolExecutor(max_workers=2) as executor:
                    contenders = {
                        executor.submit(get, cold, (429, 504), slow_token): slow_token,
                        executor.submit(get, cold.replace('/33/', '/35/'), (429, 504), generator_token): generator_token}
                    completed, pending_contenders = wait(contenders, timeout=3, return_when=FIRST_COMPLETED)
                    self.assertEqual(len(completed), 1)
                    self.assertEqual(next(iter(completed)).result().status_code, 429)
                    active = next(iter(pending_contenders))
                    active_token = contenders[active]
                    get(tile, 429, credential=active_token)
                    get(tile, credential=other_token)
                    self.assertEqual(active.result(timeout=10).status_code, 504)
                self.assertLess(time.monotonic() - started, 8)
                get(tile, 429, credential=active_token)
                get(tile, credential=other_token)
            finally:
                slow_marker.unlink(missing_ok=True)

            # Retention is an operator surface, independent of forecast retention.
            self.command('retention', '--days', '1')
            before = self.command('usage', '--organization', 't9-resources')['requests']
            self.assertEqual(self.command('collect', '--now', '2000-01-01T00:00:00Z')['deleted'], 0)
            self.command('collect', '--now', '2099-01-01T00:00:00Z')
            after = self.command('usage', '--organization', 't9-resources')['requests']
            self.assertEqual(before, after)  # Current rate window must survive even explicit test clocks.
            self.command('retention', '--days', '30')
            # Two-tile cache budget in this runner: a third cold tile evicts
            # the oldest. Disabled generation distinguishes eviction from a hit.
            eviction_tiles = [tile.replace('/3/4/2.f32', f'/3/{x}/2.f32') for x in (5, 6, 7)]
            for path in eviction_tiles:
                get(path, credential=other_token)
            marker.touch()
            try:
                get(eviction_tiles[0], 503, credential=other_token)
                get(eviction_tiles[-1], credential=other_token)
            finally:
                marker.unlink(missing_ok=True)
            all_rows = self.command('usage', '--limit', '10000')['requests']
            by_id = {row['request_id']: row for row in all_rows}
            for observation in observations:
                row = by_id[observation['request_id']]
                self.assertEqual(row['status'], observation['status'])
                self.assertEqual(row['bytes'], observation['bytes'])
                self.assertGreaterEqual(row['duration_ms'], 0)
                self.assertIsNotNone(row['observed_at'])
            self.assertTrue(all(secret not in json.dumps(all_rows) for secret in (token, other_token, shared_a, shared_b, slow_token)))
            # Wait for the real protected minute to pass, then use only the
            # collector's explicit historical clock; no database backdoor.
            _, io_token = key('t9-io')
            configure('t9-io', seconds=4, concurrency=1)
            io_tokens = [io_token]
            for index in range(3):
                _, blocked_token = key('t9-blocked-' + str(index))
                configure('t9-blocked-' + str(index), seconds=4, concurrency=1)
                io_tokens.append(blocked_token)
            _, queued_token = key('t9-queued')
            configure('t9-queued', seconds=1, concurrency=1)
            io_marker = Path('/assets/.t9-reader-delay')
            io_marker.touch()
            try:
                with ThreadPoolExecutor(max_workers=4) as executor:
                    blocked = [executor.submit(get, tile.replace('/3/4/2.f32', '/6/34/20.f32'), 504, item) for item in io_tokens]
                    for pending in blocked:
                        pending.result(timeout=10)
                get(metadata, 504, credential=queued_token)
                time.sleep(41)
                get(metadata, 429, credential=io_token)
                io_pending = self.command('usage', '--organization', 't9-io')['requests']
                self.assertTrue(io_pending[0]['backend_started'])
                self.assertFalse(io_pending[0]['backend_done'])
                get(metadata, 504, credential=queued_token)
                # The second queued timeout owns its own conservative 40s
                # reservation, even when its expired API request was discarded.
                time.sleep(41)
                get(metadata, credential=io_token)
                get(metadata, credential=queued_token)
                io_completed = self.command('usage', '--organization', 't9-io')['requests']
                queued = self.command('usage', '--organization', 't9-queued')['requests']
                self.assertTrue(io_completed[0]['backend_done'])
                self.assertEqual([row['status'] for row in queued], [504, 504, 200])
                self.assertEqual([row['backend_started'] for row in queued], [False, False, True])
            finally:
                io_marker.unlink(missing_ok=True)
            self.command('retention', '--days', '1')
            collection = self.command('collect', '--now', '2099-01-01T00:00:00Z')
            self.assertGreater(collection['deleted'], 0)
            self.assertEqual(self.command('usage', '--organization', 't9-resources')['requests'], [])
            self.command('retention', '--days', '30')
            get(tile, credential=slow_token)  # Expired timeout lease admits work again.
            (Path('/evidence') / 't9-resources.json').write_text(json.dumps({
                'status': 'passed', 'observations': observations, 'requests': all_rows,
                'usage_retention_days': 30, 'collection': collection, 'gis_limits': gis_limits,
                'io_pending': io_pending, 'io_completed': io_completed, 'queued': queued,
                'timeout_reservation': 'held until conservative lease expires; subsequent request succeeds'}, indent=2) + '\n')
