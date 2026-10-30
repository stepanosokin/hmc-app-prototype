"""Read-only independent Zarr/PROJ reference; input is a frozen browser report on stdin."""
import json
import math
import sys

import numpy as np
import zarr
from pyproj import Transformer
from publication.domain import resolve
from publication.native_display import source
from decoder.grib_crs import transform
from decoder.sampling import read_values


def check(report):
    groups = {}
    results = []
    windows = set()
    for state in report['states']:
        contour = state.get('contours', {})
        samples = (contour.get('stats') or {}).get('numeric_samples', [])
        if not samples:
            continue
        selection = state['displayed']['selection']
        if selection not in groups:
            manifest = resolve(selection)
            root, item = source(manifest)
            group = zarr.open_group(str(root / item['zarr']), mode='r', zarr_format=2)
            groups[selection] = (item, group)
        item, group = groups[selection]
        metadata = item['metadata']
        assert metadata['identity']['units'] == state['displayed']['units'], 'source units changed'
        profile = contour['profile']
        factor, offset = profile['factor'], profile['offset']
        bound = metadata.get('float32_abs_error_bound', .001)
        variable = item.get('data_variable', 'temperature')
        grid = metadata['grid']
        west, south, _, _ = grid['outer_cell_edges_wsen']
        dx, dy = grid['spacing_degrees_xy']
        view = contour['view']
        mode = view['mode']
        definition = ('EPSG:3857' if mode == 'mercator' else
                      '+proj=laea +lat_0=60 +lon_0=90 +x_0=0 +y_0=0 +datum=WGS84 +units=m' if mode == 'hmc:laea-rf' else
                      '+proj=laea +lat_0=90 +lon_0=90 +x_0=0 +y_0=0 +datum=WGS84 +units=m' if mode == 'EPSG:3576' else
                      f'+proj=ortho +lat_0={view["center"][1]} +lon_0={view["center"][0]} +x_0=0 +y_0=0 +R=6378137 +units=m')
        projection = Transformer.from_crs('EPSG:4326', definition, always_xy=True)
        previous = None
        width_km = 0.
        for i in range(129):
            px = (view['width']*i/128-view['origin'][0])/view['scale']
            py = (view['origin'][1]-view['height']/2)/view['scale']
            lon, lat = projection.transform(px, py, direction='INVERSE')
            valid = math.isfinite(lon+lat) and abs(lat) <= 90
            if mode == 'hmc:orthographic':
                valid &= math.hypot(px, py) <= 6378137
            if mode == 'EPSG:3576':
                valid &= lat >= 45
            if not valid:
                previous = None
                continue
            if previous:
                a, b, dl = map(math.radians, [previous[1], lat, lon-previous[0]])
                q = math.sin((b-a)/2)**2+math.cos(a)*math.cos(b)*math.sin(dl/2)**2
                width_km += 2*6371.0088*math.asin(math.sqrt(max(0., min(1., q))))
            previous = (lon, lat)
        if not width_km:
            width_km = view['width']/abs(view['scale'])/1000
        assert abs(width_km-contour['width_km']) < .1, ('independent geographic viewport width', width_km, contour['width_km'])
        assert profile['scale'] == (0 if width_km > 6000 else 1 if width_km > 2000 else 2)
        window = (contour.get('stats') or {}).get('native_window')
        window_key = json.dumps([metadata.get('source_crs'), grid['shape_yx'], view, window], sort_keys=True)
        checked_nodes = 0
        ny, nx = grid['shape_yx']
        if window and window != [0, 0, nx-2, ny-2] and window_key not in windows:
            # Independent forward scan of EVERY native node, not inverse-viewport sampling.
            # Includes all numeric-mask states: the ROI must not depend on the palette or mask.
            for first in range(0, ny, 32):
                columns, rows = np.meshgrid(np.arange(nx), np.arange(first, min(first+32, ny)))
                sx, sy = west+(columns+.5)*dx, south+(rows+.5)*dy
                if metadata.get('source_crs'):
                    lon, lat = transform(metadata['source_crs'], sx, sy, inverse=True)
                else:
                    lon, lat = sx, np.degrees(np.arctan2(np.sin(np.radians(sy)), (1-.0066943799901413165)*np.cos(np.radians(sy))))
                wx, wy = projection.transform(lon, lat)
                screen_x, screen_y = view['origin'][0]+wx*view['scale'], view['origin'][1]-wy*view['scale']
                visible = (screen_x >= -24) & (screen_x <= view['width']+24) & (screen_y >= -24) & (screen_y <= view['height']+24)
                if mode == 'EPSG:3576':
                    visible &= lat >= 45
                if mode == 'hmc:orthographic':
                    a, b, dl = np.radians(lat), math.radians(view['center'][1]), np.radians(lon-view['center'][0])
                    visible &= np.sin(a)*math.sin(b)+np.cos(a)*math.cos(b)*np.cos(dl) > 0
                if mode == 'mercator':
                    visible &= np.abs(lat) < 85.05112878
                assert np.all(~visible | ((columns >= window[0]) & (columns <= window[2]+1) & (rows >= window[1]) & (rows <= window[3]+1))), 'native viewport window omitted visible nodes'
                checked_nodes += columns.size
            windows.add(window_key)
        error = 0.
        projected = 0
        for sample in samples:
            x, y = sample['cell']
            indices = [(y, x), (y, x+1), (y+1, x+1), (y+1, x)]
            missing = read_values(group, 'missing', (slice(y, y+2), slice(x, x+2)))
            cells = read_values(group, variable, (slice(y, y+2), slice(x, x+2)))
            assert not any(bool(missing[r-y, c-x]) for r, c in indices), 'NoData entered a contour cell'
            values = np.array([float(cells[r-y, c-x]) for r, c in indices])
            encoded = np.asarray(values, dtype='<f4').astype(float)
            assert np.array_equal(encoded, sample['values']), 'worker values differ from encoded native Zarr cells'
            assert np.max(np.abs(encoded-values)) <= bound+1e-12, 'native encoding bound'
            (ax, ay), (bx, by) = sample['intersections']
            mx, my = (ax+bx)/2-x, (ay+by)/2-y
            v = encoded*factor+offset
            gx = (v[1]-v[0])*(1-my)+(v[2]-v[3])*my
            gy = (v[3]-v[0])*(1-mx)+(v[2]-v[1])*mx
            assert (bx-ax)*gy-(by-ay)*gx >= -1e-9, 'label top points away from increasing native values'
            for index, (px, py) in enumerate(sample['intersections']):
                fx, fy = px-x, py-y
                assert -1e-9 <= fx <= 1+1e-9 and -1e-9 <= fy <= 1+1e-9
                assert min(abs(fx), abs(fx-1), abs(fy), abs(fy-1)) < 1e-9, 'intersection not on native edge'
                value = ((1-fx)*(1-fy)*values[0]+fx*(1-fy)*values[1]+fx*fy*values[2]+(1-fx)*fy*values[3])*factor+offset
                delta = abs(value-sample['level'])
                assert delta <= bound*abs(factor)+1e-8, ('level differs from native edge', delta, bound)
                error = max(error, delta)
                xy = (west+(px+.5)*dx, south+(py+.5)*dy)
                spec = metadata.get('source_crs')
                if spec:
                    lon, lat, *_ = transform(spec, *xy, inverse=True)
                    lon, lat = float(lon), float(lat)
                else:
                    lon, phi = xy[0], math.radians(xy[1])
                    lat = math.degrees(math.atan2(math.sin(phi), (1-.0066943799901413165)*math.cos(phi)))
                actual = sample['screen'][index]
                visible = abs(lat) < 85.05112878 if mode == 'mercator' else lat >= 45 if mode == 'EPSG:3576' else True
                if mode == 'hmc:orthographic':
                    a, b, dl = map(math.radians, [lat, view['center'][1], lon-view['center'][0]])
                    visible = math.sin(a)*math.sin(b)+math.cos(a)*math.cos(b)*math.cos(dl) > 0
                if not visible:
                    assert actual is None, 'hidden projection point drawn'
                    continue
                wx, wy = projection.transform(lon, lat)
                if not math.isfinite(wx+wy):
                    continue
                expected = [view['origin'][0]+wx*view['scale'], view['origin'][1]-wy*view['scale']]
                assert actual is not None and math.dist(expected, actual[:2]) <= .05, ('PROJ position', expected, actual)
                projected += 1
        results.append({'state': state['name'], 'selection': selection, 'samples': len(samples),
                        'source_level_max_abs_error': error, 'projected_points': projected,
                        'viewport_native_nodes_checked': checked_nodes, 'independent_width_km': width_km})
    assert results, 'browser report has no native numeric witnesses'
    return {'status': 'passed', 'scope': 'Direct immutable Zarr cells and independent PROJ; no raster readback',
            'states': results, 'samples': sum(r['samples'] for r in results),
            'projected_points': sum(r['projected_points'] for r in results),
            'cleanup': 'Read-only checks; no files or test resources created in the service'}


if __name__ == '__main__':
    print(json.dumps(check(json.load(sys.stdin)), ensure_ascii=False))
