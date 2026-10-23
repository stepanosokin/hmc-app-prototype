"""Prepare double-precision control points for independent browser formulas."""
import json
import sys
from typing import Any
from pathlib import Path
sys.path.insert(0,'/app')
sys.path.insert(0,'/app/tests')

from test_grib_crs import section
from decoder.grib_crs import resolve, transform
from pyproj import Transformer

result: list[dict[str, Any]]=[]
mercator=Transformer.from_crs('EPSG:4326','EPSG:3857',always_xy=True)
for template in (0,1,10,20,30,31):
    for shape in (6,5):
        spec=resolve(section(template,shape))
        grid=spec['grid'];w,s,_,_=grid['outer_edges_wsen'];dx,dy=grid['spacing_xy']
        samples=[]
        for col,row in [(0,0),(3,2),(1.3,.8),(2.2,1.4)]:
            x,y=w+(col+.5)*dx,s+(row+.5)*dy
            lon,lat=transform(spec,x,y,inverse=True)
            mx,my=mercator.transform(lon,lat)
            samples.append({'native':[x,y],'wgs84':[float(lon),float(lat)],'map':[mx,my],
                            'value':280+col+4*row})
        result.append({'template':template,'earth_shape':shape,'source_crs':spec,
                       'grid':{'shape_yx':[3,4],'spacing_degrees_xy':[dx,dy],
                               'outer_cell_edges_wsen':grid['outer_edges_wsen']},'samples':samples})
Path('/evidence/browser-reference.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'templates':6,'earth_shapes':2,'cases':len(result),'points':sum(len(r['samples']) for r in result)}))
