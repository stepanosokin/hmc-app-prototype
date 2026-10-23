"""Source override/fallback and independent spherical-rotation placement checks."""

import math
import tempfile
import shutil
import unittest
from pathlib import Path

from decoder.source_crs import LEGACY_ID, resolve, transformation, to_wgs84, apply

PROJ = '+proj=ob_tran +o_proj=longlat +o_lon_p=0 +o_lat_p=25 +lon_0=90 +to_meter=0.01745329'


class SourceCRS(unittest.TestCase):
    @unittest.skipUnless(Path('/input/ICON_EU_T_G_2026101500.grib2').is_file(), 'requires actual GRIB sample')
    def test_normal_storage_build_uses_source_override(self):
        from decoder.storage import build
        import json
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            source=root/'sample.grib2'
            shutil.copyfile('/input/ICON_EU_T_G_2026101500.grib2',source)
            (root/'proj.txt').write_text(PROJ,encoding='utf-8')
            # Explicit mask supplement limits this default-path regression to
            # one real decoded hour; the service gate checks all actual times.
            result=build(source,root/'output','2026-10-19T05:00:00Z',synthetic_nodata=True)
            manifest=json.loads((root/'output/manifest.json').read_text())
            metadata=manifest['fields'][0]['metadata']
            self.assertEqual(result['status'],'passed')
            self.assertEqual(metadata['source_crs']['source'],'proj.txt')
            self.assertIn('gis_derivative',manifest['fields'][0])

    def test_override_earth_shape_exact_text_and_roundtrip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'proj.txt'
            path.write_text(PROJ + '\n', encoding='utf-8')
            crs = resolve(path)
            self.assertEqual(crs['source_text'], PROJ + '\n')
            self.assertEqual(crs['semi_major_m'], 6371229)
            self.assertNotEqual(crs['id'], LEGACY_ID)
            for x, y in [(0, 50), (20, 50), (-23.5, 29.5), (62.5, 70.5)]:
                # Independent Cartesian rotation, no production transform helper.
                lam, phi, pole = map(math.radians, (x, y, 25))
                vx, vy, vz = math.cos(phi)*math.cos(lam), math.cos(phi)*math.sin(lam), math.sin(phi)
                gx, gy, gz = math.sin(pole)*vx-math.cos(pole)*vz, vy, math.cos(pole)*vx+math.sin(pole)*vz
                lon = ((math.degrees(math.atan2(gy, gx))+90+180) % 360)-180
                lat = math.degrees(math.atan2(gz, (1-.0066943799901413165)*math.hypot(gx, gy)))
                actual = to_wgs84(x, y, {'source_crs': crs})
                self.assertAlmostEqual(actual[0], lon, places=10)
                self.assertAlmostEqual(actual[1], lat, places=10)
                restored = transformation(crs['resolved_proj']).transform(lon, lat, 0)
                self.assertAlmostEqual(restored[0], x, places=10)
                self.assertAlmostEqual(restored[1], y, places=10)

    def test_missing_invalid_fallback_and_explicit_radius(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'proj.txt'
            self.assertEqual(resolve(path)['fallback_reason'], 'missing')
            for text in ('invalid', '+proj=no_such_projection', ''):
                path.write_text(text, encoding='utf-8')
                result = resolve(path)
                self.assertEqual(result['id'], LEGACY_ID)
                self.assertEqual(result['source'], 'GRIB')
                self.assertEqual(result['fallback_reason'], 'invalid')
            path.write_text(PROJ + ' +R=6371000', encoding='utf-8')
            self.assertEqual(resolve(path)['semi_major_m'], 6371000)

    def test_grid_identity_changes_without_rewriting_raw_grid(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'proj.txt'
            path.write_text(PROJ, encoding='utf-8')
            resolved = resolve(path)
            metadata = apply({'native_grid_sha256': 'raw-grid'}, resolved)
            self.assertEqual(metadata['raw_native_grid_sha256'], 'raw-grid')
            self.assertNotEqual(metadata['native_grid_sha256'], 'raw-grid')
            # Changing the live file cannot change a frozen publication.
            path.write_text('invalid', encoding='utf-8')
            self.assertEqual(metadata['source_crs']['id'], resolved['id'])
            self.assertEqual(resolve(path)['id'], LEGACY_ID)


if __name__ == '__main__':
    unittest.main()
