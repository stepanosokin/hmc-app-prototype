"""Independent raw-GRIB/PROJ reference for retained-point time switching."""
import hashlib
import json
import math
import sys
from pathlib import Path

from pyproj import Transformer

from decoder.inspect_forecast import SAMPLE_SHA256
from decoder.storage import bounded_frames, decoded_arrays


def main():
    directory = Path('/evidence')
    browser = sys.argv[1]
    report = json.loads((directory / browser / 'browser.json').read_bytes())['time_switch']
    source = Path('/input/ICON_EU_T_G_2026101500.grib2')
    assert hashlib.sha256(source.read_bytes()).hexdigest() == SAMPLE_SHA256
    frames = {}
    for index, frame in enumerate(bounded_frames(source)):
        if index in (0, 2):
            frames[index + 1] = decoded_arrays(frame, [657, 1377])
        if index == 2:
            break
    maximum, count, masks, results = 0.0, 0, 0, []
    for item in report['numerical']:
        point, position, view, selection = item['point'], item['position'], item['view'], item['selected']
        hour = int(selection['valid_time'][11:13])
        values, missing = frames[hour]
        assert point['selection'] == selection['selection'] == view['cache_identity']['selection']
        assert point['revision'] == selection['revision']
        assert point['valid_time'] == selection['valid_time']
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
        native = math.degrees(math.atan2((1-.0066943799901413165)*math.sin(math.radians(position['lat'])), math.cos(math.radians(position['lat']))))
        column, row = math.floor((position['lng']+23.53125)*16), math.floor((native-29.46875)*16)
        assert point['cell']['column'] == column and point['cell']['row'] == row
        assert not missing[row,column]
        assert abs(point['value']-float(values[row,column])) <= .0001
        assert point['source']['sha256'] == SAMPLE_SHA256
        count += valid_count
        results.append({'hour':hour,'mode':view['mode'],'point_K':point['value'],'valid_gpu_samples':valid_count})
    assert len(results) == 6 and maximum <= .01 and masks == 0
    result = {'status':'passed','source_sha256':SAMPLE_SHA256,'valid_gpu_samples':count,
              'max_abs_error_K':maximum,'mask_differences':masks,'point_tolerance_K':.0001,'results':results}
    (directory / (browser+'-time-comparison.json')).write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
