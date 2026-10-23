"""End-to-end six-template fixtures through the real publication/API/GIS seam."""
import json
import os
import unittest
import uuid
from pathlib import Path

import eccodes as ec
import numpy as np
import requests


@unittest.skipUnless(os.environ.get('GRIB_CRS_HTTP')=='1','requires isolated CRS publication services')
class PublishedGribCRS(unittest.TestCase):
    def test_missing_configuration_blocks_new_jobs_but_preserves_reads(self):
        import tempfile
        from unittest.mock import patch
        from decoder import grib_crs
        from publication import numerical
        from publication.domain import database
        from publication.worker import submit
        catalogue=requests.get('http://gateway:8000/api/v1/catalogue',timeout=90).json()
        chosen=next(s for s in catalogue['selections'] if s['fixture']=='actual')
        listing=requests.get('http://gateway:8000/ogc/collections',timeout=90)
        self.assertEqual(listing.status_code,200)
        self.assertTrue(all('source_crs' not in item for item in listing.json()['collections']))
        self.assertTrue(all('source_crs' not in item['source'] for item in listing.json()['collections']))
        detail=requests.get('http://gateway:8000/ogc/collections/'+chosen['selection'],timeout=90)
        self.assertEqual(detail.status_code,200)
        self.assertIn('configuration',detail.json()['source_crs'])
        with database() as cursor:
            cursor.execute('SELECT count(*) AS n FROM app.jobs')
            before=cursor.fetchone()['n']
        with tempfile.TemporaryDirectory() as directory,patch.object(grib_crs,'CONFIG',Path(directory)/'missing.json'):
            with self.assertRaisesRegex(ValueError,'config/grib-crs-defaults.json'):
                submit('2026-10-19T05:00:00Z',{'hours':[1],'fixture':'actual'})
            _,point=numerical.sample(chosen['selection'],chosen['run'],chosen['revision'],chosen['field'],
                chosen['valid_time'],'-23.5','29.5')
            self.assertIsNotNone(point['value'])
        with database() as cursor:
            cursor.execute('SELECT count(*) AS n FROM app.jobs')
            self.assertEqual(cursor.fetchone()['n'],before)

    def test_six_templates_keep_native_cells_and_publish_correct_geometry(self):
        from test_grib_crs import section
        from decoder.inspect_forecast import sections
        from decoder.storage import bounded_frames
        from decoder.grib_crs import transform,configuration
        from publication.domain import ROOT,database,resolve
        from publication import revisions
        from publication.worker import submit,once
        original=next(bounded_frames(Path('/input/ICON_EU_T_G_2026101500.grib2')))
        parts=sections(original)
        results=[]
        for template in (0,1,10,20,30,31):
            with self.subTest(template=template):
                body=b''.join(bytes(section(template)) if number==3 else part for number,part in parts.items())
                frame=bytearray(original[:16]+body+b'7777');frame[8:16]=len(frame).to_bytes(8,'big')
                handle=ec.codes_new_from_message(bytes(frame))
                try:
                    ec.codes_set(handle,'packingType','grid_simple')
                    ec.codes_set_long(handle,'dataDate',20261016)
                    ec.codes_set_values(handle,np.arange(12,dtype=float)+280)
                    binary=ec.codes_get_message(handle)
                finally:ec.codes_release(handle)
                request={'crs_configuration':configuration(),'hours':[1],'fixture':'actual','recoverable':True,
                         'source_profile':'surface-temperature-grib2','fixture_label':'synthetic-crs'}
                identifier=submit('2026-10-19T05:00:00Z',request)
                directory=ROOT/identifier;directory.mkdir()
                source=directory/'original.grib2';source.write_bytes(binary)
                import hashlib
                with database() as cursor:
                    cursor.execute('UPDATE app.jobs SET source_name=%s,checksum=%s,managed_source=%s WHERE id=%s',
                        (f'synthetic-template-{template}.grb',hashlib.sha256(binary).hexdigest(),
                         source.relative_to(ROOT).as_posix(),identifier))
                self.assertTrue(once(identifier))
                with database() as cursor:
                    cursor.execute('SELECT * FROM app.jobs WHERE id=%s',(identifier,))
                    job=cursor.fetchone()
                self.assertEqual(job['state'],'published')
                manifest=resolve(job['selection'])
                from publication.domain import sampler
                numerical=sampler(manifest)
                selection=manifest['selection'];spec=manifest['source']['source_crs']
                item=numerical.manifest['fields'][0];grid=item['metadata']['grid']
                w,s,_,_=grid['outer_cell_edges_wsen'];dx,dy=grid['spacing_degrees_xy']
                x,y=w+1.5*dx,s+1.5*dy
                lon,lat=transform(spec,x,y,inverse=True)
                query={k:manifest['identity'][k] for k in ('run','revision','valid_time')}
                query.update(selection=selection,layer=item['field'],lon=float(lon),lat=float(lat),
                             crs='http://www.opengis.net/def/crs/OGC/1.3/CRS84')
                response=requests.get('http://gateway:8000/api/v1/point',params=query,timeout=90)
                self.assertEqual(response.status_code,200,response.text[:200])
                point=response.json();self.assertEqual(point['value'],285)
                description=requests.get('http://gateway:8000/ogc/collections/'+selection,timeout=90)
                self.assertEqual(description.status_code,200,description.text[:200])
                self.assertEqual(description.json()['source_crs'],spec)
                response=requests.get('http://gateway:8000/api/v1/selections/'+selection+'/display/2/native.json',timeout=90)
                self.assertEqual(response.status_code,200,response.text[:200])
                native=response.json();self.assertEqual(native['source_crs'],spec)
                protected=requests.get('http://gateway:8000/org/api/v1/selections/'+selection+'/display/2/native.json',timeout=90)
                self.assertEqual(protected.status_code,401)
                response=requests.get('http://gateway:8000'+native['url'].replace('{column}','0').replace('{row}','0'),timeout=90)
                self.assertEqual(response.status_code,200,response.text[:200])
                self.assertEqual(len(response.content),332820)
                values=np.frombuffer(response.content[:258*258*4],dtype='<f4').reshape(258,258)
                self.assertEqual(values[2,2],285)
                tile=requests.get('http://gateway:8000/api/v1/selections/'+selection+'/tiles.json',timeout=90)
                self.assertEqual(tile.status_code,200,tile.text[:200])
                self.assertEqual(tile.json()['contract'],'hmc-temperature-tile/3')
                edr={k:query[k] for k in ('run','revision','crs')}
                edr.update(coords=f'POINT({float(lon)} {float(lat)})',datetime=query['valid_time'],**{'parameter-name':'T_G'})
                coverage=requests.get('http://gateway:8000/ogc/collections/'+selection+'/position',params=edr,timeout=90)
                self.assertEqual(coverage.status_code,200,coverage.text[:200])
                self.assertEqual(coverage.json()['ranges']['T_G']['values'],[285])
                results.append({'template':template,'selection':selection,'point':point,'gis_checks':manifest['gis_checks'],
                                'gis_derivative':manifest['gis'].get('derivative'),
                                'gis_probe':{'position':list(map(float,transform(spec,manifest['gis']['probe']['lon'],manifest['gis']['probe']['lat'],inverse=True))),
                                             'value':manifest['gis']['probe']['value']}})
        Path('/evidence/six-template-http.json').write_text(json.dumps({'status':'passed','cases':results},indent=2)+'\n')
