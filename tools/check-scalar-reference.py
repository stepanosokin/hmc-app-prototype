"""Independent source values and GPU pressure sampling; no decoder imports."""
import argparse
import hashlib
import json
import math
from datetime import datetime
from pathlib import Path

import eccodes as ec
import numpy as np
import requests
from pyproj import Transformer


def read_source(selection:dict,inventory:dict) -> dict:
    valid=datetime.fromisoformat(selection['valid_time'].replace('Z','+00:00'))
    for entry in inventory['files']:
        matches=[message for message in entry['messages'] if message['validityDate']==int(valid.strftime('%Y%m%d'))
            and message['validityTime']==int(valid.strftime('%H%M'))
            and (message.get('field')==selection['field'] or selection['field']=='T_G:surface:0' and message['shortName']=='T_G')]
        if matches:break
    else:raise AssertionError('Selection has no matching raw source message')
    message=matches[0];path=Path('/input')/entry['name']
    assert hashlib.sha256(path.read_bytes()).hexdigest()==entry['sha256']
    with path.open('rb') as stream:
        for ordinal in range(1,message['message']+1):
            handle=ec.codes_grib_new_from_file(stream)
            assert handle is not None
            if ordinal!=message['message']:ec.codes_release(handle)
        try:
            assert hashlib.sha256(ec.codes_get_message(handle)).hexdigest()==message['sha256']
            assert ec.codes_get(handle,'alternativeRowScanning')==0
            nx,ny=ec.codes_get(handle,'Ni'),ec.codes_get(handle,'Nj')
            values=ec.codes_get_values(handle).reshape(ny,nx)
            missing=np.zeros((ny,nx),dtype=bool)
            if ec.codes_get(handle,'bitmapPresent'):missing=ec.codes_get_array(handle,'bitmap').reshape(ny,nx)==0
            missing|=~np.isfinite(values)
            sx=-1 if ec.codes_get(handle,'iScansNegatively') else 1
            sy=1 if ec.codes_get(handle,'jScansPositively') else -1
            dx,dy=ec.codes_get(handle,'iDirectionIncrementInDegrees'),ec.codes_get(handle,'jDirectionIncrementInDegrees')
            x0,y0=ec.codes_get(handle,'longitudeOfFirstGridPointInDegrees'),ec.codes_get(handle,'latitudeOfFirstGridPointInDegrees')
            if x0>180:x0-=360
            west,south=min(x0,x0+sx*(nx-1)*dx),min(y0,y0+sy*(ny-1)*dy)
            if sy<0:values=values[::-1];missing=missing[::-1]
            if sx<0:values=values[:,::-1];missing=missing[:,::-1]
            template=ec.codes_get(handle,'gridDefinitionTemplateNumber')
            rotation={key:ec.codes_get(handle,key) for key in ('latitudeOfSouthernPoleInDegrees','longitudeOfSouthernPoleInDegrees','angleOfRotationInDegrees')} if template==1 else None
            return {'name':entry['name'],'sha256':entry['sha256'],'values':values,'missing':missing,'west':west,'south':south,
                'dx':dx,'dy':dy,'nx':nx,'ny':ny,'units':ec.codes_get(handle,'units'),'template':template,'rotation':rotation,
                'earth_shape':ec.codes_get(handle,'shapeOfTheEarth')}
        finally:ec.codes_release(handle)


