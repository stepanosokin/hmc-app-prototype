import json
from pathlib import Path
from publication import revisions
from publication.domain import database,sampler
from decoder.grib_crs import configuration

report=json.loads(Path('/evidence/reload-grib.json').read_text())
assert report['state']=='passed' and len(report['files'])==1
delivery=report['files'][0]
assert delivery['state']=='published'
with database() as cursor:
    cursor.execute('SELECT manifest_path,manifest_sha256 FROM app.revisions WHERE revision=%s',(delivery['revision'],))
    row=cursor.fetchone()
revision=revisions.load_revision(row['manifest_path'],row['manifest_sha256'])
assert len(revision['batches'])==24
times=[]
for entry in revision['batches']:
    manifest=revisions.selected(revision,entry)
    reader=sampler(manifest)
    field=reader.manifest['fields'][0]
    assert field['metadata']['source_crs']['configuration']==configuration()
    assert reader.manifest['source']['sha256']==delivery['sha256']
    times.append(field['metadata']['valid_time'])
assert len(set(times))==24
result={'status':'passed','revision':delivery['revision'],'retained_times':sorted(times),
        'verified_numerical_asset_inventories':24,'frozen_crs_matches_configuration':True}
Path('/evidence/pre-switch-integrity.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({key:value for key,value in result.items() if key!='retained_times'}))
