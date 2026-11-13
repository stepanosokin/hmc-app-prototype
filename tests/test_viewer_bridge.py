"""Only the existing public gateway receives the viewer's scoped WMS requests."""
import unittest
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch
import xml.etree.ElementTree as ET

from publication.viewer import create_app


class ViewerBridge(unittest.TestCase):
    def test_common_catalogue_advertises_viewer_urls_without_forwarding_client_headers(self):
        upstream = MagicMock()
        upstream.__enter__.return_value = upstream
        upstream.status_code = 200
        upstream.headers = {'Content-Type': 'application/xml'}
        upstream.iter_content.return_value = [b'<WMS_Capabilities xmlns="http://www.opengis.net/wms" '
            b'xmlns:xlink="http://www.w3.org/1999/xlink"><Capability><Request>' + b''.join(
            b'<'+operation+b'><OnlineResource xlink:href="http://gateway:8000/gis/v1/wms?snapshot=abc&amp;"/></'+operation+b'>'
            for operation in (b'GetCapabilities', b'GetMap', b'GetFeatureInfo', b'GetLegendGraphic'))
            + b'</Request><Layer><Style><LegendURL><OnlineResource xlink:href="http://gateway:8000/gis/v1/wms?snapshot=abc&amp;REQUEST=GetLegendGraphic&amp;LAYER=hmc_1"/>'
            b'</LegendURL></Style></Layer></Capability></WMS_Capabilities>']
        with patch('publication.viewer.requests.get', return_value=upstream) as get:
            response = create_app().test_client().get('/gis/v1/wms?SERVICE=WMS&REQUEST=GetCapabilities',
                headers={'Host': 'viewer.example', 'Authorization': 'Bearer private', 'X-API-Key': 'private'})
        self.assertEqual(response.status_code, 200)
        arguments, options = get.call_args
        self.assertEqual(arguments[0], 'http://gateway:8000/gis/v1/wms')
        self.assertNotIn('headers', options)
        self.assertNotIn('cookies', options)
        hrefs = [node.attrib['{http://www.w3.org/1999/xlink}href'] for node in ET.fromstring(response.data).findall('.//{*}OnlineResource')]
        self.assertEqual(hrefs, ['http://viewer.example/gis/v1/wms?snapshot=abc&']*4 +
                         ['http://viewer.example/gis/v1/wms?snapshot=abc&REQUEST=GetLegendGraphic&LAYER=hmc_1'])
        # The copied URL itself has no REQUEST; the facade defaults to capabilities.
        with patch('publication.viewer.requests.get', return_value=upstream):
            bare = create_app().test_client().get('/gis/v1/wms?snapshot=abc', headers={'Host': 'viewer.example'})
        self.assertEqual(bare.data, response.data)

    def test_project_budget_is_read_on_each_request_and_only_public_value_is_returned(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'viewer.json'
            with patch('publication.viewer.VIEWER_CONFIG', config):
                client = create_app().test_client()
                self.assertEqual(client.get('/build/viewer-config.js').data, b'export const viewerConfig = {};\n')
                config.write_text('{"map_memory_mib":512,"private":"do-not-publish"}', encoding='utf-8')
                response = client.get('/build/viewer-config.js')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.mimetype, 'text/javascript')
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
                self.assertEqual(response.data, b'export const viewerConfig = {"map_memory_mib": 512};\n')
                config.write_text('{"map_memory_mib":256}', encoding='utf-8')
                self.assertIn(b'256', client.get('/build/viewer-config.js').data)
                for value in ['null', 'true', '0', '-1', '1.5', '"512"', '99999999999999999']:
                    config.write_text('{"map_memory_mib":' + value + '}', encoding='utf-8')
                    self.assertEqual(client.get('/build/viewer-config.js').status_code, 500)

    def test_scoped_wms_uses_fixed_public_upstream_without_browser_credentials(self):
        path = '/gis/v1/runs/ICON-EU%2F2026-10-15T00:00:00Z/revisions/abcd/wms'
        upstream = MagicMock()
        upstream.__enter__.return_value = upstream
        upstream.status_code = 429
        upstream.headers = {'Content-Type': 'application/xml', 'Retry-After': '1'}
        upstream.iter_content.return_value = [b'<ServiceException/>']
        with patch('publication.viewer.requests.get', return_value=upstream) as get:
            response = create_app().test_client().get(path + '?SERVICE=WMS&REQUEST=GetCapabilities',
                headers={'Authorization': 'Bearer private', 'X-API-Key': 'private',
                         'Cookie': 'private=private', 'Host': 'untrusted.invalid'})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers['Retry-After'], '1')
        arguments, options = get.call_args
        self.assertEqual(arguments[0], 'http://gateway:8000' + path.replace('%2F', '/'))
        self.assertEqual(options['params'], [('SERVICE', 'WMS'), ('REQUEST', 'GetCapabilities')])
        self.assertNotIn('headers', options)
        self.assertNotIn('cookies', options)
        self.assertFalse(options['allow_redirects'])

    def test_private_unscoped_and_external_paths_never_reach_gateway(self):
        paths = ['/org/gis/v1/runs/r/revisions/abcd/wms', '/gis/wms',
                 '/geoserver/rest', '/gis/v1/runs/r/revisions/not-a-revision/wms',
                 '/https://untrusted.invalid/gis/wms']
        with patch('publication.viewer.requests.get') as get:
            client = create_app().test_client()
            for path in paths:
                with self.subTest(path=path):
                    self.assertEqual(client.get(path).status_code, 404)
            get.assert_not_called()
