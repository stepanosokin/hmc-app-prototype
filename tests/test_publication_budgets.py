"""T9 actual gateway/cache acceptance, using the operator policy/usage interface."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED

import requests


@unittest.skipUnless(os.environ.get('T9_HTTP') == '1', 'requires isolated T9 actual-sample services')
class UsageBudgets(unittest.TestCase):
    def test_a_wms_public_burst_completes_without_duplicate_accounting(self):
        """A normal six-tile QGIS burst must wait for the two public slots."""
        import threading
        from PIL import Image
        import io

        base = 'http://gateway:8000'
        selected = next(item for item in requests.get(base+'/api/v1/catalogue', timeout=30).json()['selections']
                        if item['fixture'] == 'actual')
        barrier = threading.Barrier(6)

        def render(index):
            barrier.wait(timeout=10)
            return requests.get(base+selected['wms'], params={
                'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap', 'LAYERS': 'temperature',
                'STYLES': '', 'FORMAT': 'image/png', 'TRANSPARENT': 'true', 'CRS': 'EPSG:4326',
                'TIME': selected['valid_time'], 'BBOX': f'45,{10+index},55,{20+index}',
                'WIDTH': '256', 'HEIGHT': '256'}, timeout=40)

        active = []
        marker = Path('/assets/.t9-wms-delay')
        marker.touch()
        try:
            with ThreadPoolExecutor(max_workers=6) as executor:
                pending = [executor.submit(render, index) for index in range(6)]
                while not all(future.done() for future in pending):
                    rows = self.command('usage', '--public')['requests']
                    active.append(sum(row['admitted'] and row['status'] is None for row in rows))
                    time.sleep(.05)
                responses = [future.result() for future in pending]
        finally:
            marker.unlink(missing_ok=True)
        statuses = [response.status_code for response in responses]
        rows = self.command('usage', '--public')['requests']
        observations = []
        for response in responses:
            matches = [row for row in rows if row['request_id'] == response.headers['X-Request-ID']]
            self.assertEqual(len(matches), 1)
            observations.append(matches[0])
        Path('/evidence/t9-wms-burst.json').write_text(json.dumps({
            'statuses': statuses, 'active_samples': active, 'requests': observations}, indent=2))
        self.assertEqual(statuses, [200]*6)
        self.assertEqual(max(active), 2)
        for response in responses:
            image = Image.open(io.BytesIO(response.content)).convert('RGBA')
            self.assertIsNotNone(image.getchannel('A').getbbox())

    def wms_fixture(self):
        base = 'http://gateway:8000'
        selected = next(item for item in requests.get(base+'/api/v1/catalogue', timeout=30).json()['selections']
                        if item['fixture'] == 'actual')
        params = {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap', 'LAYERS': 'temperature',
                  'STYLES': '', 'FORMAT': 'image/png', 'CRS': 'EPSG:4326', 'BBOX': '45,10,55,30',
                  'WIDTH': '32', 'HEIGHT': '32', 'TIME': selected['valid_time']}
        if os.environ.get('T106_WMS') == '1':
            import xml.etree.ElementTree as ET
            from urllib.parse import urlsplit
            response = requests.get(base+'/gis/v1/wms', timeout=30)
            self.assertEqual(response.status_code, 200)
            root = ET.fromstring(response.content)
            resource = root.find('.//{*}GetMap//{*}OnlineResource')
            assert resource is not None
            url = urlsplit(resource.attrib['{http://www.w3.org/1999/xlink}href'])
            selected = {**selected, 'wms': url.path+'?'+url.query}
            layer_name = root.findtext('.//{*}Layer/{*}Name')
            assert layer_name is not None
            params['LAYERS'] = layer_name
            params.pop('TIME')  # The snapshot's advertised earliest time.
        return base, selected, params

    def test_b_wms_queue_bounds_preserve_other_bucket_and_control_requests(self):
        import threading
        from publication.access import issue
        base, selected, params = self.wms_fixture()
        snapshots = []
        queue_org = 't9-wms-queue-'+uuid.uuid4().hex[:8]
        other_org = 't9-wms-other-'+uuid.uuid4().hex[:8]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            headers = []
            for name, organization in (('a', queue_org), ('b', queue_org), ('other', other_org)):
                issue(organization, 'all', root/name)
                headers.append({'X-API-Key': (root/name).read_text().strip()})
            policy = root/'policy'
            policy.write_text(json.dumps({'concurrency': 4, 'seconds': 15}))
            self.command('configure', '--organization', queue_org, '--file', policy)
            marker = Path('/assets/.t9-wms-delay')
            barrier = threading.Barrier(6)

            def render(index):
                barrier.wait(timeout=10)
                return requests.get(base+'/org'+selected['wms'], params=params,
                                    headers=headers[index % 2], timeout=25)

            def rows():
                result = self.command('usage', '--organization', queue_org)['requests']
                snapshots.append(result)
                return result

            marker.touch()
            try:
                with ThreadPoolExecutor(max_workers=7) as executor:
                    pending = [executor.submit(render, index) for index in range(6)]
                    deadline = time.monotonic()+8
                    while True:
                        observed = rows()
                        if len(observed) == 6 and all(row['status'] is None for row in observed):
                            break
                        self.assertLess(time.monotonic(), deadline, 'six simultaneous GetMaps were not observed')
                        time.sleep(.05)
                    self.assertEqual(sum(row['admitted'] for row in observed), 2)
                    overloaded = requests.get(base+'/org'+selected['wms'], params=params, headers=headers[1], timeout=3)
                    self.assertEqual(overloaded.status_code, 429)
                    self.assertEqual(overloaded.headers['Retry-After'], '2')
                    other = executor.submit(requests.get, base+'/org'+selected['wms'],
                                            params=params, headers=headers[2], timeout=10)
                    deadline = time.monotonic()+3
                    while not any(row['backend_started'] for row in self.command('usage', '--organization', other_org)['requests']):
                        self.assertLess(time.monotonic(), deadline)
                        time.sleep(.05)
                    global_overload = requests.get(base+'/org'+selected['wms'], params=params, headers=headers[2], timeout=3)
                    self.assertEqual(global_overload.status_code, 429)
                    self.assertEqual(global_overload.headers['Retry-After'], '2')
                    started = time.monotonic()
                    self.assertEqual(requests.get(base+'/health', timeout=3).status_code, 200)
                    self.assertEqual(requests.get(base+'/org/api/v1/catalogue', headers=headers[2], timeout=3).status_code, 200)
                    self.assertLess(time.monotonic()-started, 3)
                    self.assertEqual(other.result().status_code, 200)
                    while not all(future.done() for future in pending):
                        observed = rows()
                        self.assertLessEqual(sum(row['admitted'] and row['status'] is None for row in observed), 2)
                        time.sleep(.1)
                    self.assertEqual([future.result().status_code for future in pending], [200]*6)
            finally:
                marker.unlink(missing_ok=True)
                Path('/evidence/t9-wms-queue.json').write_text(json.dumps({'snapshots': snapshots}, indent=2))

    def test_c_wms_wait_deadline_revocation_and_disconnect(self):
        import socket
        from urllib.parse import urlencode
        from publication.access import issue
        base, selected, params = self.wms_fixture()
        path = '/org'+selected['wms']
        observations = {}
        marker = Path('/assets/.t9-wms-delay')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def credential(name, organization, seconds=10):
                identity = issue(organization, 'all', root/name)
                token = (root/name).read_text().strip()
                policy = root/'policy'
                policy.write_text(json.dumps({'concurrency': 1, 'seconds': seconds}))
                self.command('configure', '--organization', organization, '--file', policy)
                return identity, {'X-API-Key': token}

            def get(headers):
                return requests.get(base+path, params=params, headers=headers, timeout=15)

            def observe(organization, condition):
                deadline = time.monotonic()+5
                while True:
                    rows = self.command('usage', '--organization', organization)['requests']
                    if condition(rows):
                        return rows
                    self.assertLess(time.monotonic(), deadline, organization)
                    time.sleep(.05)

            marker.touch()
            try:
                _, timed = credential('timed', 't9-wms-deadline', 1)
                with ThreadPoolExecutor(max_workers=2) as executor:
                    first = executor.submit(get, timed)
                    observe('t9-wms-deadline', lambda rows: any(row['backend_started'] for row in rows))
                    second = executor.submit(get, timed)
                    self.assertEqual(first.result().status_code, 504)
                    self.assertEqual(second.result().status_code, 504)
                rows = observe('t9-wms-deadline', lambda rows: any(row['backend_done'] for row in rows))
                self.assertEqual(sum(row['backend_started'] for row in rows), 1)
                # Completed backend alone does not erase the 40s timeout lease.
                self.assertEqual(get(timed).status_code, 504)
                observations['deadline'] = self.command('usage', '--organization', 't9-wms-deadline')['requests']
                self.assertEqual(sum(row['backend_started'] for row in observations['deadline']), 1)

                _, keeper = credential('keeper', 't9-wms-revoke')
                revoked, victim = credential('victim', 't9-wms-revoke')
                with ThreadPoolExecutor(max_workers=2) as executor:
                    first = executor.submit(get, keeper)
                    observe('t9-wms-revoke', lambda rows: any(row['backend_started'] for row in rows))
                    second = executor.submit(get, victim)
                    observe('t9-wms-revoke', lambda rows: len(rows) == 2 and not rows[-1]['admitted'])
                    result = subprocess.run([sys.executable, '-m', 'publication.access', 'revoke', '--id', revoked['id']],
                                            capture_output=True, timeout=10)
                    self.assertEqual(result.returncode, 0)
                    self.assertEqual(second.result().status_code, 401)
                    self.assertEqual(first.result().status_code, 200)
                observations['revoked'] = self.command('usage', '--organization', 't9-wms-revoke')['requests']
                self.assertFalse(observations['revoked'][-1]['backend_started'])

                _, cancel = credential('cancel', 't9-wms-disconnect')
                with ThreadPoolExecutor(max_workers=1) as executor:
                    first = executor.submit(get, cancel)
                    observe('t9-wms-disconnect', lambda rows: any(row['backend_started'] for row in rows))
                    connection = socket.create_connection(('gateway', 8000), timeout=3)
                    try:
                        connection.sendall(('GET '+path+'?'+urlencode(params)+' HTTP/1.1\r\nHost: gateway\r\nX-API-Key: '
                                            +cancel['X-API-Key']+'\r\nConnection: close\r\n\r\n').encode())
                        observe('t9-wms-disconnect', lambda rows: len(rows) == 2 and not rows[-1]['admitted'])
                    finally:
                        connection.close()
                    rows = observe('t9-wms-disconnect', lambda rows: len(rows) == 2 and rows[-1]['status'] is not None)
                    self.assertEqual(rows[-1]['status'], 504)
                    self.assertFalse(rows[-1]['backend_started'])
                    self.assertEqual(first.result().status_code, 200)
                    observations['disconnect'] = rows
            finally:
                marker.unlink(missing_ok=True)
                Path('/evidence/t9-wms-lifecycle.json').write_text(json.dumps(observations, indent=2))

    def test_d_wms_rate_and_bytes_do_not_wait(self):
        from publication.access import issue
        base, selected, params = self.wms_fixture()
        observations = {}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, limits in (('rate', {'requests': 1}), ('bytes', {'bytes': 1024})):
                organization = 't9-wms-'+name
                issue(organization, 'all', root/name)
                headers = {'X-API-Key': (root/name).read_text().strip()}
                policy = root/'policy'
                policy.write_text(json.dumps(limits))
                self.command('configure', '--organization', organization, '--file', policy)
                if name == 'rate':
                    self.assertEqual(requests.get(base+'/org'+selected['wms'], params=params, headers=headers, timeout=10).status_code, 200)
                started = time.monotonic()
                response = requests.get(base+'/org'+selected['wms'], params=params, headers=headers, timeout=3)
                self.assertEqual(response.status_code, 429)
                self.assertEqual(response.headers['Retry-After'], '60')
                self.assertLess(time.monotonic()-started, 3)
                observations[name] = self.command('usage', '--organization', organization)['requests']
        Path('/evidence/t9-wms-rate-bytes.json').write_text(json.dumps(observations, indent=2))

    def test_e_wms_admission_lock_observes_revocation_and_remaining_deadline(self):
        from publication.access import issue
        from publication.domain import database
        base, selected, params = self.wms_fixture()
        observations = {}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            organization = 't9-wms-lock-'+uuid.uuid4().hex[:8]
            identity = issue(organization, 'all', root/'key')
            headers = {'X-API-Key': (root/'key').read_text().strip()}

            def get():
                return requests.get(base+'/org'+selected['wms'], params=params, headers=headers, timeout=10)

            with ThreadPoolExecutor(max_workers=2) as executor:
                # Fixture holds admission after initial gateway authorization.
                # Consumer assertions remain HTTP + operator usage, not SQL.
                with database() as cursor:
                    cursor.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,9))', ('org:'+organization,))
                    pending = executor.submit(get)
                    deadline = time.monotonic()+1.5
                    while True:
                        cursor.execute("SELECT count(*) AS waiting FROM pg_locks WHERE locktype='advisory' AND NOT granted")
                        lock_state = cursor.fetchone()
                        assert lock_state is not None
                        if lock_state['waiting']:
                            break
                        self.assertLess(time.monotonic(), deadline)
                        time.sleep(.01)
                    revoked = subprocess.run([sys.executable, '-m', 'publication.access', 'revoke', '--id', identity['id']],
                                             capture_output=True, timeout=10)
                    self.assertEqual(revoked.returncode, 0)
                self.assertEqual(pending.result().status_code, 401)
                rows = self.command('usage', '--organization', organization)['requests']
                self.assertEqual(len(rows), 1)
                self.assertFalse(rows[0]['backend_started'])
                observations['revoked_during_lock'] = rows

                organization = 't9-wms-lock-deadline-'+uuid.uuid4().hex[:8]
                issue(organization, 'all', root/'timed-key')
                headers = {'X-API-Key': (root/'timed-key').read_text().strip()}
                policy = root/'policy'
                policy.write_text(json.dumps({'concurrency': 1, 'seconds': 1}))
                self.command('configure', '--organization', organization, '--file', policy)
                marker = Path('/assets/.t9-wms-delay')
                marker.touch()
                try:
                    first = executor.submit(get)
                    deadline = time.monotonic()+3
                    while not any(row['backend_started'] for row in self.command('usage', '--organization', organization)['requests']):
                        self.assertLess(time.monotonic(), deadline)
                    started = time.monotonic()
                    second = executor.submit(get)
                    while len(self.command('usage', '--organization', organization)['requests']) < 2:
                        self.assertLess(time.monotonic()-started, .8)
                    with database() as cursor:
                        cursor.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,9))', ('org:'+organization,))
                        self.assertEqual(second.result(timeout=1.4).status_code, 504)
                        self.assertLess(time.monotonic()-started, 1.4)
                    self.assertEqual(first.result().status_code, 504)
                    rows = self.command('usage', '--organization', organization)['requests']
                    self.assertEqual(sum(row['backend_started'] for row in rows), 1)
                    observations['deadline_during_lock'] = rows
                finally:
                    marker.unlink(missing_ok=True)
        Path('/evidence/t9-wms-admission-lock.json').write_text(json.dumps(observations, indent=2))

    def command(self, *args):
        result = subprocess.run([sys.executable, '-m', 'publication.budgets', *map(str, args)],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_legacy_usage_upgrade_preserves_live_public_reader_and_accounting(self):
        # Explicit legacy-schema fixture; consumer observations remain gateway
        # HTTP and the existing operator usage interface.
        from publication.domain import database
        base = 'http://gateway:8000'
        selected = next(item for item in requests.get(base+'/api/v1/catalogue', timeout=30).json()['selections']
                        if item['fixture'] == 'actual')
        before = self.command('usage', '--public', '--limit', '10')['requests']
        with database() as cursor:
            cursor.execute('ALTER TABLE access.usage DROP COLUMN backend_started, DROP COLUMN backend_done')
        upgraded = subprocess.run([sys.executable, '-m', 'publication.access', 'migrate'],
                                  capture_output=True, text=True, timeout=30)
        self.assertEqual(upgraded.returncode, 0, upgraded.stderr)
        response = requests.get(base+selected['tiles'], timeout=30)
        self.assertEqual(response.status_code, 200, response.text)
        after = self.command('usage', '--public')['requests']
        self.assertTrue({row['request_id'] for row in before}.issubset({row['request_id'] for row in after}))
        observed = next(row for row in after if row['request_id'] == response.headers['X-Request-ID'])
        self.assertEqual(observed['status'], 200)
        Path('/evidence/t10-usage-upgrade.json').write_text(json.dumps({
            'status': 'passed', 'fixture': 'usage schema without backend_started/backend_done',
            'preserved_request_ids': [row['request_id'] for row in before], 'reader': observed}, indent=2))

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
        self.assertEqual(gis_limits, {'maxRenderingTime': 20, 'maxRequestMemory': 65536})
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
