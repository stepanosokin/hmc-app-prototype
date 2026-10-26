import unittest
from publication import catalogue


class FieldSurfaces(unittest.TestCase):
    def discovery(self, first_value=0, second='640000009c40', scale=0, first_type=100):
        return catalogue.discovery({'identity':{'model':'ENA','run':'ENA/run','field':'field','level':0,
            'valid_time':'2026-10-21T06:00:00Z','native_grid_sha256':'grid','member':None},
            'source':{'field_profile':'grib2-fields/1','field_descriptor':{'units':'%','label':'Облачность',
                'short_name':'ccl','level_type':'isobaricLayer','display_blocks':32,'interval':None,
                'raw_identity':{'typeOfFirstFixedSurface':first_type,'scaleFactorOfFirstFixedSurface':scale,
                    'scaledValueOfFirstFixedSurface':first_value,'second_surface_hex':second}}}})

    def test_actual_ena_cloud_layers_preserve_both_surface_bounds(self):
        for first,second,expected in [(0,'640000009c40',40000),(40000,'640000013880',80000),(80000,'010000000000',0)]:
            with self.subTest(first=first):
                surfaces=self.discovery(first,second)['field_surfaces']
                self.assertEqual(surfaces[0]['value'],first)
                self.assertEqual(surfaces[1]['value'],expected)
                self.assertEqual(surfaces[1]['type'],1 if first==80000 else 100)
        self.assertIn('field_surfaces',catalogue.DISCOVERY_KEYS,'Compact whitelist must retain the bounds')

    def test_sign_magnitude_scale_missing_and_unknown_surface_are_not_invented(self):
        first,second=self.discovery(12,'ffFFFFFFFFFF',129,241)['field_surfaces']
        self.assertEqual(first,{'type':241,'scale_factor':129,'scaled_value':12,'value':120})
        self.assertEqual(second,{'type':255,'scale_factor':255,'scaled_value':4294967295,'value':None})
        self.assertIsNone(self.discovery(12,scale=255)['field_surfaces'][0]['value'])
        self.assertIsNone(self.discovery(4294967295)['field_surfaces'][0]['value'])


if __name__=='__main__':unittest.main()
