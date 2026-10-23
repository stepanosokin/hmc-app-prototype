"""Actual raw GRIB reference for desktop checks, independent Cartesian rotation."""
import json
import math
from pathlib import Path

import requests

from decoder.storage import bounded_frames,decoded_arrays


def main():
    directory=Path('/evidence')
    selections=requests.get('http://gateway:8000/api/v1/catalogue',timeout=90).json()['selections']
    latest=next(item for item in reversed(selections) if '/display/2/' in item['native_display'])
    selected=[item for item in selections if item['revision']==latest['revision']]
    assert len(selected)==24
    # Independent inverse rotation of native (20,50), followed by the explicit
    # zero-shift source-sphere Cartesian -> WGS84 operation used by GeoServer.
    lam,phi,pole=map(math.radians,(20,50,25))
    xx=math.sin(pole)*math.cos(phi)*math.cos(lam)-math.cos(pole)*math.sin(phi)
    yy=math.cos(phi)*math.sin(lam)
    zz=math.cos(pole)*math.cos(phi)*math.cos(lam)+math.sin(pole)*math.sin(phi)
    lon=((math.degrees(math.atan2(yy,xx))+90+180)%360)-180
    p,z=6371229*math.hypot(xx,yy),6371229*zz
    geodetic=math.atan2(z,p)
    for _ in range(12):
        n=6378137/math.sqrt(1-.0066943799901413165*math.sin(geodetic)**2)
        geodetic=math.atan2(z+.0066943799901413165*n*math.sin(geodetic),p)
    lat=math.degrees(geodetic)
    choices=[]
    for hour,frame in enumerate(bounded_frames(Path('/input/ICON_EU_T_G_2026101500.grib2')),1):
        if hour not in (1,24):continue
        values,_=decoded_arrays(frame,[657,1377])
        selection=next(item for item in selected if int(item['valid_time'][11:13])==hour%24)
        choices.append({'time':selection['valid_time'],'value_K':float(values[328,696]),
            'positions':{'EPSG:4326':[lon,lat],'EPSG:3857':[6378137*math.radians(lon),6378137*math.log(math.tan(math.pi/4+geodetic/2))]}})
    (directory/'qgis-reference.json').write_text(json.dumps({'wms':latest['wms'],'choices':choices},indent=2)+'\n')
    print('QGIS reference exported for two actual times')


if __name__=='__main__':main()
