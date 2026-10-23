import json
import sys
from pathlib import Path
import requests
from publication.domain import database

mode=sys.argv[1]
assert mode in ('before','after')
report=json.loads(Path('/evidence/reload-grib.json').read_text())
job=next(item['job'] for item in report['files'] if item['state']=='published')
with database() as cursor:
    cursor.execute("SELECT root,expired_at FROM app.retention_roots WHERE reason='batch-intermediate' AND root IN (SELECT revision FROM app.revisions WHERE job_id=%s)",(job,))
    saved=cursor.fetchall()
    assert len(saved)==23
    for row in saved:cursor.execute('UPDATE app.retention_roots SET expired_at=NULL WHERE root=%s',(row['root'],))
try:
    upstream=requests.get('http://api:8000/ogc/collections',timeout=90)
    public=requests.get('http://gateway:8000/ogc/collections',timeout=90)
    result={'mode':mode,'upstream_status':upstream.status_code,'upstream_bytes':len(upstream.content),
            'gateway_status':public.status_code,'gateway_bytes':len(public.content),
            'collections':len(upstream.json()['collections']),'temporary_retention_roots':len(saved)}
    assert upstream.status_code==200
    assert public.status_code==(200 if len(upstream.content)<=4*1024**2 else 413),result
    if mode=='after':assert len(upstream.content)<3700000,result
    if mode=='after':
        assert all('source_crs' not in item for item in public.json()['collections'])
        assert all('source_crs' not in item['source'] for item in public.json()['collections'])
        selection=public.json()['collections'][0]['id']
        detail=requests.get('http://gateway:8000/ogc/collections/'+selection,timeout=90)
        assert detail.status_code==200 and detail.json()['source_crs']['configuration']
        result['individual_crs_preserved']=True
finally:
    with database() as cursor:
        for row in saved:cursor.execute('UPDATE app.retention_roots SET expired_at=%s WHERE root=%s',(row['expired_at'],row['root']))
    with database() as cursor:
        cursor.execute("SELECT root,expired_at FROM app.retention_roots WHERE reason='batch-intermediate' AND root IN (SELECT revision FROM app.revisions WHERE job_id=%s)",(job,))
        assert {r['root']:r['expired_at'] for r in cursor.fetchall()}=={r['root']:r['expired_at'] for r in saved}
result['retention_restored']=True
Path('/evidence/discovery-'+mode+'.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
