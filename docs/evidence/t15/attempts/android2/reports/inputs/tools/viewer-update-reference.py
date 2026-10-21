"""Independent raw-GRIB/PROJ and real gateway consistency after explicit updates."""
import hashlib
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import requests
from pyproj import Transformer

from decoder.inspect_forecast import SAMPLE_SHA256
from decoder.storage import bounded_frames, decoded_arrays


def main():
    directory = Path('/evidence')
    browser = sys.argv[1]
    updates = json.loads((directory / browser / 'browser.json').read_bytes())['updates']
    source = Path('/input/ICON_EU_T_G_2026101500.grib2')
    assert hashlib.sha256(source.read_bytes()).hexdigest() == SAMPLE_SHA256
    frame = next(frame for index, frame in enumerate(bounded_frames(source)) if index == 2)
    values, missing = decoded_arrays(frame, [657, 1377])
    # Explicit synthetic correction supplements the unchanged real sample.
    values = values + 1.0
    maximum, masks, count = 0.0, 0, 0
    for view in [updates['atomic']['view']] + [item['view'] for item in updates['replacements']]:
        center = view['center']
        definition = (f'+proj=ortho +lat_0={center[1]} +lon_0={center[0]} +R=6378137'
                      if view['mode'] == 'hmc:orthographic' else 'EPSG:3576' if view['mode'] == 'EPSG:3576' else 'EPSG:3857')
        inverse = Transformer.from_crs(definition, 'EPSG:4326', always_xy=True)
        valid_count = 0
        for x, y, actual, valid, *_ in view['samples']:
            lon, lat = inverse.transform((x+.5-view['origin'][0])/view['scale'], (view['origin'][1]-y-.5)/view['scale'])
            native = math.degrees(math.atan2((1-.0066943799901413165)*math.sin(math.radians(lat)), math.cos(math.radians(lat)))) if math.isfinite(lat) else math.inf
            covered = -23.53125 <= lon < 62.53125 and 29.46875 <= native < 70.53125 and (view['mode'] != 'EPSG:3576' or lat >= 45)
            if covered:
                col, row = min(max((lon+23.5)*16, 0), 1376), min(max((native-29.5)*16, 0), 656)
                i, j = math.floor(col), math.floor(row)
                a, b = col-i, row-j
                cells = [(j,i,(1-a)*(1-b)), (j,min(i+1,1376),a*(1-b)), (min(j+1,656),i,(1-a)*b), (min(j+1,656),min(i+1,1376),a*b)]
                covered = not any(missing[r,c] for r,c,w in cells if w > 0)
                if covered and valid:
                    maximum = max(maximum, abs(actual-sum(float(values[r,c])*w for r,c,w in cells)))
                    valid_count += 1
            masks += bool(valid) != covered
        assert valid_count > 0
        count += valid_count
    point, position = updates['atomic']['point'], updates['atomic']['position']
    assert point['revision'] == updates['after']['revision']
    native = math.degrees(math.atan2((1-.0066943799901413165)*math.sin(math.radians(position['lat'])), math.cos(math.radians(position['lat']))))
    assert point['cell']['column'] == math.floor((position['lng']+23.53125)*16)
    assert point['cell']['row'] == math.floor((native-29.46875)*16)
    assert abs(point['value']-float(values[point['cell']['row'],point['cell']['column']])) <= .0001
    query = {'coords': f"POINT({position['lng']} {position['lat']})", 'datetime': point['valid_time'],
             'run': point['run'], 'revision': point['revision'], 'parameter-name': 'T_G', 'crs': 'http://www.opengis.net/def/crs/OGC/1.3/CRS84'}
    coverage = requests.get('http://gateway:8000'+updates['after']['position'], params=query, timeout=90)
    coverage.raise_for_status()
    body = coverage.json()
    assert body['selection'] == point
    assert body['ranges']['T_G']['values'] == [point['value']]
    assert body['parameters']['T_G']['unit']['symbol'] == 'K'
    assert body['domain']['axes'] == {'x': {'values': [point['cell']['lon']]}, 'y': {'values': [point['cell']['lat']]}, 't': {'values': [point['valid_time']]}}
    wms = 'http://gateway:8000'+updates['after']['wms']
    capabilities = requests.get(wms, params={'SERVICE':'WMS','VERSION':'1.3.0','REQUEST':'GetCapabilities'}, timeout=90)
    capabilities.raise_for_status()
    layer = ET.fromstring(capabilities.content).findall('.//{*}Layer/{*}Name')[0].text
    native_lat = math.radians(point['cell']['lat'])
    latitude = math.degrees(math.atan2(math.sin(native_lat), (1-.0066943799901413165)*math.cos(native_lat)))
    mx, my = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True).transform(point['cell']['lon'], latitude)
    info = requests.get(wms, params={'SERVICE':'WMS','VERSION':'1.3.0','REQUEST':'GetFeatureInfo',
        'LAYERS':layer,'QUERY_LAYERS':layer,'STYLES':'','TIME':point['valid_time'], 'CRS':'EPSG:3857',
        'BBOX':f'{mx-150},{my-150},{mx+150},{my+150}','WIDTH':3,'HEIGHT':3,'I':1,'J':1,'FORMAT':'image/png','INFO_FORMAT':'text/plain'}, timeout=90)
    info.raise_for_status()
    match = re.search(r'GRAY_INDEX\s*=\s*([0-9.eE+-]+)', info.text)
    assert match is not None and abs(float(match.group(1))-point['value']) <= .0001
    assert maximum <= .01 and masks == 0
    result = {'status':'passed','source_sha256':SAMPLE_SHA256,'scope':'Actual hour +3 plus labelled +1 K correction; real gateway EDR and scoped WMS, unchanged historical desktop QGIS baseline',
              'valid_gpu_samples':count,'max_abs_error_K':maximum,'mask_differences':masks,'point':point,'edr_equal':True,'wms_value_K':float(match.group(1))}
    (directory / (browser+'-updates-comparison.json')).write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({key: result[key] for key in ('status','valid_gpu_samples','max_abs_error_K','mask_differences','edr_equal','wms_value_K')}))


if __name__ == '__main__':
    main()
