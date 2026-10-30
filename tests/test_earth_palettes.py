"""Physical colour identity, conservative matching and the WMS approximation."""
import io
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

from decoder.palettes import catalogue, entries, rgb, select, scale
from publication.palette_legend import render


def field(quantity, units, surface='heightAboveGround', level=2, interval=None):
    return {'identity': {'units': units, 'typeOfLevel': surface, 'level': level},
            'raw_identity': dict(zip(('discipline', 'parameterCategory', 'parameterNumber'), quantity)),
            'interval': interval}


class EarthPalettes(unittest.TestCase):
    def test_speed_rejects_averaged_components_even_with_a_common_end_time(self):
        from publication.wind_speed import components, numerical
        batches: dict[str, dict] = {axis: {'source': {'field_descriptor': {'wind_axis': axis, 'wind_pair': 'pair',
                         'units': 'm s**-1', 'interval': None}},
                         'identity': {'run': 'r', 'valid_time': '2026-10-30T06:00:00Z', 'level': 10,
                                      'native_grid_sha256': 'g', 'member': None}} for axis in ('u', 'v')}
        entries = {axis: {'manifest_path': axis, 'manifest_sha256': 'hash'} for axis in batches}
        with patch('publication.wind_speed.load_manifest', side_effect=lambda relative, checksum: batches[relative]):
            self.assertEqual(len(components(entries)), 1)
            for axis, start in [('u', '00'), ('v', '03')]:
                batches[axis]['source']['field_descriptor']['interval'] = {
                    'start': f'2026-10-30T{start}:00:00Z', 'end': '2026-10-30T06:00:00Z', 'statistical_process': 0}
                self.assertEqual(components(entries), [])
            with self.assertRaisesRegex(ValueError, 'мгновенных'):
                numerical(batches['u'], batches['v'], Path('/unused'))

    def test_native_speed_is_a_separate_validated_field(self):
        import eccodes as ec
        import zarr
        from test_grib_fields import field_frame
        from publication.revisions import normalize
        from publication.wind_speed import numerical
        from decoder.sampling import read_values
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = {}
            batches = []
            for axis, number, value in [('u', 2, 3.), ('v', 3, 4.)]:
                handle = ec.codes_new_from_message(field_frame(2, number))
                try:
                    ec.codes_set_values(handle, np.full(12, value))
                    binary = ec.codes_get_message(handle)
                finally:
                    ec.codes_release(handle)
                source = root / (axis+'.grib2')
                source.write_bytes(binary)
                job = {'source_name': source.name, 'request': {'source_profile': 'grib2-fields'}}
                with patch('publication.recovery.checkpoint'):
                    data[axis] = normalize(source, root / axis, 1, binary, 'actual', job=job)
                batches.append({'selection': axis, 'source': data[axis].manifest['source']})
            with patch('publication.wind_speed.sampler', side_effect=lambda b: data[b['selection']]):
                speed = numerical(batches[0], batches[1], root / 'speed')
            item = speed.manifest['fields'][0]
            values = read_values(zarr.open_group(str(speed.root / item['zarr']), mode='r'), 'values')
            np.testing.assert_array_equal(values, np.full((3, 4), 5.))
            self.assertEqual(item['metadata']['raw_identity']['parameterNumber'], 1)
            self.assertEqual(item['metadata']['derived_from'], ['u', 'v'])
            self.assertEqual(item['metadata']['identity']['name'], 'Wind speed derived from U/V')
            self.assertNotIn('paramId', item['metadata']['identity'])
            self.assertIn('paramId', item['metadata']['source_components'][0]['identity'])
            self.assertEqual([part['raw_identity']['parameterNumber'] for part in item['metadata']['source_components']], [2, 3])
            self.assertNotEqual(speed.manifest['source']['message_sha256'], data['u'].manifest['source']['message_sha256'])
            self.assertEqual(len(speed.manifest['source']['components']), 2)
            physical = select(item['metadata'])
            assert physical is not None
            self.assertEqual(physical['id'], 'wind')
            self.assertEqual(data['u'].manifest['fields'][0]['metadata']['raw_identity']['parameterNumber'], 2)

    def test_matching_never_equates_related_quantities(self):
        temperature = select(field((0, 0, 0), 'K'))
        dew = select(field((0, 0, 6), 'K'))
        assert temperature is not None and dew is not None
        self.assertEqual(temperature['id'], 'temperature')
        self.assertEqual(dew['id'], 'temperature')
        self.assertIsNone(select(field((0, 0, 0), 'K', 'surface')))
        self.assertIsNone(select(field((2, 3, 18), 'K')))
        self.assertIsNone(select(field((0, 1, 0), 'kg kg**-1')))
        self.assertIsNone(select(field((0, 3, 0), 'Pa', 'surface')))
        self.assertIsNone(select(field((0, 2, 2), 'm s**-1')))
        self.assertIsNone(select(field((0, 2, 22), 'm s**-1')))
        self.assertIsNone(select(field((0, 0, 0), 'K', interval={'statistical_process': 2})))

    def test_pressure_units_and_precipitation_interval(self):
        pa = select(field((0, 3, 1), 'Pa', 'meanSea'))
        hpa = select(field((0, 3, 1), 'hPa', 'meanSea'))
        assert pa is not None and hpa is not None
        np.testing.assert_array_equal(rgb(np.array([101300.]), pa), rgb(np.array([1013.]), hpa))
        interval = {'start': '2026-10-30T00:00:00Z', 'end': '2026-10-30T03:00:00Z', 'statistical_process': 1}
        mm = select(field((0, 1, 8), 'kg m**-2', interval=interval))
        metres = select(field((0, 1, 8), 'm', interval=interval))
        assert mm is not None and metres is not None
        np.testing.assert_array_equal(rgb(np.array([10.]), mm), rgb(np.array([.01]), metres))
        interval['end'] = '2026-10-30T06:00:00Z'
        self.assertIsNone(select(field((0, 1, 8), 'kg m**-2', interval=interval)))

    def test_every_wms_colour_matches_reference_within_two_rgb_counts(self):
        for key in catalogue()['palettes']:
            palette = scale(key)
            with self.subTest(palette=key):
                knots = entries(palette)
                x = np.linspace(palette['range'][0], palette['range'][1], len(palette['colors'])//4)
                expected = np.array(palette['colors']).reshape(-1, 4)[:, :3]
                values = np.array([value for value, _ in knots])
                colors = np.array([[int(color[i:i+2], 16) for i in (1, 3, 5)] for _, color in knots])
                actual = np.stack([np.interp(x, values, colors[:, c]) for c in range(3)], axis=1)
                self.assertLessEqual(float(np.abs(expected-actual).max()), 1.)

    def test_outside_range_clamps_and_legend_uses_same_colours(self):
        palette = select(field((0, 1, 1), '%'))
        assert palette is not None
        values = rgb(np.array([-100., 0., 100., 200.]), palette)
        np.testing.assert_array_equal(values[0], values[1])
        np.testing.assert_array_equal(values[2], values[3])
        image = Image.open(io.BytesIO(render(palette, '%'))).convert('RGB')
        self.assertEqual(image.size, (256, 72))
        np.testing.assert_array_equal(np.asarray(image)[0], rgb(np.linspace(0, 100, 256), palette))
