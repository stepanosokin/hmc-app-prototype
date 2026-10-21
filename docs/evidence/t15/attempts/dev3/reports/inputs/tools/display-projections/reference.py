"""T23 actual gateway tiles versus scalar arithmetic on the first raw GRIB frame."""
import hashlib
import importlib.metadata
import json
import math
import time
from pathlib import Path

import numpy as np
import pyproj
import requests

from decoder.inspect_forecast import SAMPLE_SHA256
from decoder.storage import bounded_frames, decoded_arrays


def reference(values, lon, lat):
    if not (-23.53125 <= lon < 62.53125 and 29.46875 <= lat < 70.53125):
        return None
    col = min(max((lon + 23.5) * 16, 0), 1376)
    row = min(max((lat - 29.5) * 16, 0), 656)
    x, y = math.floor(col), math.floor(row)
    a, b = col - x, row - y
    right, upper = min(x + 1, 1376), min(y + 1, 656)
    return float(values[y, x] * (1-a) * (1-b) + values[y, right] * a * (1-b)
                 + values[upper, x] * (1-a) * b + values[upper, right] * a * b)


def main():
    source = Path('/input/ICON_EU_T_G_2026101500.grib2')
    assert hashlib.sha256(source.read_bytes()).hexdigest() == SAMPLE_SHA256
    values, missing = decoded_arrays(next(bounded_frames(source)), [657, 1377])
    assert not np.any(missing), 'This probe requires the known unmasked actual frame'
    base = 'http://gateway:8000'
    selection = requests.get(base + '/api/v1/catalogue', timeout=30).json()['selections'][0]
    assert selection['fixture'] == 'actual'
    meta = requests.get(base + selection['tiles'], timeout=30)
    meta.raise_for_status()
    tiles, encoding_errors, samples = [], [], []
    for z, x, y in [(3, 4, 2), (3, 5, 2), (6, 35, 21), (6, 36, 21)]:
        url = meta.json()['url'].replace('{z}', str(z)).replace('{x}', str(x)).replace('{y}', str(y))
        timings = []
        payload = b''
        for phase in ('first-observed', 'repeated'):
            start = time.perf_counter()
            result = requests.get(base + url, timeout=30)
            elapsed = (time.perf_counter() - start)*1000
            result.raise_for_status()
            if payload:
                assert payload == result.content
            payload = result.content
            timings.append({'phase': phase, 'ms': elapsed, 'bytes': len(payload),
                            'cache': result.headers.get('X-HMC-Cache')})
        assert len(payload) == 258*258*5
        decoded = np.frombuffer(payload[:258*258*4], dtype='<f4').reshape(258,258)
        valid = np.frombuffer(payload[258*258*4:], dtype='uint8').reshape(258,258)
        name = f'{z}-{x}-{y}.f32'
        Path('/evidence', name).write_bytes(payload)
        tiles.append({'zxy':[z,x,y], 'url':url, 'file':name, 'sha256':hashlib.sha256(payload).hexdigest(),
                      'requests':timings})
        # Pixel-centre checks isolate encoding from additional interpolation.
        for row in range(0,258,17):
            for col in range(0,258,17):
                lon = (x*256+col-0.5)/(256*2**z)*360-180
                phi = math.atan(math.sinh(math.pi*(1-2*(y*256+row-0.5)/(256*2**z))))
                lat = math.degrees(math.atan((1-0.0066943799901413165)*math.tan(phi)))
                expected = reference(values,lon,lat)
                assert bool(valid[row,col]) == (expected is not None)
                if expected is not None:
                    encoding_errors.append(abs(float(decoded[row,col])-expected))
        # Fractional display samples expose the cost of resampling an existing v2 tile.
        for texcol, texrow in [(a+.25,b+.75) for a in range(1,256,19) for b in range(1,256,19)]:
            lon = (x*256+texcol-0.5)/(256*2**z)*360-180
            geodetic = math.atan(math.sinh(math.pi*(1-2*(y*256+texrow-0.5)/(256*2**z))))
            native = math.atan((1-0.0066943799901413165)*math.tan(geodetic))
            expected = reference(values,lon,math.degrees(native))
            ix, iy = math.floor(texcol), math.floor(texrow)
            a, b = texcol-ix, texrow-iy
            contributors = [(iy,ix,(1-a)*(1-b)),(iy,ix+1,a*(1-b)),
                            (iy+1,ix,(1-a)*b),(iy+1,ix+1,a*b)]
            resampled = (sum(float(decoded[r,c])*w for r,c,w in contributors)
                         if all(valid[r,c] for r,c,w in contributors if w>0) else None)
            samples.append({'tile':name,'texel':[texcol,texrow],'expected':expected,
                            'f32_bilinear_reference':resampled,
                            'geodetic':[lon,math.degrees(geodetic)]})
    for left, right in [(0,1),(2,3)]:
        left_payload = Path('/evidence', tiles[left]['file']).read_bytes()
        right_payload = Path('/evidence', tiles[right]['file']).read_bytes()
        av = np.frombuffer(left_payload[:258*258*4],dtype='<f4').reshape(258,258)
        bv = np.frombuffer(right_payload[:258*258*4],dtype='<f4').reshape(258,258)
        am = np.frombuffer(left_payload[258*258*4:],dtype='uint8').reshape(258,258)
        bm = np.frombuffer(right_payload[258*258*4:],dtype='uint8').reshape(258,258)
        assert np.array_equal(av[:,256:],bv[:,:2]) and np.array_equal(am[:,256:],bm[:,:2])
    query = {key:selection[key] for key in ('selection','run','revision','valid_time')}
    query.update(layer=selection['field'],lon=37.6173,lat=55.7558,
                 crs='http://www.opengis.net/def/crs/OGC/1.3/CRS84')
    point = requests.get(base + '/api/v1/point',params=query,timeout=30)
    point.raise_for_status()
    latitude = math.degrees(math.atan((1-0.0066943799901413165)*math.tan(math.radians(55.7558))))
    row, col = math.floor((latitude-29.46875)*16),math.floor((37.6173+23.53125)*16)
    assert point.json()['value'] == float(values[row,col])
    crs = pyproj.CRS.from_epsg(3576)
    projection = pyproj.Transformer.from_crs(4326,crs,always_xy=True)
    coords: list[list[float]] = [[90,90],[90,45],[0,45],[180,45],[-180,45],[37.6173,55.7558]]
    report = {'status':'reference-probe-complete','acceptance':'incomplete','selection':selection,
              'source_sha256':SAMPLE_SHA256,'tiles':tiles,'samples':samples,
              'encoding_max_abs_error_K':max(encoding_errors),'encoding_checks':len(encoding_errors),
              'halo_equal':True,'point':point.json(),'point_expected_native_cell':[row,col],
              'crs':{'authority':crs.to_authority(),'name':crs.name,'wkt':crs.to_wkt(),
                     'coordinates':[{'point':p,'projected':projection.transform(p[0],p[1])} for p in coords]},
              'versions':{name:importlib.metadata.version(name) for name in ('pyproj','numpy','eccodes','requests')},
              'proj_version':pyproj.proj_version_str}
    assert report['encoding_max_abs_error_K'] <= .001
    Path('/evidence/reference.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({key:report[key] for key in ('status','encoding_checks','encoding_max_abs_error_K','halo_equal')}))


if __name__ == '__main__':
    main()
