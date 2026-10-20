"""T8: gateway boundary supplements and actual-service operator/HTTP acceptance."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

import requests

from publication.gateway import create_app


class GatewayBoundary(unittest.TestCase):
    def test_missing_key_is_challenged_before_any_backend_request(self):
        response = create_app().test_client().get('/org/api/v1/catalogue')
        self.assertEqual(response.status_code, 401)
        assert response.json is not None
        self.assertEqual(response.json['code'], 'Unauthorized')
        self.assertIn('WWW-Authenticate', response.headers)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_url_secrets_and_ambiguous_headers_are_rejected_without_echo(self):
        client = create_app().test_client()
        for path in ('/api/v1/catalogue', '/org/api/v1/catalogue'):
            response = client.get(path + '?api_key=private-sentinel')
            self.assertEqual(response.status_code, 400)
            self.assertNotIn(b'private-sentinel', response.data)
        for headers in ({'Authorization': 'Basic private-sentinel'},
                        {'Authorization': 'Bearer invalid', 'X-API-Key': 'invalid'}):
            self.assertEqual(client.get('/org/api/v1/catalogue', headers=headers).status_code, 401)

    def test_backend_admin_assets_and_near_match_routes_are_not_forwarded(self):
        client = create_app().test_client()
        for path in ('/geoserver/rest', '/api/v1/pointless', '/org/geoserver/wms',
                     '/org/assets/manifest.json', '/static/private.key', '/org/api/v1/admin'):
            self.assertEqual(client.get(path).status_code, 404)


@unittest.skipUnless(os.environ.get('T8_HTTP') == '1', 'requires isolated T8 real Compose services')
class OrganizationAccess(unittest.TestCase):
    base = 'http://gateway:8000'
    evidence = Path('/evidence')

    def command(self, *arguments, success=True):
        result = subprocess.run([sys.executable, '-m', 'publication.access', *map(str, arguments)],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode == 0, success, result.stderr)
        return json.loads(result.stdout) if success else None

    def get(self, path, token=None, expected=200, **kwargs):
        headers = kwargs.pop('headers', {})
        if token is not None:
            headers['Authorization'] = 'Bearer ' + token
        result = requests.get(self.base + path, headers=headers, timeout=90, **kwargs)
        # Do not print response bodies or prepared request headers on failure.
        self.assertEqual(result.status_code, expected, path)
        return result

    def test_operator_and_gateway_policies(self):
        self.command('migrate')
        with tempfile.TemporaryDirectory() as directory:
            first_path = Path(directory) / 'first.key'
            a = self.command('create', '--organization', 'alpha', '--profile', 'all', '--out', first_path)
            first = first_path.read_text().strip()
            self.assertEqual(first_path.stat().st_mode & 0o777, 0o600)
            b_path = self.evidence / 't8-survivor.key'
            b = self.command('create', '--organization', 'beta', '--profile', 'all', '--out', b_path)
            second = b_path.read_text().strip()
            # Security audit supplement: list never exposes digests, while the
            # durable representation must contain only hashes of random keys.
            from publication.domain import database
            with database() as cursor:
                cursor.execute('SELECT digest FROM access.keys')
                digests = [row['digest'] for row in cursor.fetchall()]
                self.assertTrue(hashlib.sha256(first.encode()).hexdigest() in digests)
                self.assertTrue(hashlib.sha256(second.encode()).hexdigest() in digests)
                self.assertTrue(all(len(value) == 64 and first not in value and second not in value for value in digests))
            self.command('create', '--organization', 'alpha', '--profile', 'all', '--out', first_path, success=False)
            self.get('/org/api/v1/catalogue', first)
            catalogue = self.get('/api/v1/catalogue').json()
            selected = next(item for item in catalogue['selections'] if item['fixture'] == 'actual')
            org_catalogue = self.get('/org/api/v1/catalogue', first).json()
            protected = next(item for item in org_catalogue['selections'] if item['selection'] == selected['selection'])
            for key in ('point', 'tiles', 'wms'):
                self.assertEqual(protected[key], '/org' + selected[key])
            metadata = self.get(protected['tiles'], first).json()
            self.assertTrue(metadata['url'].startswith('/org/api/'))
            tile = metadata['url'].replace('{z}', '3').replace('{x}', '4').replace('{y}', '2')
            query = {key: selected[key] for key in ('selection', 'run', 'revision', 'valid_time')}
            query.update(layer=selected['field'], lon=-23.5, lat=29.5)
            self.assertEqual(self.get(protected['point'], first, params=query).json()['value'], 298.2274169921875)
            capabilities = {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetCapabilities'}
            caps = self.get(protected['wms'], first, params=capabilities)
            root = ET.fromstring(caps.content)
            hrefs = [value for node in root.iter() for key, value in node.attrib.items() if key.endswith('}href')]
            self.assertTrue(hrefs)
            self.assertTrue(all(value.startswith(protected['wms'] + '?') for value in hrefs))
            map_params = {**capabilities, 'REQUEST': 'GetMap', 'LAYERS': 'temperature', 'STYLES': '',
                          'TIME': selected['valid_time'], 'CRS': 'EPSG:3857',
                          'BBOX': '-1000000,5000000,3000000,9000000', 'WIDTH': 64, 'HEIGHT': 64, 'FORMAT': 'image/png'}
            public_map = self.get(selected['wms'], params=map_params)
            self.assertTrue(self.get(protected['wms'], first, params=map_params).content == public_map.content)
            endpoints = [(protected['tiles'], {}), (tile, {}), (protected['point'], query),
                         (protected['wms'], capabilities), (protected['wms'], map_params)]
            # Warm the actual API numeric cache; a generation fault then proves
            # this very URL remains a hit while a cold tile fails.
            warm = self.get(tile, first)
            marker = Path('/assets/.t6-generation')
            marker.touch()
            try:
                self.get(tile.replace('/3/4/2.f32', '/6/32/20.f32'), first, expected=503)
                self.assertTrue(self.get(tile, second).content == warm.content)
                for path, params in endpoints:
                    self.get(path, expected=401, params=params)
                    self.get(path, 'invalid', expected=401, params=params)
                rotated_path = Path(directory) / 'rotated.key'
                # Failed output delivery preserves the original working key.
                self.command('rotate', '--id', a['id'], '--out', first_path, success=False)
                self.get(tile, first)
                rotated = self.command('rotate', '--id', a['id'], '--out', rotated_path)
                replacement = rotated_path.read_text().strip()
                self.assertEqual(rotated['organization'], 'alpha')
                self.assertEqual(rotated['profile'], 'all')
                for path, params in endpoints:
                    self.get(path, first, expected=401, params=params)
                    self.get(path, replacement, params=params)
                    self.get(path, second, params=params)
                self.command('revoke', '--id', rotated['id'])
                self.command('revoke', '--id', rotated['id'])
                for path, params in endpoints:
                    denied = self.get(path, replacement, expected=401, params=params)
                    self.assertEqual(denied.headers['Cache-Control'], 'no-store')
                    self.get(path, second, params=params)
                # Conditional requests cannot turn a denied read into a 304.
                self.get(tile, replacement, expected=401, headers={'If-None-Match': warm.headers['ETag']})
                self.get(tile, headers={'X-API-Key': second})
                self.get(tile, second, headers={'X-API-Key': second}, expected=401)
                for profile, allowed, denied_path in (
                        ('numeric', '/org/api/v1/catalogue', protected['wms']),
                        ('gis', protected['wms'], protected['tiles'])):
                    path = Path(directory) / (profile + '.key')
                    self.command('create', '--organization', 'limited', '--profile', profile, '--out', path)
                    token = path.read_text().strip()
                    self.get(allowed, token, params=capabilities if profile == 'gis' else {})
                    denied = self.get(denied_path, token, expected=403)
                    self.assertEqual(denied.json()['code'], 'Forbidden')
                # A browser uses public links without organization headers.
                self.get(tile[4:])
                self.get(selected['tiles'])
                self.get('/api/v1/catalogue', second, expected=400)
                for path in ('/assets', '/geoserver/rest', '/geoserver/wms', '/org/geoserver/web',
                             '/api:8000/api/v1/catalogue', '/org/api/v1/selections/admin/tiles.json'):
                    self.get(path, second, expected=404)
            finally:
                marker.unlink(missing_ok=True)
            listing = self.command('list')
            self.assertTrue(all(set(item) == {'id', 'organization', 'profile', 'created_at', 'revoked_at'}
                                for item in listing['keys']))
            # Private temporary files bridge the restart phases; never archive them.
            (self.evidence / 't8-revoked.key').write_text(replacement)
            (self.evidence / 't8-access.json').write_text(json.dumps({
                'status': 'passed', 'organization_ids': ['alpha', 'beta'], 'survivor_id': b['id'],
                'tile': tile, 'tiles': protected['tiles'], 'tile_sha256': hashlib.sha256(warm.content).hexdigest(),
                'checks': ['create/exclusive delivery/0600/list/hashed storage', 'atomic rotate and failed delivery',
                           'revoke/independent organization', 'numeric and GIS profiles/401/403',
                           'point/metadata/bytes/WMS capabilities and real map', 'protected discovery links',
                           'warm cache proven with disabled generation', 'conditional revoked read',
                           'public demo without credentials', 'gateway bypass denial'],
                'clock': '2026-10-19T05:00:00Z'}, indent=2) + '\n')

    @unittest.skipUnless(os.environ.get('T8_RESTART') == '1', 'separate post-restart phase')
    def test_restart_and_secret_free_evidence(self):
        evidence = json.loads((self.evidence / 't8-access.json').read_bytes())
        valid = (self.evidence / 't8-survivor.key').read_text().strip()
        revoked = (self.evidence / 't8-revoked.key').read_text().strip()
        self.get(evidence['tiles'], valid)
        payload = self.get(evidence['tile'], valid).content
        self.assertEqual(hashlib.sha256(payload).hexdigest(), evidence['tile_sha256'])
        self.get(evidence['tile'], revoked, expected=401)
        for path in self.evidence.rglob('*'):
            if path.is_file() and path.suffix in ('.log', '.json', '.jsonl', '.html'):
                data = path.read_bytes()
                self.assertFalse(valid.encode() in data or revoked.encode() in data, path.name)
                from publication.access import KEY_PATTERN
                self.assertIsNone(KEY_PATTERN.search(data.decode('utf-8', errors='replace')), path.name)
        (self.evidence / 't8-restart.json').write_text(json.dumps({
            'status': 'passed', 'revoked': 401, 'independent_organization': 200,
            'logs_and_reports_have_no_raw_keys': True}) + '\n')
