"""Bounded numerical profile over published selections, independent of HTTP routing."""

import math
import re
from datetime import datetime

from pyproj import Transformer

from decoder.inspect_forecast import ValidationError
from decoder.sampling import asset_path
from publication.domain import resolve, sampler, PublicationUnavailable

NATIVE_CRS = 'urn:hmc:crs:icon-sphere-6371229'
CRS84 = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84'
# Same owner-approved zero-shift geocentric hypothesis as tile contract v2.
TO_NATIVE = Transformer.from_pipeline('+proj=pipeline +step +proj=cart +ellps=WGS84 '
                                      '+step +inv +proj=cart +R=6371229')


def position(lon: str, lat: str, valid_time: str, crs: str) -> tuple[float, float]:
    if crs not in (NATIVE_CRS, CRS84):
        raise ValueError('Поддерживаются native CRS и CRS84, порядок: долгота, широта.')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', valid_time):
        raise ValueError('Требуется точное время UTC: YYYY-MM-DDTHH:MM:SSZ.')
    datetime.fromisoformat(valid_time.replace('Z', '+00:00'))
    x, y = float(lon), float(lat)
    if not (math.isfinite(x) and math.isfinite(y) and -90 <= y <= 90):
        raise ValueError('Недопустимые координаты.')
    x = (x + 180) % 360 - 180
    if crs == CRS84:
        x, y, _ = TO_NATIVE.transform(x, y, 0)
    return x, y


def sample(selection: str, run: str, revision: str, field: str, valid_time: str,
           lon: str, lat: str, crs: str = NATIVE_CRS) -> tuple[dict, dict]:
    x, y = position(lon, lat, valid_time, crs)
    manifest = resolve(selection)
    identity = manifest['identity']
    if any(identity[key] != value for key, value in
           [('run', run), ('revision', revision), ('field', field), ('valid_time', valid_time)]):
        raise KeyError('selection mismatch')
    numerical = sampler(manifest)
    try:
        item = next(item for item in numerical.manifest['fields']
                    if item['field'] == field and item['metadata']['valid_time'] == valid_time)
        # Consolidated Zarr metadata can survive a missing array directory and
        # turn absent chunks into fill values. Do not mistake that for data.
        for name, expected in numerical.manifest['assets'].items():
            if name.startswith(item['zarr'] + '/'):
                if asset_path(numerical.root, name).stat().st_size != expected['bytes']:
                    raise OSError('published array length changed')
        result = numerical.sample(run=run, revision=numerical.revision, field=field,
                                  valid_time=valid_time, lon=x, lat=y)
    except (ValidationError, OSError, KeyError, ValueError, RuntimeError, StopIteration) as error:
        raise PublicationUnavailable('numerical read unavailable') from error
    result.update(selection=manifest['selection'], revision=revision, identity=identity,
                  crs=NATIVE_CRS, coordinate_order=['longitude', 'latitude'],
                  query_position={'lon': x, 'lat': y, 'crs': NATIVE_CRS},
                  spatial_selection='nearest-native-cell', temporal_selection='exact')
    return manifest, result


def coverage(point: dict) -> dict:
    cell = point['cell'] or point['query_position']
    x, y = cell['lon'], cell['lat']
    return {'type': 'Coverage', 'domain': {
        'type': 'Domain', 'domainType': 'PointSeries',
        'axes': {'x': {'values': [x]}, 'y': {'values': [y]}, 't': {'values': [point['valid_time']]}},
        'referencing': [
            {'coordinates': ['x', 'y'], 'system': {'type': 'GeographicCRS', 'id': NATIVE_CRS,
              'definition': '+proj=longlat +R=6371229 +no_defs'}},
            {'coordinates': ['t'], 'system': {'type': 'TemporalRS', 'calendar': 'Gregorian'}}]},
        'parameters': {'T_G': {'type': 'Parameter', 'unit': {'symbol': 'K'},
            'observedProperty': {'id': 'urn:hmc:field:T_G:surface:0',
                                 'label': {'ru': 'Температура поверхности'}}}},
        'ranges': {'T_G': {'type': 'NdArray', 'dataType': 'float', 'axisNames': ['t', 'y', 'x'],
                         'shape': [1, 1, 1], 'values': [point['value']]}}, 'selection': point}


def describe(manifest: dict, prefix: str) -> dict:
    identity = manifest['identity']
    numerical = sampler(manifest)
    item = next(item for item in numerical.manifest['fields']
                if item['field'] == identity['field'] and item['metadata']['valid_time'] == identity['valid_time'])
    grid = item['metadata']['grid']
    base = prefix + '/ogc/collections/' + manifest['selection']
    tile_url = prefix + '/api/v1/selections/' + manifest['selection'] + '/tiles.json'
    return {'id': manifest['selection'], 'title': 'Температура поверхности', 'module': 'meteorology',
        'identity': identity, 'storageCrs': NATIVE_CRS, 'crs': [NATIVE_CRS, CRS84],
        'coordinate_order': ['longitude', 'latitude'], 'response_crs': NATIVE_CRS,
        'extent': {'spatial': {'bbox': [grid['outer_cell_edges_wsen']], 'crs': NATIVE_CRS},
                   'temporal': {'interval': [[identity['valid_time'], identity['valid_time']]]}},
        'dimensions': {key: [identity[key]] for key in ('model', 'run', 'revision', 'field', 'level', 'member', 'valid_time', 'native_grid_sha256')},
        'grid': grid, 'units': item['metadata']['identity']['units'],
        'parameter_names': {'T_G': {'type': 'Parameter', 'unit': {'symbol': 'K'},
                                  'observedProperty': {'label': {'ru': 'Температура поверхности'}}}},
        'method': 'nearest-native-cell', 'temporal_selection': 'exact',
        'source': manifest['source'], 'fixture': manifest.get('fixture', 'actual'),
        'links': [{'rel': 'self', 'href': base, 'type': 'application/json'},
                  {'rel': 'data', 'href': tile_url, 'type': 'application/json'}],
        'data_queries': {'position': {'link': {'rel': 'data', 'href': base + '/position',
            'type': 'application/vnd.cov+json', 'variables': {'query_type': 'position',
                'output_formats': ['CoverageJSON'], 'default_output_format': 'CoverageJSON',
                'crs_details': [{'crs': NATIVE_CRS}, {'crs': CRS84}]}}}}}
