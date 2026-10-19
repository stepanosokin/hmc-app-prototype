"""The agreed gateway seam, with real worker/PostGIS/GeoServer services."""

import os
import json
import re
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

import requests

from publication.tiles import decode, MAP_TO_NATIVE


@unittest.skipUnless(os.environ.get('T4_HTTP') == '1', 'run in isolated T4 Compose after publication')
class PublishedSelection(unittest.TestCase):
    base = 'http://gateway:8000'

    def test_catalogue_point_numeric_tile_and_scoped_wms_agree(self):
        selections = requests.get(self.base+'/api/v1/catalogue',timeout=90).json()['selections']
        self.assertGreaterEqual(len(selections),1)
        selected=selections[0]
        query={key:selected[key] for key in ('selection','run','revision','valid_time')}
        query.update(layer=selected['field'],lon=-23.5,lat=29.5)
        point=requests.get(self.base+'/api/v1/point',params=query,timeout=90)
        self.assertEqual(point.status_code,200,point.text)
        self.assertEqual(point.json()['value'],298.2274169921875)
        self.assertEqual(point.json()['selection'],selected['selection'])
        query['valid_time']='1900-01-01T00:00:00Z'
        self.assertEqual(requests.get(self.base+'/api/v1/point',params=query,timeout=90).status_code,404)
        metadata=requests.get(self.base+selected['tiles'],timeout=90).json()
        self.assertEqual(metadata['identity']['valid_time'],selected['valid_time'])
        url=metadata['url'].replace('{z}','3').replace('{x}','4').replace('{y}','2')
        first=requests.get(self.base+url,timeout=90)
        second=requests.get(self.base+url,timeout=90)
        self.assertEqual(first.status_code,200)
        self.assertEqual(first.content,second.content)
        values,mask=decode(first.content,'f32')
        self.assertEqual(values.shape,(258,258))
        self.assertGreater(int(mask.sum()),0)
        params={'SERVICE':'WMS','VERSION':'1.3.0','REQUEST':'GetCapabilities'}
        capabilities=requests.get(self.base+selected['wms'],params=params,timeout=90)
        self.assertEqual(capabilities.status_code,200,capabilities.text)
        self.assertFalse('geoserver:8080' in capabilities.text,'private address leaked in capabilities')
        root=ET.fromstring(capabilities.content)
        times=[node.text or '' for node in root.findall('.//{*}Dimension') if node.get('name')=='time']
        self.assertEqual([time.replace('.000Z','Z') for time in times],[selected['valid_time']])
        for crs,bbox in [('EPSG:3857','-1000000,5000000,3000000,9000000'),
                         ('EPSG:4326','29,-24,71,63')]:
            params.update(REQUEST='GetMap',LAYERS='temperature',TIME=selected['valid_time'],
                          CRS=crs,BBOX=bbox,WIDTH='64',HEIGHT='64',FORMAT='image/png',STYLES='')
            image=requests.get(self.base+selected['wms'],params=params,timeout=90)
            self.assertEqual(image.status_code,200,image.text[:100])
            self.assertTrue(image.content.startswith(b'\x89PNG'))
        params['TIME']='1900-01-01T00:00:00Z'
        self.assertEqual(requests.get(self.base+selected['wms'],params=params,timeout=90).status_code,404)
        # A full-resolution identify pixel centred on a known native cell.
        # The reverse of the documented operation maps the native cell to WMS.
        mx,my,_=MAP_TO_NATIVE.transform(20.,50.,0.,direction='INVERSE')
        query.update(valid_time=selected['valid_time'],lon=20,lat=50)
        native=requests.get(self.base+'/api/v1/point',params=query,timeout=90).json()['value']
        params.update(REQUEST='GetFeatureInfo',TIME=selected['valid_time'],CRS='EPSG:3857',
                      BBOX=f'{mx-150},{my-150},{mx+150},{my+150}',WIDTH='3',HEIGHT='3',
                      QUERY_LAYERS='temperature',INFO_FORMAT='text/plain',I='1',J='1')
        identified=requests.get(self.base+selected['wms'],params=params,timeout=90)
        self.assertEqual(identified.status_code,200,identified.text[:300])
        match=re.search(r'GRAY_INDEX\s*=\s*([0-9.eE+-]+)',identified.text)
        self.assertIsNotNone(match,identified.text)
        assert match is not None
        self.assertAlmostEqual(float(match.group(1)),native,delta=0.0001)

    def test_staging_backend_admin_and_unpublished_selection_are_hidden(self):
        for path in ['/geoserver/rest','/geoserver/web','/assets/comparison/manifest.json',
                     '/staging','/api/v1/selections/'+'0'*64+'/tiles.json']:
            self.assertEqual(requests.get(self.base+path,timeout=90).status_code,404,path)

    @unittest.skipUnless(Path('/evidence/job-cases.json').exists(),'failure runner supplies durable job IDs')
    def test_failed_readiness_and_real_indexing_preserve_published_selection(self):
        cases=json.loads(Path('/evidence/job-cases.json').read_bytes())
        selections=requests.get(self.base+'/api/v1/catalogue',timeout=90).json()['selections']
        ids={item['selection'] for item in selections}
        self.assertEqual(ids,set(cases['published_selections']))
        for name in ('tiles','index'):
            job=requests.get(self.base+'/api/v1/jobs/'+cases[name],timeout=90).json()
            self.assertEqual(job['state'],'failed',job)
            self.assertIsNone(job['selection'])
            self.assertNotIn('published',[item['state'] for item in job['history']])
        job=requests.get(self.base+'/api/v1/jobs/'+cases['actual'],timeout=90).json()
        self.assertEqual([entry['state'] for entry in job['history']],
                         ['discovered','staged','decoded','normalized','derivatives_ready','validated','published'])
        self.assertEqual(job['checksum'],'dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a')


if __name__=='__main__':
    unittest.main()
