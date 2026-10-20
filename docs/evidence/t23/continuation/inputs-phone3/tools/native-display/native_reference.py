"""Independent GRIB and PROJ reference for native display screen samples."""

import hashlib
import json
import math
import sys
from pathlib import Path

import requests
import numpy as np
from pyproj import Transformer

from decoder.inspect_forecast import SAMPLE_SHA256
from decoder.storage import bounded_frames, decoded_arrays


def main():
    directory = Path('/evidence')
    if sys.argv[-1] == 'prepare':
        selected = next(item for item in requests.get('http://gateway:8000/api/v1/catalogue', timeout=30).json()['selections']
                        if item['fixture'] == 'actual')
        prefix = f"/api/v1/selections/{selected['selection']}/display/1/"
        reference = {'selection': selected, 'metadata_url': prefix+'native.json',
                     'tiles': [{'url': prefix+f'native/{c}/{r}.f32'} for r in range(3) for c in range(6)]}
        reference['experiments'] = [{'url': prefix+'experiment/ortho.f32', 'mode': 'hmc:orthographic', 'extent': 6378137.},
                                    {'url': prefix+'experiment/laea.f32', 'mode': 'EPSG:3576', 'extent': 5000000.}]
        reference['tiles'].extend({'url': frame['url']} for frame in reference['experiments'])
        (directory/'native-reference.json').write_text(json.dumps(reference))
        return
    source = Path('/input/ICON_EU_T_G_2026101500.grib2')
    assert hashlib.sha256(source.read_bytes()).hexdigest() == SAMPLE_SHA256
    values, missing = decoded_arrays(next(bounded_frames(source)), [657, 1377])
    browser = sys.argv[2] if len(sys.argv) > 2 else 'browser'
    assert browser in ('browser', 'browser-edge')
    report = json.loads((directory/browser/'browser.json').read_bytes())
    results = []
    maximum, mask_differences, geometry_error, synthetic_error = 0., 0, 0., 0.
    for viewport in report['viewports']:
        for view in viewport['views'] + viewport.get('experiments', []) + viewport.get('interaction', {}).get('views', []):
            center = view.get('center', [20, 50])
            definition = (f'+proj=ortho +lat_0={center[1]} +lon_0={center[0]} +R=6378137' if view['mode'] == 'hmc:orthographic'
                          else 'EPSG:3857' if view['mode'] == 'mercator' else 'EPSG:3576')
            inverse = Transformer.from_crs(definition, 'EPSG:4326', always_xy=True)
            forward = Transformer.from_crs('EPSG:4326', definition, always_xy=True)
            for label, _, _, actual_value, actual_valid in view.get('synthetic_masks', []):
                if label == 'positive-weight-missing':
                    assert actual_valid == 0, 'synthetic positive-weight missing contributor'
                else:
                    assert actual_valid == 1, 'synthetic zero-weight missing contributor'
                    assert abs(actual_value-(283 if label == 'bilinear-center' else 280)) <= .001
            for label, sx, sy, gpu_lon, gpu_lat, gpu_visible in view.get('synthetic_geometry', []):
                expected_lon, expected_lat = inverse.transform(sx, sy)
                visible = math.isfinite(expected_lat) and (view['mode'] != 'EPSG:3576' or expected_lat >= 45)
                mask_differences += bool(gpu_visible) != visible
                if visible:
                    def unit(lon, lat):
                        lam, phi = math.radians(lon), math.radians(lat)
                        return [math.cos(phi)*math.cos(lam), math.cos(phi)*math.sin(lam), math.sin(phi)]
                    synthetic_error = max(synthetic_error, math.dist(unit(expected_lon,expected_lat),unit(gpu_lon,gpu_lat))*6378137)
            for control in view.get('controls', []):
                cx, cy = forward.transform(*control['point'])
                expected_pixel = [view['origin'][0]+view['scale']*cx, view['origin'][1]-view['scale']*cy]
                geometry_error = max(geometry_error, math.dist(expected_pixel, control['pixel']))
            errors, server_errors = [], []
            for sample in view['samples']:
                x, y, actual, valid = sample[:4]
                px = (x+.5-view['origin'][0])/view['scale']
                py = (view['origin'][1]-(y+.5))/view['scale']
                lon, phi = inverse.transform(px, py)
                native = math.degrees(math.atan2((1-0.0066943799901413165)*math.sin(math.radians(phi)),
                                                math.cos(math.radians(phi)))) if math.isfinite(phi) else math.inf
                covered = (-23.53125 <= lon < 62.53125 and 29.46875 <= native < 70.53125
                           and (view['mode'] != 'EPSG:3576' or phi >= 45))
                expected = None
                if covered:
                    column, row = min(max((lon+23.5)*16, 0), 1376), min(max((native-29.5)*16, 0), 656)
                    i, j = math.floor(column), math.floor(row)
                    a, b = column-i, row-j
                    contributors = [(j,i,(1-a)*(1-b)), (j,min(i+1,1376),a*(1-b)),
                                    (min(j+1,656),i,(1-a)*b), (min(j+1,656),min(i+1,1376),a*b)]
                    covered = not any(missing[r,c] for r,c,w in contributors if w > 0)
                    if covered:
                        expected = sum(float(values[r,c])*w for r,c,w in contributors)
                mask_differences += bool(valid) != covered
                if valid and expected is not None:
                    errors.append(abs(actual-expected))
                if len(sample) == 8:
                    server_value, server_valid = sample[6:]
                    mask_differences += bool(server_valid) != covered
                    if server_valid and expected is not None:
                        server_errors.append(abs(server_value-expected))
            error = max(errors, default=0. if viewport.get("interaction") and view in viewport["interaction"]["views"] else math.inf)
            maximum = max(maximum, error)
            results.append({'viewport': [viewport['width'],viewport['height']], 'mode': view['mode'],
                            'scope': view.get('scope', 'map'), 'valid_samples': len(errors), 'max_abs_error_K': error,
                            'numeric_scope': 'temperature samples' if errors else 'mask-only; no temperature samples',
                            'server_max_abs_error_K': max(server_errors, default=0.)})
            maximum = max(maximum, max(server_errors, default=0.))
    result = {'status': 'passed' if maximum <= .01 and mask_differences == 0 and geometry_error < .001 and synthetic_error < 10 else 'failed',
              'source_sha256': SAMPLE_SHA256, 'views': results,
              'max_abs_error_K': maximum, 'mask_differences': mask_differences, 'geometry_max_error_pixels': geometry_error,
              'synthetic_projection_error_m': synthetic_error, 'synthetic_scope': 'projection-only pole/dateline/horizon/cut probes, not forecast coverage'}
    (directory/('native-comparison-edge.json' if browser == 'browser-edge' else 'native-comparison.json')).write_text(json.dumps(result, indent=2))
    print(json.dumps(result))
    assert result['status'] == 'passed', 'native GPU error or mask exceeds approved contract'


if __name__ == '__main__':
    main()
