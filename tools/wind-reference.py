"""Independent wind evidence: raw ecCodes components and PROJ coordinate operations.

No decoder/viewer imports. Generated grid-relative cases are explicit synthetic
supplements to the actual earth-relative ENA GRIB, not extra real observations.
"""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path

import eccodes as ec
import numpy as np
import pyproj
from pyproj import Transformer, Geod

E2=(1/298.257223563)*(2-1/298.257223563)
GEOD=Geod(ellps='WGS84')

def wgs_lat(phi):
    p=math.radians(phi)
    return math.degrees(math.atan2(math.sin(p),(1-E2)*math.cos(p)))

def sphere_lat(phi):
    p=math.radians(phi)
    return math.degrees(math.atan2((1-E2)*math.sin(p),math.cos(p)))

def source_operation(spec):
    assert spec['semi_major_m']==spec['semi_minor_m']==6371229
    assert spec['configuration']['values']['geocentric_translation_m']==[0,0,0]
    assert spec['configuration']['values']['coordinate_height_m']==0
    return Transformer.from_crs(spec['proj'], '+proj=longlat +R=6371229 +type=crs',always_xy=True)

def geographic(op,xy):
    lon,lat=op.transform(*xy)
    return [lon,wgs_lat(lat)]

def norm(v):
    length=math.hypot(*v)
    return [x/length for x in v]

def from_direction(east,north):
    return None if math.hypot(east,north)<.05 else math.degrees(math.atan2(-east,-north))%360

def generate(report,output):
    spec=report['states'][0]['source_crs']
    specs=[];cases=[]
    for south_lat,south_lon,angle in [(-25,90,0),(-35,15,20),(-60,155,7)]:
        current=copy.deepcopy(spec)
        current['rotation']={'south_lat':south_lat,'south_lon':south_lon,'angle':angle}
        current['proj']=f'+proj=ob_tran +o_proj=longlat +o_lon_p={-angle} +o_lat_p={-south_lat} +lon_0={south_lon} +a=6371229 +b=6371229 +pm=0'
        current.pop('wkt',None);current.pop('sha256',None);current.pop('id',None)
        specs.append(current);op=source_operation(current)
        points:list[list[float]]=[[-30,-10],[0,0],[20,15],[55,-20]]
        for xy in points:
            geo=geographic(op,xy)
            axes=[]
            # Independent central PROJ differences, distinct from JS forward differences.
            for axis in [0,1]:
                low=xy.copy();high=xy.copy();low[axis]-=1e-4;high[axis]+=1e-4
                a,b=geographic(op,low),geographic(op,high)
                backward=math.radians(GEOD.inv(*geo,*a)[0]);forward=math.radians(GEOD.inv(*geo,*b)[0])
                axes.append(norm([math.sin(forward)-math.sin(backward),math.cos(forward)-math.cos(backward)]))
            for u,v in [[5,0],[0,5],[3,-4],[-7,2],[0,0]]:
                for relative in [False,True]:
                    east,north=(u,v) if not relative else (axes[0][0]*u+axes[1][0]*v,axes[0][1]*u+axes[1][1]*v)
                    speed=math.hypot(u,v)
                    if speed and relative:
                        factor=speed/math.hypot(east,north);east*=factor;north*=factor
                    screens={}
                    definitions={'mercator':'EPSG:3857','orthographic':'+proj=ortho +lat_0=60 +lon_0=90 +R=6378137',
                        'laea':'EPSG:3576','laea-rf':'+proj=laea +lat_0=60 +lon_0=90 +x_0=0 +y_0=0 +datum=WGS84'}
                    for mode,definition in definitions.items():
                        projection=Transformer.from_crs('EPSG:4326',definition,always_xy=True)
                        start=projection.transform(*geo)
                        visible=all(math.isfinite(v) for v in start) and not(mode=='laea' and geo[1]<45)
                        direction=None
                        if visible and speed>=.05 and abs(geo[1])<=89.9:
                            lon,lat,_=GEOD.fwd(geo[0],geo[1],math.degrees(math.atan2(east,north)),1)
                            end=projection.transform(lon,lat)
                            if all(math.isfinite(v) for v in end):direction=norm([end[0]-start[0],start[1]-end[1]])
                        screens[mode]={'visible':visible,'direction':direction}
                    cases.append({'spec':len(specs)-1,'xy':xy,'grid_relative':relative,'u':u,'v':v,
                        'expected':{'geographic':geo,'east':east,'north':north,'speed':speed,'direction':from_direction(east,north),'screens':screens}})
    output.write_text(json.dumps({'scope':'Synthetic rotated poles and mixed/axis/calm physical components; not actual forecast values',
        'reference':'PROJ inverse ob_tran, analytic zero-translation sphere/WGS84 latitude, WGS84 geodesic axis azimuths and 1m forward geodesics',
        'pyproj_version':pyproj.__version__,'proj_version':pyproj.proj_version_str,'specs':specs,'cases':cases},indent=2)+'\n')
    return {'status':'passed','generated_cases':len(cases),'reference_sha256':hashlib.sha256(output.read_bytes()).hexdigest()}

