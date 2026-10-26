"""Explicit synthetic fields supplement the real ENA workload, never replace it."""
import tempfile
import unittest
from pathlib import Path

import eccodes as ec
import numpy as np
from PIL import Image
import io
import json

from decoder.inspect_forecast import ValidationError, sections
from decoder.storage import field_metadata, decoded_arrays, write_field, check_field
from test_grib_crs import section


def field_frame(category: int, number: int, step_type: str = 'instant', grid_section:bytes|None=None) -> bytes:
    handle = ec.codes_grib_new_from_samples('regular_ll_sfc_grib2')
    try:
        ec.codes_set(handle, 'parameterCategory', category)
        ec.codes_set(handle, 'parameterNumber', number)
        ec.codes_set(handle, 'dataDate', 20261021)
        ec.codes_set(handle, 'dataTime', 600)
        if step_type != 'instant':
            ec.codes_set(handle, 'stepType', step_type)
            ec.codes_set(handle, 'startStep', 0)
            ec.codes_set(handle, 'endStep', 6)
        original = ec.codes_get_message(handle)
    finally:
        ec.codes_release(handle)
    parts = sections(original)
    body = b''.join((grid_section if grid_section is not None else bytes(section())) if n == 3 else part for n, part in parts.items())
    binary = bytearray(original[:16] + body + b'7777')
    binary[8:16] = len(binary).to_bytes(8, 'big')
    handle = ec.codes_new_from_message(bytes(binary))
    try:
        ec.codes_set_values(handle, np.full(12, 101325.125))
        return ec.codes_get_message(handle)
    finally:
        ec.codes_release(handle)


class GribFields(unittest.TestCase):
    def test_polar_interior_extends_gis_footprint_to_all_longitudes(self):
        from test_grib_crs import angle,put
        from decoder.gis_crs import derivative
        grid=section(1)
        angle(grid,46,-30);angle(grid,50,-60);angle(grid,55,30);angle(grid,59,60)
        put(grid,63,40000000);put(grid,67,30000000)
        binary=field_frame(3,0,grid_section=bytes(grid))
        metadata=field_metadata(binary,1,sample_inventory=False,all_fields=True)
        values,missing=decoded_arrays(binary,[3,4])
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);item=write_field(root,'polar',metadata,values,missing)
            result=derivative(root,item,root/'gis.tif')
            self.assertEqual(result['contained_geographic_poles'],[90])
            self.assertEqual(result['bounds'][0],-180)
            self.assertEqual(result['bounds'][2:], [180,90])
            import rasterio
            with rasterio.open(root/'gis.tif') as raster:
                self.assertEqual(raster.bounds.top,90)
                self.assertTrue((raster.read_masks(1)>0).any())

    def test_decimal_grid_centres_allow_only_affine_roundoff(self):
        handle=ec.codes_new_from_message(field_frame(3,0))
        try:
            for key,value in {'latitudeOfFirstGridPointInDegrees':-30,
                'latitudeOfLastGridPointInDegrees':-29.88,
                'longitudeOfFirstGridPointInDegrees':-60,
                'longitudeOfLastGridPointInDegrees':-59.82,
                'iDirectionIncrementInDegrees':.06,'jDirectionIncrementInDegrees':.06}.items():
                ec.codes_set(handle,key,value)
            binary=ec.codes_get_message(handle)
        finally:ec.codes_release(handle)
        metadata=field_metadata(binary,1,sample_inventory=False,all_fields=True)
        values,missing=decoded_arrays(binary,[3,4])
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);item=write_field(root,'decimal',metadata,values,missing)
            check_field(root,item,values,missing)
            metadata['grid']['cell_centres'][0]['lat']+=.001
            # Check the public validator also rejects a meaningful displacement.
            with self.assertRaises(ValidationError):check_field(root,item,values,missing)

    def test_pressure_keeps_units_identity_and_exact_native_values(self):
        binary = field_frame(3, 0)
        with self.assertRaises(ValidationError):
            field_metadata(binary, 1, sample_inventory=False)
        metadata = field_metadata(binary, 1, sample_inventory=False, all_fields=True)
        self.assertEqual(metadata['identity']['units'], 'Pa')
        self.assertEqual(metadata['raw_identity']['parameterCategory'], 3)
        self.assertNotEqual(metadata['field'], 'T_G:surface:0')
        values, missing = decoded_arrays(binary, [3, 4])
        np.testing.assert_array_equal(values, np.full((3, 4), 101325.125))
        with tempfile.TemporaryDirectory() as directory:
            item = write_field(Path(directory), 'pressure', metadata, values, missing)
            self.assertEqual(item['field'], metadata['field'])
            self.assertEqual(item['data_variable'], 'values')
            self.assertEqual(check_field(Path(directory), item, values, missing)['zarr_max_abs_error'], 0)
            from publication.native_display import render, metadata as describe, portrayal
            self.assertEqual(len(render(Path(directory),item,0,0)),332820)
            description=json.loads(describe(Path(directory),item))
            self.assertEqual(description['units'],'Pa')
            self.assertEqual(description['contract'],'hmc-native-display/3')
            image=Image.open(io.BytesIO(portrayal(Path(directory),item,0,0))).convert('RGBA')
            self.assertEqual(image.size,(258,258))
            self.assertEqual(np.asarray(image)[1,1,3],255)
            self.assertEqual(np.asarray(image)[0,0,3],0)

    def test_accumulation_keeps_interval_and_differs_from_instant(self):
        metadata = field_metadata(field_frame(1, 8, 'accum'), 1, sample_inventory=False, all_fields=True)
        self.assertEqual(metadata['valid_time'], '2026-10-21T12:00:00Z')
        self.assertEqual(metadata['interval']['start'], '2026-10-21T06:00:00Z')
        self.assertEqual(metadata['interval']['end'], '2026-10-21T12:00:00Z')
        self.assertEqual(metadata['interval']['statistical_process'], 1)
        instant = field_metadata(field_frame(1, 8), 1, sample_inventory=False, all_fields=True)
        self.assertNotEqual(metadata['field'], instant['field'])

    def test_unknown_parameter_is_preserved_without_invented_units(self):
        metadata=field_metadata(field_frame(191,192),1,sample_inventory=False,all_fields=True)
        self.assertEqual(metadata['raw_identity']['parameterCategory'],191)
        self.assertEqual(metadata['raw_identity']['parameterNumber'],192)
        self.assertEqual(metadata['identity']['units'],'unknown')

    def test_wind_orientation_is_explicit(self):
        metadata=field_metadata(field_frame(2,2),1,sample_inventory=False,all_fields=True)
        self.assertEqual(metadata['identity']['units'],'m s**-1')
        self.assertIsInstance(metadata['identity']['uv_relative_to_grid'],bool)


if __name__ == '__main__':
    unittest.main()
