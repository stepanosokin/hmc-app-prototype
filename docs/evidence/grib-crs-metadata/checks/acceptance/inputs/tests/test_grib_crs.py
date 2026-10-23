"""CRS metadata, standard codes and independent spherical rotation checks."""
import copy
import math
import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np
import eccodes as ec
from pyproj import CRS, Transformer

from decoder import grib_crs as crs


def section(template=0, earth_code=6):
    size = {0:72, 1:84, 10:72, 20:65, 30:81, 31:81}[template]
    raw = bytearray(size)
    raw[:4] = size.to_bytes(4, 'big')
    raw[4] = 3
    raw[6:10] = (12).to_bytes(4, 'big')
    raw[12:14] = template.to_bytes(2, 'big')
    raw[14] = earth_code
    raw[15:30] = b'\xff'*15
    put(raw,30,4)
    put(raw,34,3)
    if template in (0,1):
        put(raw,42,0xffffffff)
        angle(raw,46,-1)
        angle(raw,50,-2)
        angle(raw,55,1)
        angle(raw,59,1)
        put(raw,63,1000000)
        put(raw,67,1000000)
        raw[71] = 64
        if template == 1:
            angle(raw,72,-25)
            angle(raw,76,90)
            raw[80:84] = struct.pack('>f',0)
    else:
        angle(raw,38,40)
        angle(raw,42,10)
        angle(raw,47,60 if template==20 else 40)
        if template==10:
            raw[59] = 64
            put(raw,64,6000000)
            put(raw,68,6000000)
        else:
            angle(raw,51,10)
            put(raw,55,6000000)
            put(raw,59,6000000)
            raw[64] = 64
            if template in (30,31):
                angle(raw,65,30)
                angle(raw,69,60)
                angle(raw,73,-90)
                angle(raw,77,0)
    return raw


def put(raw,offset,value):
    raw[offset:offset+4] = int(value).to_bytes(4,'big')


def angle(raw,offset,value):
    put(raw,offset,round(abs(value)*1e6) | (0x80000000 if value<0 else 0))


