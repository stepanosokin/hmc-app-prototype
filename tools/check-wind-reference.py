"""Independent ENA wind reference: ecCodes values/coordinates, WGS84 datum maths.

This checker imports neither the decoder nor the browser wind implementation.
It checks the actual source's earth-relative vectors, not inferred trajectories.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import eccodes as ec
import numpy as np
from pyproj import Transformer


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report',type=Path)
    parser.add_argument('inventory',type=Path)
    parser.add_argument('output',type=Path)
    parser.add_argument('--allow-unavailable',action='store_true',help='Only for an explicitly failed workload profile; never a passing wind check')
    args=parser.parse_args()
    report=json.loads(args.report.read_bytes())
    inventory=json.loads(args.inventory.read_bytes())
    results=[];cases=[]
    def visit(value):
        if isinstance(value,dict):
            if 'vectors' in value and value.get('identity',{}).get('valid_time'):
                cases.append((value['identity'],value))
            for child in value.values():visit(child)
        elif isinstance(value,list):
            for child in value:visit(child)
    visit(report)
    if not cases:
        for scene in report.get('field_controls',[]):
            if scene.get('wind'):
                selected=next(group['selected'] for group in scene['groups'] if group['id']=='wind')
                cases.append((selected,scene['wind']))
    if not cases and args.allow_unavailable:
        assert report.get('status')=='failed','Unavailable allowance requires an actual failed browser report'
        args.output.write_text(json.dumps({'status':'unavailable','reason':'Failed browser profile recorded no wind samples; no independent wind result',
            'report_sha256':hashlib.sha256(args.report.read_bytes()).hexdigest()},indent=2)+'\n')
        return
    for selected,wind in cases:
        valid=selected['valid_time'].replace('-','').replace(':','')
        entry=next(entry for entry in inventory['files'] if any(
            str(m.get('validityDate'))==valid[:8] and str(m.get('validityTime')).zfill(4)==valid[9:13]
            for m in entry['messages']))
        source=Path('/input')/entry['name']
        assert hashlib.sha256(source.read_bytes()).hexdigest()==entry['sha256']
        components={}
        with source.open('rb') as stream:
            while (handle:=ec.codes_grib_new_from_file(stream)) is not None:
                try:
                    axis=ec.codes_get(handle,'shortName')
                    if axis not in ('10u','10v'):continue
                    assert ec.codes_get(handle,'uvRelativeToGrid')==0,'ENA reference requires declared earth-relative U/V'
                    assert ec.codes_get(handle,'shapeOfTheEarth')==6
                    assert ec.codes_get(handle,'iScansNegatively')==0 and ec.codes_get(handle,'jScansPositively')==1
                    values=ec.codes_get_values(handle).reshape(ec.codes_get(handle,'Nj'),ec.codes_get(handle,'Ni'))
                    components[axis]=values
                    if axis=='10u':
                        latitudes=ec.codes_get_array(handle,'latitudes').reshape(values.shape)
                        longitudes=ec.codes_get_array(handle,'longitudes').reshape(values.shape)
                finally:ec.codes_release(handle)
        assert len(components)==2
        errors=[];direction_errors=[];mode=wind.get('display_mode');center=wind.get('display_center')
        projection=None
        if mode:
            assert isinstance(center,list) and len(center)==2
            definition=(f'+proj=ortho +lat_0={center[1]} +lon_0={center[0]} +R=6378137' if mode=='hmc:orthographic'
                else 'EPSG:3857' if mode=='mercator' else 'EPSG:3576')
            projection=Transformer.from_crs('EPSG:4326',definition,always_xy=True)
        for vector in wind['vectors']:
            row,column=vector['row'],vector['column']
            expected={axis:float(values[row,column]) for axis,values in components.items()}
            for source_axis,browser_axis,earth_axis in [('10u','u','east'),('10v','v','north')]:
                bound=float(np.max(np.abs(components[source_axis])))*2**-23
                for actual in (vector['components'][browser_axis],vector['earth'][earth_axis]):
                    assert abs(actual-expected[source_axis])<=bound+1e-10,'Component differs from independent ecCodes value'
            # Shape 6 source is a sphere; zero translation maps the geocentric
            # latitude to WGS84 at h=0. This formula is independent of PROJ/JS.
            phi=math.radians(float(latitudes[row,column]))
            eccentricity_squared=(1/298.257223563)*(2-1/298.257223563)
            expected_lat=math.degrees(math.atan2(math.sin(phi),(1-eccentricity_squared)*math.cos(phi)))
            expected_lon=float(longitudes[row,column])
            actual_lon,actual_lat=vector['geographic']
            error=6378137*math.hypot(math.radians(actual_lat-expected_lat),
                math.radians((actual_lon-expected_lon+180)%360-180)*math.cos(math.radians(expected_lat)))
            assert error<=1,'Native cell placement differs by more than existing one-metre CRS budget'
            errors.append(error)
            if projection:
                lat=math.radians(expected_lat)
                visible=mode!='EPSG:3576' or expected_lat>=45
                if mode=='hmc:orthographic':
                    assert isinstance(center,list)
                    lon_delta=math.radians(expected_lon-center[0]);center_lat=math.radians(center[1])
                    visible=math.sin(lat)*math.sin(center_lat)+math.cos(lat)*math.cos(center_lat)*math.cos(lon_delta)>0
                assert vector['display_visible']==visible,'Projection horizon/cut visibility differs'
                speed=math.hypot(expected['10u'],expected['10v'])
                if visible and speed>=.05 and abs(expected_lat)<=89.9:
                    start=projection.transform(expected_lon,expected_lat)
                    end=projection.transform(expected_lon+expected['10u']*.001/math.cos(lat),expected_lat+expected['10v']*.001)
                    dx,dy=end[0]-start[0],start[1]-end[1];norm=math.hypot(dx,dy)
                    actual=vector['screen'];actual_norm=math.hypot(actual['dx'],actual['dy'])
                    difference=math.hypot(actual['dx']/actual_norm-dx/norm,actual['dy']/actual_norm-dy/norm)
                    assert difference<=.0002,'Drawn screen direction differs from independent PROJ by more than 0.0002 unit-vector length'
                    direction_errors.append(difference)
                else:assert not vector.get('screen'),'Calm/hidden/pole vector must not be drawn'
        results.append({'mode':mode,'source':entry['name'],'source_sha256':entry['sha256'],
            'samples':len(errors),'maximum_placement_error_m':max(errors),'orientation':'earth-relative; raw uvRelativeToGrid=0',
            'screen_direction_samples':len(direction_errors),'maximum_direction_unit_vector_error':max(direction_errors,default=None),
            'precision':'per-component max(abs(source))*2^-23; existing native-display/3 bound'})
    assert results,'No actual wind samples'
    args.output.write_text(json.dumps({'status':'passed','reference':'independent ecCodes arrays/latitudes/longitudes and analytic WGS84 datum conversion',
        'report_sha256':hashlib.sha256(args.report.read_bytes()).hexdigest(),'results':results},indent=2)+'\n')


if __name__=='__main__':main()
