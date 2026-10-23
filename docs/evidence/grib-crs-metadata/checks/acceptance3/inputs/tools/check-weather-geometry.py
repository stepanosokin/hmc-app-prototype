"""Independent PROJ reference for T24 display geometry, no runtime services."""
import json
import math
import sys
from pathlib import Path

from pyproj import Transformer, __version__ as pyproj_version, proj_version_str


def check(report_path):
    report = json.loads(Path(report_path).read_bytes())
    maximum = 0.0
    count = 0
    for view in report['geometry']:
        mode = view['mode']
        lon, lat = view['center']
        crs = (f'+proj=ortho +lon_0={lon} +lat_0={lat} +R=6378137'
               if mode == 'orthographic' else 'EPSG:3576' if mode == 'laea' else 'EPSG:3857')
        forward = Transformer.from_crs('EPSG:4326', crs, always_xy=True)
        for control in view['controls']:
            geo = control['geo']
            x, y = forward.transform(*geo)
            visible = math.isfinite(x) and math.isfinite(y) and (mode != 'laea' or geo[1] >= 45)
            if mode != 'mercator':
                assert control['visible'] == visible, f'visibility: {mode} {geo}'
            if not visible or abs(geo[1]) >= 85 and mode == 'mercator':
                continue
            expected = [view['origin'][0]+view['scale']*x, view['origin'][1]-view['scale']*y]
            error = math.dist(expected, control['pixel'])
            maximum = max(maximum, error)
            assert error <= .05, f'forward {mode} {geo}: {error} px'
            inverse = control['roundtrip']
            assert inverse is not None, f'inverse missing: {mode} {geo}'
            if abs(geo[1]) < 89:
                assert math.dist(inverse, geo) <= 1e-5, f'inverse {mode} {geo}'
            count += 1
    result = {'status': 'passed', 'controls': count, 'max_error_px': maximum,
              'forward_tolerance_px': .05, 'inverse_tolerance_deg': 1e-5,
              'pyproj': pyproj_version, 'proj': proj_version_str,
              'scope': 'T24 mock geometry only; no actual-data/GPU/API claim'}
    Path(report_path).with_name('geometry-reference.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result))


if __name__ == '__main__':
    check(sys.argv[1])