def canonical_checks(base:str,selections:list[dict],inventory:dict) -> list[dict]:
    results=[]
    for selected in selections:
        source=read_source(selected,inventory)
        description=requests.get(base+selected['collection'],timeout=30);description.raise_for_status()
        native=requests.get(base+selected['native_display'],timeout=30);native.raise_for_status()
        metadata=native.json();tiles={};bound=float(np.max(np.abs(source['values'][~source['missing']])))*2**-23
        errors=[]
        for fx in (.25,.5,.75):
            for fy in (.3,.7):
                column,row=int(source['nx']*fx),int(source['ny']*fy)
                expected=None if source['missing'][row,column] else float(source['values'][row,column])
                query={key:selected[key] for key in ('selection','run','revision','valid_time')}
                query.update(layer=selected['field'],lon=source['west']+column*source['dx'],lat=source['south']+row*source['dy'],crs=description.json()['storageCrs'])
                response=requests.get(base+selected['point'],params=query,timeout=30);response.raise_for_status();point=response.json()
                assert point['selection']==selected['selection'] and point['units']==source['units']
                assert point['value']==expected,'Canonical value differs from independent ecCodes float64'
                key=(column//256,row//256)
                if key not in tiles:
                    url=metadata['url'].replace('{column}',str(key[0])).replace('{row}',str(key[1]))
                    response=requests.get(base+url,timeout=30);response.raise_for_status()
                    assert len(response.content)==332820;tiles[key]=response.content
                payload=tiles[key];index=(row%256+1)*258+column%256+1
                valid=payload[258*258*4+index]
                assert valid in (0,1)
                assert bool(valid)==(expected is not None),'Native tile mask differs'
                if expected is not None:
                    actual=float(np.frombuffer(payload,dtype='<f4',count=258*258)[index]);error=abs(actual-expected)
                    assert error<=bound+1e-12,'Native tile exceeds declared per-field float32 bound'
                    errors.append(error)
        results.append({'selection':selected['selection'],'source':source['name'],'source_sha256':source['sha256'],
            'canonical_samples':6,'canonical_float64_exact':True,'native_max_abs_error':max(errors,default=0),'native_bound':bound,'units':source['units']})
    return results


def gpu_check(record:dict,source:dict) -> dict:
    assert source['earth_shape']==6 and source['template']==1 and source['units']=='Pa'
    view=record['view'];mode=view['mode'];center=view['center']
    definition=(f'+proj=ortho +lat_0={center[1]} +lon_0={center[0]} +R=6378137' if mode=='hmc:orthographic'
        else 'EPSG:3857' if mode=='mercator' else 'EPSG:3576')
    inverse=Transformer.from_crs(definition,'EPSG:4326',always_xy=True)
    rotation=source['rotation']
    rotated=Transformer.from_crs('+proj=longlat +R=6371229',
        '+proj=ob_tran +o_proj=longlat +R=6371229 '+
        f'+o_lat_p={-rotation["latitudeOfSouthernPoleInDegrees"]} +lon_0={rotation["longitudeOfSouthernPoleInDegrees"]} +o_lon_p={-rotation["angleOfRotationInDegrees"]}',always_xy=True)
    errors=[];masks=0
    e2=(1/298.257223563)*(2-1/298.257223563)
    for x,y,actual,valid,*_ in view['samples']:
        lon,lat=inverse.transform((x+.5-view['origin'][0])/view['scale'],(view['origin'][1]-y-.5)/view['scale'])
        covered=math.isfinite(lat) and (mode!='EPSG:3576' or lat>=45)
        if covered:
            phi=math.radians(lat);native_lat=math.degrees(math.atan2((1-e2)*math.sin(phi),math.cos(phi)))
            sx,sy=rotated.transform(lon,native_lat)
            col=(sx-source['west'])/source['dx'];row=(sy-source['south'])/source['dy']
            covered=-.5<=col<source['nx']-.5 and -.5<=row<source['ny']-.5
        if covered:
            col=max(0,min(source['nx']-1,col));row=max(0,min(source['ny']-1,row))
            i,j=int(math.floor(col)),int(math.floor(row));a,b=col-i,row-j
            contributors=[(j,i,(1-a)*(1-b)),(j,min(i+1,source['nx']-1),a*(1-b)),
                (min(j+1,source['ny']-1),i,(1-a)*b),(min(j+1,source['ny']-1),min(i+1,source['nx']-1),a*b)]
            covered=not any(source['missing'][r,c] for r,c,w in contributors if w>0)
            if covered:expected=sum(float(source['values'][r,c])*w for r,c,w in contributors)
        masks+=bool(valid)!=covered
        if valid and covered:errors.append(abs(actual-expected))
    assert errors,'No actual GPU pressure samples'
    assert masks==0,'GPU/native footprint mask differs from independent PROJ'
    assert max(errors)<=5,'GPU pressure exceeds predeclared five-Pa display budget'
    return {'mode':mode,'samples':len(errors),'mask_differences':masks,'max_abs_error_Pa':max(errors),'total_display_bound_Pa':5}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report',type=Path);parser.add_argument('corpus',type=Path);parser.add_argument('inventory',type=Path)
    parser.add_argument('output',type=Path);parser.add_argument('--base',default='http://gateway:8000')
    args=parser.parse_args();report=json.loads(args.report.read_bytes());corpus=json.loads(args.corpus.read_bytes());inventory=json.loads(args.inventory.read_bytes())
    records=report['scalar_reference'];assert len(records)==3
    assert len(corpus['selections'])==4
    assert len({record['identity']['selection'] for record in records})==1
    source=read_source(records[0]['identity'],inventory)
    gpu=[gpu_check(record,source) for record in records]
    assert {record['mode'] for record in gpu}=={'mercator','hmc:orthographic','EPSG:3576'}
    result={'status':'passed','reference':'raw ecCodes values and independent PROJ; canonical native coordinates from GRIB scan flags',
        'report_sha256':hashlib.sha256(args.report.read_bytes()).hexdigest(),'gpu':gpu,
        'canonical_and_native_tiles':canonical_checks(args.base,corpus['selections'],inventory)}
    args.output.write_text(json.dumps(result,indent=2)+'\n')


if __name__=='__main__':main()