class GribCRS(unittest.TestCase):
    def test_standard_earth_codes_override_defaults(self):
        config=crs.configuration()
        config['values']['earth_radius_m']=6500000
        for code,radius in [(0,6367470),(6,6371229),(8,6371200)]:
            value=crs.resolve(section(earth_code=code),config)
            self.assertEqual(value['semi_major_m'],radius)
            self.assertNotIn('earth_radius_m',value['defaults_used'])
        value=crs.resolve(section(earth_code=255),config)
        self.assertEqual(value['semi_major_m'],6500000)
        self.assertIn('earth_radius_m',value['defaults_used'])
        missing_radius=crs.resolve(section(earth_code=1),config)
        self.assertEqual(missing_radius['semi_major_m'],6500000)
        self.assertIn('earth_radius_m',missing_radius['defaults_used'])

    def test_missing_required_projection_and_corrupt_config_fail(self):
        raw=section(1)
        put(raw,72,0xffffffff)
        with self.assertRaisesRegex(ValueError,'обязательный'):
            crs.resolve(raw)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'defaults.json'
            with self.assertRaises(ValueError):crs.configuration(path)
            path.write_text('{}')
            with self.assertRaises(ValueError):crs.configuration(path)

    def test_explicit_scaled_earth_axes_and_ellipsoid_codes(self):
        raw=section(earth_code=1);raw[15]=0;put(raw,16,6400000)
        self.assertEqual(crs.resolve(raw)['semi_major_m'],6400000)
        for code in (3,7):
            raw=section(earth_code=code);raw[20]=3 if code==3 else 0;raw[25]=raw[20]
            put(raw,21,6378137);put(raw,26,6356752)
            spec=crs.resolve(raw)
            self.assertAlmostEqual(spec['semi_major_m'],6378137)
            self.assertAlmostEqual(spec['semi_minor_m'],6356752)
        for code in (2,4,5):
            spec=crs.resolve(section(earth_code=code))
            self.assertGreater(spec['semi_major_m'],spec['semi_minor_m'])

    def test_nonzero_configured_geodetic_parameters_roundtrip(self):
        config=crs.configuration()
        config['values'].update(prime_meridian_degrees=10,
            geocentric_translation_m=[100,-200,50],coordinate_height_m=100)
        for template in (0,1,10,20,30,31):
            spec=crs.resolve(section(template,4),config)
            x,y=crs.transform(spec,20.,50.)
            lon,lat=crs.transform(spec,x,y,inverse=True)
            self.assertAlmostEqual(float(lon),20,places=8)
            self.assertAlmostEqual(float(lat),50,places=8)

    def test_wgs84_horizontal_datum_overrides_geodetic_defaults(self):
        config=crs.configuration()
        config['values'].update(prime_meridian_degrees=10,geocentric_translation_m=[100,200,300])
        for code in (5,8):
            spec=crs.resolve(section(earth_code=code),config)
            self.assertEqual(spec['prime_meridian_degrees'],0)
            self.assertNotIn('geocentric_translation_m',spec['defaults_used'])
            x,y=crs.transform(spec,20,50)
            self.assertAlmostEqual(float(x),20,places=10)
            self.assertAlmostEqual(float(y),50,places=10)

    def test_projection_units_and_geographic_control_point(self):
        for template in (10,20,30,31):
            with self.subTest(template=template):
                result=crs.resolve(section(template))
                self.assertEqual(result['grid']['spacing_xy'],[6000,6000])
                west,south,_,_=result['grid']['outer_edges_wsen']
                x,y=west+3000,south+3000
                # Native sphere -> WGS84 uses the documented geocentric ray.
                expected_lat=math.degrees(math.atan2(math.sin(math.radians(40)),
                    (1-0.0066943799901413165)*math.cos(math.radians(40))))
                lon,lat=crs.transform(result,x,y,inverse=True)
                self.assertAlmostEqual(float(lon),10,places=9)
                self.assertAlmostEqual(float(lat),expected_lat,places=8)
                xx,yy=crs.transform(result,lon,lat)
                self.assertAlmostEqual(float(xx),x,places=5)
                self.assertAlmostEqual(float(yy),y,places=5)

    def test_rotation_against_independent_cartesian_basis(self):
        result=crs.resolve(section(1))
        # Projection's southern pole is at (-25,90); geographic coordinates of
        # the native north pole are consequently (25,-90).
        lon,lat=crs.transform(result,0.,90.,inverse=True)
        expected_lat=math.degrees(math.atan2(math.sin(math.radians(25)),
            (1-0.0066943799901413165)*math.cos(math.radians(25))))
        self.assertAlmostEqual(float(lon),-90,places=8)
        self.assertAlmostEqual(float(lat),expected_lat,places=8)
        p=math.radians(25)
        for longitude,latitude in [(-60,-30),(0,0),(59.94,29.94)]:
            l,r=math.radians(longitude),math.radians(latitude)
            geographic_lon=90+math.degrees(math.atan2(math.cos(r)*math.sin(l),
                math.sin(p)*math.cos(r)*math.cos(l)-math.cos(p)*math.sin(r)))
            geographic_lat=math.asin(math.sin(p)*math.sin(r)+math.cos(p)*math.cos(r)*math.cos(l))
            wgs_lat=math.degrees(math.atan2(math.sin(geographic_lat),
                (1-.0066943799901413165)*math.cos(geographic_lat)))
            lon,lat=crs.transform(result,longitude,latitude,inverse=True)
            self.assertAlmostEqual((float(lon)-geographic_lon+180)%360-180,0,places=9)
            self.assertAlmostEqual(float(lat),wgs_lat,places=9)
            xx,yy=crs.transform(result,lon,lat)
            self.assertAlmostEqual(float(xx),longitude,places=9)
            self.assertAlmostEqual(float(yy),latitude,places=9)

    def test_configuration_is_frozen_in_resolved_crs(self):
        a=crs.resolve(section())
        b=copy.deepcopy(a)
        config=crs.configuration()
        config['values']['prime_meridian_degrees']=10
        c=crs.resolve(section(),config)
        self.assertEqual(a,b)
        self.assertNotEqual(a['id'],c['id'])
        config=crs.configuration()
        frozen=crs.resolve(section(),config)
        config['values']['coordinate_height_m']=123
        self.assertEqual(frozen['configuration']['values']['coordinate_height_m'],0)

    def test_real_grib_messages_storage_and_native_cells_all_templates(self):
        from decoder.inspect_forecast import sections
        from decoder.storage import bounded_frames,field_metadata,decoded_arrays,write_field,check_field
        from publication.native_display import metadata as display_metadata,render
        original=next(bounded_frames(Path('/input/ICON_EU_T_G_2026101500.grib2')))
        parts=sections(original)
        for template in (0,1,10,20,30,31):
            with self.subTest(template=template),tempfile.TemporaryDirectory() as directory:
                body=b''.join(bytes(section(template)) if number==3 else part for number,part in parts.items())
                frame=bytearray(original[:16]+body+b'7777')
                frame[8:16]=len(frame).to_bytes(8,'big')
                handle=ec.codes_new_from_message(bytes(frame))
                try:
                    ec.codes_set_values(handle,np.arange(12,dtype=float)+280)
                    binary=ec.codes_get_message(handle)
                finally:ec.codes_release(handle)
                parsed=field_metadata(binary,1)
                self.assertEqual(parsed['source_crs']['template'],template)
                values,missing=decoded_arrays(binary,[3,4])
                np.testing.assert_array_equal(values,np.arange(12).reshape(3,4)+280)
                root=Path(directory)
                item=write_field(root,'field',parsed,values,missing)
                check_field(root,item,values,missing)
                description=__import__('json').loads(display_metadata(root,item))
                self.assertEqual(description['contract'],'hmc-native-display/2')
                self.assertEqual(len(render(root,item,0,0)),332820)

    def test_producer_rotated_ena_metadata(self):
        from decoder.storage import bounded_frames
        from decoder.inspect_forecast import sections
        source=Path('/input/test/igfi00000000s.ENA6km.grb')
        if not source.exists():self.skipTest('Private ENA rotation sample is not mounted')
        frame=next(bounded_frames(source))
        spec=crs.resolve(sections(frame)[3])
        self.assertEqual(spec['rotation'],{'south_lat':-25,'south_lon':90,'angle':0})
        handle=ec.codes_new_from_message(frame)
        try:
            # ecCodes uses the geographic reference sphere, without our explicit
            # WGS84 datum assumption; compare rotation before the Cartesian bridge.
            lons=ec.codes_get_array(handle,'longitudes')
            lats=ec.codes_get_array(handle,'latitudes')
            grid=spec['grid'];ny,nx=grid['shape_yx'];w,s,_,_=grid['outer_edges_wsen'];dx,dy=grid['spacing_xy']
            inverse=Transformer.from_crs(CRS.from_proj4(spec['proj']),CRS.from_proj4('+proj=longlat +R=6371229'),always_xy=True)
            for i in (0,nx-1,(ny//2)*nx+nx//2,nx*ny-1):
                lon,lat=inverse.transform(w+(i%nx+.5)*dx,s+(i//nx+.5)*dy)
                # ecCodes unrotate explicitly calls roundf(angle*1e6)/1e6:
                # float32 narrowing loses several microdegrees for large angles.
                # Reproduce that documented oracle quantization, not its error
                # in the operative CRS. Independent math below stays double.
                def rounded(value):
                    narrow=float(np.float32(value*1e6))
                    return math.copysign(math.floor(abs(narrow)+.5),narrow)/1e6
                self.assertAlmostEqual((rounded(lon)-lons[i]+180)%360-180,0,places=6)
                self.assertAlmostEqual(rounded(lat),lats[i],places=6)
        finally:ec.codes_release(handle)

    def test_non_inventory_surface_message_reads_producer_date_and_packing(self):
        from decoder.storage import bounded_frames,field_metadata
        path=Path('/input/test/igfi00000000s.ENA6km.grb')
        if not path.exists():self.skipTest('Private ENA sample is not mounted')
        frame=next(frame for index,frame in enumerate(bounded_frames(path),1) if index==7)
        metadata=field_metadata(frame,1,sample_inventory=False)
        self.assertEqual(metadata['reference_time'],'2026-10-21T06:00:00Z')
        self.assertEqual(metadata['valid_time'],metadata['reference_time'])
        self.assertEqual(metadata['lead_hours'],0)
        self.assertEqual(metadata['identity']['packingType'],'grid_simple')
        self.assertEqual(metadata['source_crs']['template'],1)


if __name__=='__main__':unittest.main()
