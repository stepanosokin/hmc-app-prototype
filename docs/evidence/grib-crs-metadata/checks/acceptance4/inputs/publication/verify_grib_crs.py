"""Verify full rebuilt source, immutable CRS, native/EDR/GIS and old selection."""
import argparse
import json
import math
from pathlib import Path

import requests

from decoder.storage import bounded_frames,field_metadata,decoded_arrays,check_field
from decoder.sampling import file_hash
from publication import revisions
from publication.domain import database,sampler
from decoder.grib_crs import configuration


def get(path,**kwargs):
    result=requests.get('http://gateway:8000'+path,timeout=90,**kwargs)
    result.raise_for_status()
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--old-selection')
    parser.add_argument('--allow-rejected',action='store_true',help='Verify successful files in the explicit rejection scenario')
    args=parser.parse_args()
    report=json.loads(Path('/evidence/reload-grib.json').read_text())
    assert report['state']=='passed' or args.allow_rejected
    checks=[]
    for delivered in report['files']:
        if delivered['state']=='failed' and args.allow_rejected:
            continue
        assert delivered['state']=='published'
        with database() as cursor:
            cursor.execute('SELECT * FROM app.jobs WHERE id=%s',(delivered['job'],))
            job=cursor.fetchone()
            cursor.execute('SELECT count(*) AS n FROM app.revisions WHERE job_id=%s',(delivered['job'],))
            count=cursor.fetchone()['n']
        assert job['state']=='published' and count==24
        revision=revisions.latest('ICON-EU/2026-10-15T00:00:00Z')
        assert revision is not None
        assert revision['job']==delivered['job'] and len(revision['batches'])==24
        source=Path('/input')/delivered['source']
        assert file_hash(source)==delivered['sha256']
        for hour,frame in enumerate(bounded_frames(source),1):
            metadata=field_metadata(frame,hour,job['request']['crs_configuration'])
            entry=next(e for e in revision['batches'] if e['valid_time']==metadata['valid_time'])
            published=revisions.selected(revision,entry)
            reader=sampler(published);item=reader.manifest['fields'][0]
            assert item['metadata']['source_crs']==metadata['source_crs']==published['source']['source_crs']
            assert metadata['source_crs']['configuration']==report['configuration']==configuration()
            values,missing=decoded_arrays(frame,metadata['grid']['shape_yx'])
            check=check_field(reader.root,item,values,missing)
            for cell in metadata['grid']['cell_centres']:
                point=reader.sample(run=revision['run'],revision=reader.revision,field=item['field'],
                    valid_time=metadata['valid_time'],lon=cell['lon'],lat=cell['lat'])
                assert point['value']==cell['value']
            cell=metadata['grid']['cell_centres'][3]
            # Independent WGS84 geodetic angle for this native spherical ray.
            phi=math.radians(cell['lat'])
            lat=math.degrees(math.atan2(math.sin(phi),(1-.0066943799901413165)*math.cos(phi)))
            query=dict(selection=published['selection'],run=revision['run'],revision=revision['revision'],
                valid_time=metadata['valid_time'],layer=item['field'],lon=cell['lon'],lat=lat,
                crs='http://www.opengis.net/def/crs/OGC/1.3/CRS84')
            point=get('/api/v1/point',params=query).json()
            assert point['value']==cell['value'] and point['cell']=={k:cell[k] for k in ('row','column','lon','lat')}
            description=get('/ogc/collections/'+published['selection']).json()
            assert description['source_crs']==metadata['source_crs']
            edr={k:query[k] for k in ('run','revision','crs')}
            edr.update(coords=f'POINT({cell["lon"]} {lat})',datetime=metadata['valid_time'],**{'parameter-name':'T_G'})
            coverage=get('/ogc/collections/'+published['selection']+'/position',params=edr).json()
            assert coverage['ranges']['T_G']['values']==[cell['value']]
            check.update(selection=published['selection'],source_crs=metadata['source_crs']['id'],
                         gateway_point=point,edr_checked=True)
            checks.append(check)
    old_checked=None
    if args.old_selection:
        old=get('/ogc/collections/'+args.old_selection).json()
        assert old['storageCrs']=='urn:hmc:crs:icon-sphere-6371229'
        old_checked=args.old_selection
    result={'status':'passed','files':len(report['files']),'rejected_files':sum(f['state']=='failed' for f in report['files']),'new_times':len(checks),
            'native_cells_checked':sum(len(c['representative_cells']) for c in checks),
            'old_selection_retained':old_checked,'checks':checks}
    Path('/evidence/full-source-verification.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='checks'}))


if __name__=='__main__':main()
