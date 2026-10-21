"""Shared trial selection and error semantics; never publication authority."""

import json
import math
import re
from dataclasses import dataclass
from datetime import datetime

from decoder.sampling import ManifestSampler, asset_path
from decoder.inspect_forecast import ValidationError
from trials import ROOT

COLLECTION = 'surface-temperature'
FIELD = 'T_G:surface:0'
NATIVE_CRS = 'urn:hmc:crs:icon-sphere-6371229'


class QueryError(Exception):
    def __init__(self, status: int, code: str, detail: str):
        self.status, self.code, self.detail = status, code, detail


class Catalog:
    def __init__(self):
        self.raw = b''
        self.samplers: dict[tuple[str, str], ManifestSampler] = {}
        self.refresh_error: str | None = None
        self.refresh()

    def refresh(self) -> None:
        try:
            raw = (ROOT / 'catalog.json').read_bytes()
            if raw == self.raw:
                self.refresh_error = None
                return
            paths = json.loads(raw)
            if not isinstance(paths, list) or not paths:
                raise ValueError('catalog requires manifest paths')
            replacement = {}
            for name in paths:
                path = asset_path(ROOT, name)
                # Revalidate the entire replacement before making it visible.
                sampler = ManifestSampler(path)
                key = (sampler.manifest['run'], sampler.revision)
                if key in replacement:
                    raise ValueError('duplicate selection')
                replacement[key] = sampler
            self.samplers, self.raw, self.refresh_error = replacement, raw, None
        except (OSError, ValueError, KeyError, TypeError, ValidationError) as error:
            self.refresh_error = type(error).__name__
            if not self.samplers:
                raise

    def resolve(self, run: str, revision: str) -> ManifestSampler:
        self.refresh()
        try:
            return self.samplers[(run, revision)]
        except KeyError:
            raise QueryError(404, 'NotFound', 'unavailable run/revision') from None

    def metadata(self, args) -> dict:
        sampler = self.resolve(args['run'], args['revision'])
        return {'id': COLLECTION, 'run': args['run'], 'revision': args['revision'],
                'field': FIELD, 'parameter': 'T_G', 'units': 'K', 'state': 'validated-test',
                'valid_times': [item['metadata']['valid_time'] for item in sampler.manifest['fields']],
                'method': 'native_cell', 'temporal_selection': 'exact',
                'crs': NATIVE_CRS, 'crs_definition': '+proj=longlat +R=6371229 +no_defs',
                'coordinate_order': ['longitude', 'latitude'], 'run_revision': 'query extensions',
                'query_types': ['position'], 'source': sampler.manifest['source']}


@dataclass(frozen=True)
class Selection:
    sampler: ManifestSampler
    run: str
    revision: str
    valid_time: str
    lon: float
    lat: float

    def sample(self) -> dict:
        return self.sampler.sample(run=self.run, revision=self.revision, field=FIELD,
                                   valid_time=self.valid_time, lon=self.lon, lat=self.lat)


def coverage(selection: Selection) -> dict:
    point = selection.sample()
    cell = point['cell'] or {'lon': (selection.lon + 180) % 360 - 180, 'lat': selection.lat}
    return {'type': 'Coverage', 'domain': {
        'type': 'Domain', 'domainType': 'PointSeries',
        'axes': {'x': {'values': [cell['lon']]}, 'y': {'values': [cell['lat']]},
                 't': {'values': [selection.valid_time]}},
        'referencing': [
            {'coordinates': ['x', 'y'], 'system': {'type': 'GeographicCRS', 'id': NATIVE_CRS,
                                                  'definition': '+proj=longlat +R=6371229 +no_defs'}},
            {'coordinates': ['t'], 'system': {'type': 'TemporalRS', 'calendar': 'Gregorian'}}]},
        'parameters': {'T_G': {'type': 'Parameter', 'unit': {'symbol': 'K'},
                              'observedProperty': {'id': 'urn:hmc:field:T_G:surface:0',
                                                   'label': {'en': 'Ground surface temperature'}}}},
        'ranges': {'T_G': {'type': 'NdArray', 'dataType': 'float', 'axisNames': ['t'],
                          'shape': [1], 'values': [point['value']]}}, 'selection': point}


def select(catalog: Catalog, args, edr: bool) -> Selection:
    required = {'run', 'revision', 'datetime', 'coords', 'parameter-name'} if edr else {
        'run', 'revision', 'valid_time', 'lon', 'lat', 'layer'}
    allowed = required | ({'f', 'crs'} if edr else set())
    if set(args) - allowed or required - set(args) or any(len(args.getlist(key)) != 1 for key in args):
        raise QueryError(400, 'InvalidParameterValue', 'missing, repeated or unsupported query parameter')
    if edr:
        if args.get('f', 'json') != 'json' or args.get('crs', NATIVE_CRS) != NATIVE_CRS:
            raise QueryError(400, 'InvalidParameterValue', 'trial supports JSON and native source coordinates only')
        match = re.fullmatch(r'POINT\(\s*([^\s()]+)\s+([^\s()]+)\s*\)', args['coords'])
        if not match:
            raise QueryError(400, 'InvalidParameterValue', 'expected one two-dimensional POINT(lon lat)')
        lon_text, lat_text = match.groups()
        time = args['datetime']
        if args['parameter-name'] != 'T_G':
            raise QueryError(404, 'NotFound', 'unavailable parameter')
    else:
        if args['layer'] != COLLECTION:
            raise QueryError(404, 'NotFound', 'unavailable layer')
        lon_text, lat_text, time = args['lon'], args['lat'], args['valid_time']
    try:
        lon, lat = float(lon_text), float(lat_text)
        if not math.isfinite(lon) or not math.isfinite(lat) or not -90 <= lat <= 90:
            raise ValueError('invalid coordinate')
        if not time.endswith('Z') or '/' in time:
            raise ValueError('expected one exact UTC instant')
        datetime.fromisoformat(time.replace('Z', '+00:00'))
    except ValueError:
        raise QueryError(400, 'InvalidParameterValue', 'invalid position or exact UTC time') from None
    sampler = catalog.resolve(args['run'], args['revision'])
    if not any(item['field'] == FIELD and item['metadata']['valid_time'] == time for item in sampler.manifest['fields']):
        raise QueryError(404, 'NotFound', 'unavailable field/time')
    return Selection(sampler, args['run'], args['revision'], time, lon, lat)
