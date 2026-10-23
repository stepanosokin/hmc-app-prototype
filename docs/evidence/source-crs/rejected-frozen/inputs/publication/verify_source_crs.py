"""Read back all reloaded sources/times through the real gateway, including CRS84."""

import json
import sys
from pathlib import Path

import requests
import numpy as np

from decoder.source_crs import LEGACY_ID, to_wgs84
from decoder.storage import bounded_frames, decoded_arrays
from publication.domain import ROOT, database, resolve, sampler
from publication.verify_revisions import ready
from publication import geoserver

BASE = 'http://gateway:8000'


def main():
    ready()
    directory = Path('/evidence')
    jobs = json.loads((directory/sys.argv[1]).read_text(encoding='utf-8-sig'))
    jobs = jobs if isinstance(jobs,list) else [jobs]
    results = []
    for entry in jobs:
        with database() as cursor:
            cursor.execute('SELECT state,selection,request FROM app.jobs WHERE id=%s',(entry['job'],))
            job = cursor.fetchone()
        if job is None or job['state'] != 'published':
            raise ValueError('Reload job is not published')
        manifest = resolve(job['selection'])
        numerical = sampler(manifest)
        metadata = numerical.manifest['fields'][0]['metadata']
        if metadata['source_crs'] != job['request']['source_crs']:
            raise ValueError('Published CRS differs from submitted snapshot')
        catalogue = requests.get(BASE+'/api/v1/catalogue',timeout=90)
        catalogue.raise_for_status()
        times = [item for item in catalogue.json()['selections'] if item['revision']==manifest['identity']['revision']]
        if len(times)!=24 or len({item['valid_time'] for item in times})!=24:
            raise ValueError('Reload must publish all 24 actual source times')
        times.sort(key=lambda item:item['valid_time'])
        points = []
        for selection in times:
            selected = resolve(selection['selection'])
            native = sampler(selected)
            item = native.manifest['fields'][0]
            for cell in item['metadata']['grid']['cell_centres']:
                lon,lat = to_wgs84(cell['lon'],cell['lat'],item['metadata'])
                query = {key:selection[key] for key in ('selection','run','revision','valid_time')}
                query.update(layer=selection['field'],lon=lon,lat=lat,crs='http://www.opengis.net/def/crs/OGC/1.3/CRS84')
                response = requests.get(BASE+'/api/v1/point',params=query,timeout=90)
                response.raise_for_status()
                point = response.json()
                if point['cell']['row']!=cell['row'] or point['cell']['column']!=cell['column'] or point['value']!=cell['value']:
                    raise ValueError('CRS84 point differs from native decoded value')
                points.append({'time':selection['valid_time'],'cell':[cell['row'],cell['column']],'value_K':point['value']})
        native_metadata = requests.get(BASE+times[0]['native_display'],timeout=90)
        native_metadata.raise_for_status()
        expected = 'hmc-native-display/2' if metadata['source_crs']['id']!=LEGACY_ID else 'hmc-native-display/1'
        if native_metadata.json()['contract']!=expected:
            raise ValueError('Native contract does not match source CRS')
        descriptor=native_metadata.json()
        raw_values,raw_missing=decoded_arrays(next(bounded_frames(ROOT/entry['job']/'original.grib2')),[657,1377])
        # first published time is +1 h; check every transported native cell,
        # including padding and overlapping halos, independently of the renderer.
        block_checks=[]
        for block_row in range(3):
            for block_column in range(6):
                url=descriptor['url'].replace('{column}',str(block_column)).replace('{row}',str(block_row))
                response=requests.get(BASE+url,timeout=90);response.raise_for_status()
                body=response.content
                if len(body)!=258*258*5:raise ValueError('Native block length changed')
                values=np.frombuffer(body[:258*258*4],dtype='<f4').reshape(258,258)
                mask=np.frombuffer(body[258*258*4:],dtype='uint8').reshape(258,258)
                xx,yy=np.meshgrid(block_column*256+np.arange(-1,257),block_row*256+np.arange(-1,257))
                valid=(xx>=0)&(xx<1377)&(yy>=0)&(yy<657)
                baseline=np.zeros((258,258));baseline[valid]=raw_values[yy[valid],xx[valid]]
                valid[valid] &= ~raw_missing[yy[valid],xx[valid]]
                if not np.array_equal(mask,valid.astype('uint8')) or not np.allclose(values[valid],baseline[valid],rtol=0,atol=.001) or np.any(values[~valid]!=0):
                    raise ValueError('Native block differs from original GRIB or padding/mask')
                block_checks.append([block_column,block_row])
        gis = geoserver.verify(manifest['gis'])
        results.append({'source':entry['source'],'job':entry['job'],'selection':job['selection'],
                        'source_crs':metadata['source_crs'],'times':24,'points':points,'native_blocks':block_checks,'gis':gis})
    output = {'status':'passed','sources':results,'scope':'all current GRIB files and all actual sample times; no producer geographic control point'}
    (directory/(Path(sys.argv[1]).stem+'-verified.json')).write_text(json.dumps(output,indent=2)+'\n')
    print(json.dumps({'status':'passed','sources':len(results),'times':sum(item['times'] for item in results)}))


if __name__=='__main__':
    main()
