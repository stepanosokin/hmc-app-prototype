"""Public cache observations: bounded state, cold failures and warm retained reads."""

import unittest
import os
import io

import numpy as np
import requests
from PIL import Image

from publication.tile_cache import TileCache
from publication.domain import PublicationUnavailable,database


class Diagnostics(unittest.TestCase):
    def test_portrayal_cache_is_bounded_separate_from_numeric_and_counts_generation(self):
        cache=TileCache(cap=332820);image=b'\x89PNG\r\n\x1a\n'+bytes(20)
        self.assertEqual(cache.lookup(('a','image'),lambda:image,image=True),(image,'miss'))
        self.assertEqual(cache.lookup(('a','image'),lambda:self.fail('warm image regenerated'),image=True),(image,'hit'))
        with self.assertRaises(PublicationUnavailable):cache.lookup(('b','numeric'),lambda:image)
        with self.assertRaises(PublicationUnavailable):cache.lookup(('c','image'),lambda:bytes(332820),image=True)
        report=cache.snapshot()
        self.assertEqual(report['image_generation_attempts'],2)
        self.assertEqual(report['image_miss'],1);self.assertEqual(report['image_hit'],1)
        self.assertEqual(report['image_failure'],1)
        self.assertGreaterEqual(report['image_generation_duration_ms'],0)
        self.assertEqual(report['bytes'],len(image));self.assertLessEqual(report['bytes'],report['budget_bytes'])

    @unittest.skipUnless(os.environ.get('T19_HTTP')=='1','requires isolated T19 actual-sample gateway')
    def test_real_portrayal_and_numeric_blocks_share_mask_and_cache_separately(self):
        base='http://gateway:8000'
        response=requests.get(base+'/api/v1/catalogue',timeout=30);response.raise_for_status()
        selected=next(s for s in response.json()['selections'] if s['field']=='T_G:surface:0')
        stem=selected['native_display'].removesuffix('native.json')+'native/0/0.'
        numeric=requests.get(base+stem+'f32',timeout=30);numeric.raise_for_status()
        first=requests.get(base+stem+'png',timeout=30);first.raise_for_status()
        second=requests.get(base+stem+'png',timeout=30);second.raise_for_status()
        with database() as cursor:
            cursor.execute('SELECT cache FROM access.usage WHERE request_id=%s',(second.headers['X-Request-ID'],))
            self.assertEqual(cursor.fetchone()['cache'],'hit')
        self.assertEqual(first.content,second.content)
        self.assertEqual(first.headers['ETag'],second.headers['ETag'])
        image=np.asarray(Image.open(io.BytesIO(first.content)).convert('RGBA'))
        self.assertEqual(image.shape,(258,258,4))
        mask=np.frombuffer(numeric.content,dtype=np.uint8,offset=258*258*4).reshape(258,258)
        np.testing.assert_array_equal(image[:,:,3],mask*255)

    def test_cache_observations_preserve_retained_bytes_after_failed_generation(self):
        cache = TileCache(cap=332820)
        payload = bytes(332820)
        self.assertEqual(cache.get(('a',), lambda: payload), payload)
        self.assertEqual(cache.get(('a',), lambda: self.fail('warm cache regenerated')), payload)

        def broken():
            raise OSError('secret=must-never-be-retained')

        with self.assertRaises(PublicationUnavailable):
            cache.get(('b',), broken)
        report = cache.snapshot()
        self.assertEqual(report['numeric_miss'], 1)
        self.assertEqual(report['numeric_hit'], 1)
        self.assertEqual(report['numeric_failure'], 1)
        self.assertEqual(report['bytes'], 332820)
        self.assertEqual(report['entries'], 1)
        self.assertNotIn('secret', str(report))
        self.assertEqual(cache.get(('a',), broken), payload)


if __name__ == '__main__':
    unittest.main()