def actual(report,source_root):
    states=[s for s in report['states'] if s.get('wind',{}).get('vectors')]
    wanted={s['wind']['identity']['valid_time'] for s in states}
    wanted.update(e['time'].replace('.000Z','Z') for s in states for e in s['wind_overlay']['point_entries'] if e['state']=='value')
    by_time={};source_hashes={};maximum_component=0.;maximum_screen=0.;maximum_placement=0.;maximum_point=0.;count=0;point_count=0
    for source in sorted(source_root.glob('*.grb')):
        components={};latitudes=longitudes=None;valid=None
        with source.open('rb') as stream:
            while (handle:=ec.codes_grib_new_from_file(stream)) is not None:
                try:
                    axis=ec.codes_get(handle,'shortName')
                    if axis not in ('10u','10v'):continue
                    date=str(ec.codes_get(handle,'validityDate'));time=str(ec.codes_get(handle,'validityTime')).zfill(4)
                    valid=f'{date[:4]}-{date[4:6]}-{date[6:8]}T{time[:2]}:{time[2:]}:00Z'
                    if valid not in wanted:continue
                    assert ec.codes_get(handle,'uvRelativeToGrid')==0,'Actual reference is explicitly earth-relative'
                    assert ec.codes_get(handle,'shapeOfTheEarth')==6
                    assert ec.codes_get(handle,'iScansNegatively')==0 and ec.codes_get(handle,'jScansPositively')==1
                    shape=(ec.codes_get(handle,'Nj'),ec.codes_get(handle,'Ni'))
                    components[axis]=ec.codes_get_values(handle).reshape(shape)
                    if axis=='10u':
                        latitudes=ec.codes_get_array(handle,'latitudes').reshape(shape)
                        longitudes=ec.codes_get_array(handle,'longitudes').reshape(shape)
                finally:ec.codes_release(handle)
        if len(components)!=2:continue
        source_hashes[source.name]=hashlib.sha256(source.read_bytes()).hexdigest()
        for s in states:
            wind=s['wind']
            if wind['identity']['valid_time']==valid:
                mode=wind['display_mode'];center=wind['display_center']
                definition=f'+proj=ortho +lat_0={center[1]} +lon_0={center[0]} +R=6378137' if mode=='hmc:orthographic' else \
                    '+proj=laea +lat_0=60 +lon_0=90 +x_0=0 +y_0=0 +datum=WGS84' if mode=='hmc:laea-rf' else 'EPSG:3576' if mode=='EPSG:3576' else 'EPSG:3857'
                projection=Transformer.from_crs('EPSG:4326',definition,always_xy=True)
                for vector in wind['vectors']:
                    if not vector.get('components'):continue
                    row,column=vector['row'],vector['column'];u,v=(float(components[k][row,column]) for k in ['10u','10v'])
                    for axis,value in [('u',u),('v',v)]:
                        error=abs(vector['components'][axis]-value);maximum_component=max(maximum_component,error)
                        bound=float(np.max(np.abs(components['10'+axis])))*2**-23+1e-10
                        assert error<=bound
                        assert abs(vector['earth']['east' if axis=='u' else 'north']-value)<=bound
                    assert longitudes is not None and latitudes is not None
                    lon=float(longitudes[row,column]);lat=wgs_lat(float(latitudes[row,column]))
                    actual_lon,actual_lat=vector['geographic']
                    placement=6378137*math.hypot(math.radians((actual_lon-lon+180)%360-180)*math.cos(math.radians(lat)),math.radians(actual_lat-lat))
                    maximum_placement=max(maximum_placement,placement);assert placement<=1
                    if vector.get('screen'):
                        a=projection.transform(lon,lat);end_lon,end_lat,_=GEOD.fwd(lon,lat,math.degrees(math.atan2(u,v)),1);b=projection.transform(end_lon,end_lat)
                        dx,dy=norm([b[0]-a[0],a[1]-b[1]]);actual=norm([vector['screen']['dx'],vector['screen']['dy']])
                        error=math.hypot(actual[0]-dx,actual[1]-dy);maximum_screen=max(maximum_screen,error);assert error<=.0002
                    count+=1
            if not s.get('position'):continue
            entries=[e for e in s['wind_overlay']['point_entries'] if e['state']=='value' and e['time'].replace('.000Z','Z')==valid]
            if not entries:continue
            spec=s['source_crs'];op=source_operation(spec);p=s['position']
            x,y=op.transform(p['lng'],sphere_lat(p['lat']),direction='INVERSE')
            west,south,_,_=spec['grid']['outer_edges_wsen'];dx,dy=spec['grid']['spacing_xy']
            row,column=math.floor((y-south)/dy),math.floor((x-west)/dx)
            # Source-cell API may settle an exact boundary on the adjacent side;
            # accept that only at a independently verified numerical tie.
            cell=(s.get('point') or {}).get('cell')
            if cell:
                for actual_index,expected_index,value in [(cell['row'],row,(y-south)/dy),(cell['column'],column,(x-west)/dx)]:
                    assert actual_index==expected_index or abs(actual_index-expected_index)==1 and abs(value-round(value))<1e-7
                row,column=cell['row'],cell['column']
            u,v=(float(components[k][row,column]) for k in ['10u','10v']);speed=math.hypot(u,v);direction=from_direction(u,v)
            for entry in entries:
                error=abs(entry['speed']-speed);maximum_point=max(maximum_point,error);assert error<1e-9
                if direction is None:assert entry['direction'] is None
                else:assert abs((entry['direction']-direction+180)%360-180)<1e-9
                point_count+=1
    assert count and point_count,'Actual GRIB samples and point speeds must both be present'
    return {'status':'passed','reference':'Independent ecCodes arrays/coordinates and PROJ display projections; actual uvRelativeToGrid=0',
        'source_sha256':source_hashes,'vector_samples':count,'point_series_samples':point_count,'maximum_component_error':maximum_component,
        'maximum_screen_unit_vector_error':maximum_screen,'maximum_placement_m':maximum_placement,'maximum_point_speed_error':maximum_point}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('mode',choices=['generate','actual']);parser.add_argument('report',type=Path);parser.add_argument('output',type=Path);parser.add_argument('--sources',type=Path)
    args=parser.parse_args();report=json.loads(args.report.read_bytes())
    result=generate(report,args.output) if args.mode=='generate' else actual(report,args.sources)
    if args.mode=='actual':args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))
