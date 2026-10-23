"""Only the existing public gateway receives the viewer's scoped WMS requests."""
import unittest
from unittest.mock import MagicMock, patch

from publication.viewer import create_app


class ViewerBridge(unittest.TestCase):
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
