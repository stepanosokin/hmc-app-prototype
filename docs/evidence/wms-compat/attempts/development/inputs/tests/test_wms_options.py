"""QGIS virtual-canvas geometry and bounded presentation hints."""

import unittest

from publication.wms import normalize


class WmsOptions(unittest.TestCase):
    def test_identify_preserves_pixel_centre_and_resolution(self):
        for crs, bbox in [('EPSG:3857', '100,200,3100,2200'), ('EPSG:4326', '20,-30,70,60')]:
            for i, j in [(0, 0), (1203, 523), (613, 211)]:
                params = dict(REQUEST='GetFeatureInfo', CRS=crs, BBOX=bbox,
                              WIDTH='1204', HEIGHT='524', I=str(i), J=str(j))
                result = normalize(params, 512)
                a, b, c, d = map(float, bbox.split(','))
                x, y, xx, yy = map(float, result['BBOX'].split(','))
                if crs == 'EPSG:4326':
                    dx, dy = (c-a)/524, (d-b)/1204
                    expected = c-(j+.5)*dx, b+(i+.5)*dy
                else:
                    dx, dy = (c-a)/1204, (d-b)/524
                    expected = a+(i+.5)*dx, d-(j+.5)*dy
                self.assertAlmostEqual((x+xx)/2, expected[0])
                self.assertAlmostEqual((y+yy)/2, expected[1])
                self.assertAlmostEqual(xx-x, dx)
                self.assertAlmostEqual(yy-y, dy)
                self.assertEqual([result[k] for k in ('WIDTH', 'HEIGHT', 'I', 'J')], ['1', '1', '0', '0'])

    def test_only_bounded_dpi_hints_and_context_are_accepted(self):
        base = dict(REQUEST='GetMap', WIDTH='512', HEIGHT='512', DPI='96',
                    MAP_RESOLUTION='96', FORMAT_OPTIONS='dpi:96')
        self.assertEqual(normalize(base, 512), dict(REQUEST='GetMap', WIDTH='512', HEIGHT='512'))
        for extra in [dict(WIDTH='513'), dict(WIDTH='0'), dict(DPI='nan'),
                      dict(FORMAT_OPTIONS='dpi:96;layout:arbitrary'), dict(DPI='1201')]:
            with self.assertRaises(ValueError):
                normalize({**base, **extra}, 512)
        for extra in [dict(WIDTH='16385'), dict(I='1204'), dict(J='-1'), dict(BBOX='0,0,nan,1')]:
            with self.assertRaises(ValueError):
                normalize(dict(REQUEST='GetFeatureInfo', WIDTH='1204', HEIGHT='524', I='10', J='10',
                               BBOX='0,0,100,100', **{}) | extra, 512)
