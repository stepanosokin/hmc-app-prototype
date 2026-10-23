"""Actual-source focused check before allocating publication services."""
import json
import tempfile
import math
from pathlib import Path

import numpy as np

from decoder.source_crs import resolve
from decoder.storage import bounded_frames, field_metadata, decoded_arrays, write_field, check_field


def main():
    source = Path('/workspace/data/grib/ICON_EU_T_G_2026101500.grib2')
    frame = next(bounded_frames(source))
    metadata = field_metadata(frame,1,resolve(source.parent/'proj.txt'))
    values, missing = decoded_arrays(frame,metadata['grid']['shape_yx'])
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        item = write_field(root,'first-hour',metadata,values,missing)
        result = check_field(root,item,values,missing)
        from publication.tiles import render
        actual,valid=render(root,item,3,1,2)
        assert valid.sum()>0
        maximum=0.
        for row,column in zip(*np.nonzero(valid)):
            if (row*258+column)%97:continue
            lon=((256+column-1+.5)/(256*8)*360)-180
            phi=math.atan(math.sinh(math.pi*(1-2*(512+row-1+.5)/(256*8))))
            p=math.atan2((1-.0066943799901413165)*math.sin(phi),math.cos(phi))
            lam,pole=math.radians(lon-90),math.radians(25)
            x=math.degrees(math.atan2(math.cos(p)*math.sin(lam),math.sin(pole)*math.cos(p)*math.cos(lam)+math.cos(pole)*math.sin(p)))
            y=math.degrees(math.asin(math.sin(pole)*math.sin(p)-math.cos(pole)*math.cos(p)*math.cos(lam)))
            fx,fy=min(1376,max(0,(x+23.5)*16)),min(656,max(0,(y-29.5)*16))
            i,j=math.floor(fx),math.floor(fy);a,b=fx-i,fy-j
            expected=sum(values[r,c]*w for r,c,w in [(j,i,(1-a)*(1-b)),(j,min(i+1,1376),a*(1-b)),(min(j+1,656),i,(1-a)*b),(min(j+1,656),min(i+1,1376),a*b)])
            maximum=max(maximum,abs(actual[row,column]-expected))
        assert maximum<1e-8
        print(json.dumps({'status':'passed','source_crs':metadata['source_crs'],
                          'numeric_tile_reference_max_error_K':maximum,'checks':result,'cog_bytes':(root/item['cog']).stat().st_size},indent=2))


if __name__=='__main__':
    main()
