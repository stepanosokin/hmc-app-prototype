"""Real gateway/cache eligibility checks, exclusively on a disposable stand."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
import uuid

import requests


@unittest.skipUnless(os.environ.get('PYRAMID_HTTP')=='1' and os.environ.get('T6_TEST_FAULTS')=='1', 'requires isolated pyramid stand')
class PublishedPyramid(unittest.TestCase):
    base='http://gateway:8000'

    def get(self,path,status=200,**kwargs):
        result=requests.get(self.base+path,timeout=30,**kwargs)
        self.assertEqual(result.status_code,status,result.text[:200] if result.status_code!=200 else '')
        return result

    def native_cache(self):
        result=requests.get('http://api:8000/ops/diagnostics',timeout=10)
        result.raise_for_status()
        return result.json()['native']

    def test_pyramid_gates_remain_before_cache_hits(self):
        from test_grib_fields import field_frame
        from publication.domain import ROOT,database,sampler,resolve
        from publication.worker import submit,once
        from publication import access,retention
        binary=field_frame(3,0)
        identifier=submit('2026-10-21T07:00:00Z',{'hours':[1],'fixture':'actual','recoverable':True,
            'source_profile':'grib2-fields','model':'PYRAMID-81-'+uuid.uuid4().hex[:8]})
        directory=ROOT/identifier;directory.mkdir();source=directory/'original.grib2';source.write_bytes(binary)
        with database() as cursor:
            cursor.execute('UPDATE app.jobs SET source_name=%s,checksum=%s,managed_source=%s WHERE id=%s',
                ('pyramid-fixture.grb',hashlib.sha256(binary).hexdigest(),source.relative_to(ROOT).as_posix(),identifier))
        self.assertTrue(once(identifier))
        with database() as cursor:
            cursor.execute('SELECT state,selection FROM app.jobs WHERE id=%s',(identifier,));job=cursor.fetchone()
        self.assertEqual(job['state'],'published')
        selected=next(s for s in self.get('/api/v1/catalogue').json()['selections'] if s['selection']==job['selection'])
        native=selected['native_display'];path=native.replace('/display/3/','/display/4/8/');block=path.replace('native.json','native/0/0.f32')
        original=self.get(native).json();derived=self.get(path).json()
        self.assertEqual(derived['identity'],original['identity']);self.assertEqual(derived['display_level'],8)
        before=self.native_cache();self.get(path);after=self.native_cache()
        self.assertGreater(after.get('metadata_hit',0),before.get('metadata_hit',0))
        payload=self.get(block).content;self.assertEqual(len(payload),332820)
        before=self.native_cache();self.get(block);after=self.native_cache()
        self.assertGreater(after.get('numeric_hit',0),before.get('numeric_hit',0))
        self.get(path,400,params={'unexpected':'1'});self.get(block.replace('/0/0.','/1/0.'),400)
        with tempfile.TemporaryDirectory() as temporary:
            key=Path(temporary)/'key';created=access.issue('pyramid-81-'+uuid.uuid4().hex[:8],'numeric',key)
            headers={'Authorization':'Bearer '+key.read_text().strip()}
            protected=self.get('/org'+path,headers=headers).json()
            self.assertEqual(protected['metadata_url'],'/org'+path);self.assertTrue(protected['url'].startswith('/org/'))
            warm=self.get('/org'+block,headers=headers)
            with database() as cursor:cursor.execute('UPDATE access.keys SET revoked_at=clock_timestamp() WHERE id=%s',(created['id'],))
            self.get('/org'+block,401,headers={**headers,'If-None-Match':warm.headers['ETag']})
        numerical=sampler(resolve(selected['selection']));item=numerical.manifest['fields'][0]
        chunk=next(p for p in (numerical.root/item['zarr']/item.get('data_variable','temperature')).iterdir() if p.name[0].isdigit())
        hidden=chunk.with_name(chunk.name+'.hidden');chunk.rename(hidden)
        try:self.get(block,503);self.get(path,503)
        finally:hidden.rename(chunk)
        self.assertEqual(self.get(block).content,payload)
        configuration,_,_=retention.snapshot()
        try:
            retention.configure({**configuration,'clock':'2026-11-10T00:00:00Z'})
            self.get(block,410);self.get(path,410)
        finally:retention.configure(configuration)
        self.assertEqual(self.get(block).content,payload)
        Path('/evidence/pyramid-http.json').write_text(json.dumps({'status':'passed','selection':selected['selection'],
            'checks':['cold/warm metadata and blocks','unchanged source identity','strict parameters/coordinates','organization prefix','revoked warm key','missing warm storage','expired warm selection','recovery']}))
