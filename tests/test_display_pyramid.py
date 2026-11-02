"""Independent numeric reference, uneven footprints, masks and tile seams."""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import zarr

from publication import display_pyramid as pyramid


class DisplayPyramid(unittest.TestCase):
    def test_overlap_means_masks_zero_padding_and_halos(self):
        ny, nx = 17, 1031
        values = (np.arange(ny*nx).reshape(ny, nx) % 101).astype(float)
        values[:, :8] = 0
        missing = np.zeros(values.shape, dtype=bool)
        missing[6, 513] = True
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            group = zarr.open_group(str(root/'field'), mode='w', zarr_format=2)
            group.create_array('values', data=values, chunks=(17, 256))
            group.create_array('missing', data=missing, chunks=(17, 256))
            item = {'zarr':'field', 'data_variable':'values', 'metadata':{'grid':{'shape_yx':[ny,nx]}, 'float32_abs_error_bound':.001}}
            for factor in (2, 4, 8):
                h, w = pyramid.shape(item, factor)
                blocks: list[tuple[np.ndarray,np.ndarray]] = []
                for col in range((w+255)//256):
                    payload = pyramid.render(root,item,factor,col,0)
                    data = np.frombuffer(payload[:258*258*4],dtype='<f4').reshape(258,258)
                    mask = np.frombuffer(payload[258*258*4:],dtype='uint8').reshape(258,258)
                    self.assertTrue(np.all(data[mask==0]==0))
                    if blocks:
                        np.testing.assert_array_equal(blocks[-1][0][:,-2:],data[:,:2])
                        np.testing.assert_array_equal(blocks[-1][1][:,-2:],mask[:,:2])
                    blocks.append((data,mask))
                for y in range(h):
                    for x in range(w):
                        x0,x1=x*nx/w,(x+1)*nx/w
                        y0,y1=y*ny/h,(y+1)*ny/h
                        weighted,total,valid=0.,0.,True
                        for yy in range(int(y0),int(np.ceil(y1))):
                            for xx in range(int(x0),int(np.ceil(x1))):
                                weight=max(0,min(xx+1,x1)-max(xx,x0))*max(0,min(yy+1,y1)-max(yy,y0))
                                if weight:
                                    valid &= not missing[yy,xx]
                                    weighted+=weight*values[yy,xx];total+=weight
                        data,mask=blocks[x//256]
                        self.assertEqual(bool(mask[y+1,x%256+1]),valid)
                        if valid:
                            self.assertAlmostEqual(float(data[y+1,x%256+1]),weighted/total,delta=max(1e-6,abs(weighted/total)*2e-7))
                with self.assertRaises(ValueError):pyramid.render(root,item,factor,len(blocks),0)

    def test_metadata_keeps_source_identity_and_does_not_claim_native_precision(self):
        from test_grib_fields import field_frame
        from decoder.storage import field_metadata,decoded_arrays,write_field
        frame=field_frame(3,0)
        metadata=field_metadata(frame,1,sample_inventory=False,all_fields=True)
        values,missing=decoded_arrays(frame,[3,4])
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);item=write_field(root,'pressure',metadata,values,missing)
            result=json.loads(pyramid.metadata(root,item,8))
            self.assertEqual(result['grid']['shape_yx'],[1,1])
            self.assertEqual(result['source_grid']['shape_yx'],[3,4])
            self.assertEqual(result['contract_sha256'],pyramid.CONTRACT_SHA256)
            self.assertEqual(result['display_level'],8)
            self.assertNotIn('encoding_max_abs_error',result)
            self.assertEqual(result['units'],'Pa')
            self.assertEqual(result['grid']['outer_cell_edges_wsen'],metadata['grid']['outer_cell_edges_wsen'])
            self.assertIn('/display/4/8/',result['url_template'])
            with self.assertRaises(ValueError):pyramid.metadata(root,item,3)
