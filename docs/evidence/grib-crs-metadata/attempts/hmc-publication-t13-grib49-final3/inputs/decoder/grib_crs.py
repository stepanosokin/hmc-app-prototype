"""Resolve per-message GRIB2 geometry, with explicit immutable fallback provenance.

No producer PROJ text is consulted. Missing geodetic parameters come from one
validated configuration; required projection parameters never have defaults.
"""
import hashlib
import json
import math
import struct
from functools import lru_cache
from pathlib import Path

import numpy as np
from pyproj import CRS, Transformer

CONFIG = Path(__file__).resolve().parents[1] / 'config/grib-crs-defaults.json'
SUPPORTED = (0, 1, 10, 20, 30, 31)


def canonical(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def configuration(path: Path | None = None) -> dict:
    path = CONFIG if path is None else path
    try:
        raw = path.read_bytes()
        body = json.loads(raw)
        if set(body) != {'schema', 'earth_radius_m', 'prime_meridian_degrees',
                         'geocentric_translation_m', 'coordinate_height_m'}:
            raise ValueError('configuration keys')
        if body['schema'] != 'hmc-grib-crs-defaults/1':
            raise ValueError('configuration version')
        numbers = [body['earth_radius_m'], body['prime_meridian_degrees'],
                   body['coordinate_height_m'], *body['geocentric_translation_m']]
        if (len(body['geocentric_translation_m']) != 3
                or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in numbers)
                or not 1e6 < body['earth_radius_m'] < 1e7
                or not -180 <= body['prime_meridian_degrees'] <= 180):
            raise ValueError('configuration values')
        return {'sha256': hashlib.sha256(raw).hexdigest(), 'values': body}
    except (OSError, ValueError, TypeError, KeyError) as error:
        raise ValueError('Отсутствует или некорректен config/grib-crs-defaults.json') from error


def unsigned(raw: bytes, offset: int, count: int = 4) -> int:
    if offset + count > len(raw):
        raise ValueError('Повреждена секция описания сетки GRIB2')
    return int.from_bytes(raw[offset:offset+count], 'big')


def signed(raw: bytes, offset: int, count: int = 4) -> int:
    value = unsigned(raw, offset, count)
    mask = 1 << (8*count-1)
    return -(value & (mask-1)) if value & mask else value


def required(raw: bytes, offset: int, *, angular: bool = True) -> float:
    if unsigned(raw, offset) == 0xffffffff:
        raise ValueError('В GRIB2 отсутствует обязательный параметр проекции')
    return signed(raw, offset) / (1e6 if angular else 1)


def earth(raw: bytes, defaults: dict) -> tuple[float, float, list[str]]:
    code = raw[14]
    used: list[str] = []

    def scaled(scale_offset: int, value_offset: int) -> float:
        if raw[scale_offset] == 255 or unsigned(raw, value_offset) == 0xffffffff:
            used.append('earth_radius_m')
            return defaults['earth_radius_m'] / (1000 if code == 3 else 1)
        exponent = signed(raw, scale_offset, 1)
        if not -12 <= exponent <= 12:
            raise ValueError('Некорректный масштаб размера Земли')
        return unsigned(raw, value_offset) * 10.**(-exponent)

    if code == 0:
        a = b = 6367470.
    elif code == 1:
        a = b = scaled(15, 16)
    elif code == 2:
        a, b = 6378160., 6356775.
    elif code in (3, 7):
        factor = 1000 if code == 3 else 1
        a, b = scaled(20, 21)*factor, scaled(25, 26)*factor
    elif code in (4, 5):
        a = 6378137.
        b = a * (1 - 1/(298.257222101 if code == 4 else 298.257223563))
    elif code == 6:
        a = b = 6371229.
    elif code == 8:
        a = b = 6371200.
    elif code == 255:
        a = b = defaults['earth_radius_m']
        used.append('earth_radius_m')
    else:
        raise ValueError(f'Не поддерживается код формы Земли GRIB2: {code}')
    if not (1e6 < b <= a < 1e7):
        raise ValueError('Некорректные размеры Земли в GRIB2')
    return a, b, used


def resolve(raw: bytes, config: dict | None = None) -> dict:
    config = configuration() if config is None else config
    config = json.loads(canonical(config))
    values = config['values']
    template = unsigned(raw, 12, 2)
    sizes = {0: 72, 1: 84, 10: 72, 20: 65, 30: 81, 31: 81}
    if template not in SUPPORTED:
        raise ValueError(f'Не поддерживается шаблон сетки GRIB2 3.{template}')
    if len(raw) < sizes[template] or raw[4] != 3 or unsigned(raw, 0) != len(raw):
        raise ValueError('Повреждена секция описания сетки GRIB2')
    a, b, used = earth(raw, values)
    datum_mode = 'wgs84-angular' if raw[14] in (5,8) else 'explicit-geocentric'
    if datum_mode != 'wgs84-angular':
        used += ['prime_meridian_degrees', 'geocentric_translation_m', 'coordinate_height_m']
    shape = f'+a={a:.15g} +b={b:.15g}'
    pm = 0. if datum_mode == 'wgs84-angular' else values['prime_meridian_degrees']
    base = f'{shape} +pm={pm:.15g}'
    rotation = None
    if template in (0, 1):
        unit = 1e-6
        basic, subdivisions = unsigned(raw, 38), unsigned(raw, 42)
        if basic not in (0, 0xffffffff):
            if subdivisions in (0, 0xffffffff):
                raise ValueError('Некорректная угловая единица GRIB2')
            unit = basic/subdivisions
        x0, y0 = signed(raw, 50)*unit, signed(raw, 46)*unit
        dx, dy = unsigned(raw, 63)*unit, unsigned(raw, 67)*unit
        scan = raw[71]
        proj = f'+proj=longlat {base}'
        if template == 1:
            south_lat, south_lon = required(raw, 72), required(raw, 76)
            angle = struct.unpack('>f', raw[80:84])[0]
            if not math.isfinite(angle) or not -90 <= south_lat <= 90:
                raise ValueError('Некорректный поворот сетки GRIB2')
            rotation = {'south_lat': south_lat, 'south_lon': south_lon, 'angle': angle}
            proj = (f'+proj=ob_tran +o_proj=longlat +o_lon_p={-angle:.15g} '
                    f'+o_lat_p={-south_lat:.15g} +lon_0={south_lon:.15g} {base}')
    else:
        lat0, lon0 = required(raw, 38), required(raw, 42)
        if template == 10:
            lat_ts = required(raw, 47)
            orientation = required(raw, 60)
            if orientation != 0:
                raise ValueError('Не поддерживается ненулевой угол ориентации сетки Mercator')
            dx, dy = unsigned(raw, 64)/1000, unsigned(raw, 68)/1000
            scan = raw[59]
            proj = f'+proj=merc +lat_ts={lat_ts:.15g} +lon_0=0 {base} +units=m'
        else:
            lat_d, lon_v = required(raw, 47), required(raw, 51)
            dx, dy = unsigned(raw, 55)/1000, unsigned(raw, 59)/1000
            flag, scan = raw[63], raw[64]
            if flag & 0x3f:
                raise ValueError('Некорректные флаги центра проекции GRIB2')
            if flag & 64:
                raise ValueError('Не поддерживается биполярная проекция GRIB2')
            if template == 20:
                pole = -90 if flag & 128 else 90
                proj = f'+proj=stere +lat_0={pole} +lat_ts={lat_d:.15g} +lon_0={lon_v:.15g} {base} +units=m'
            else:
                lat1, lat2 = required(raw, 65), required(raw, 69)
                south_lat, south_lon = required(raw, 73), required(raw, 77)
                if south_lat != -90 or south_lon % 360 != 0:
                    raise ValueError('Не поддерживается наклонная коническая проекция GRIB2')
                kind = 'lcc' if template == 30 else 'aea'
                proj = (f'+proj={kind} +lat_0={lat_d:.15g} +lon_0={lon_v:.15g} '
                        f'+lat_1={lat1:.15g} +lat_2={lat2:.15g} {base} +units=m')
        native = CRS.from_proj4(proj)
        geographical = CRS.from_proj4(f'+proj=longlat {base}')
        x0, y0 = Transformer.from_crs(geographical, native, always_xy=True).transform(lon0, lat0)
    nx, ny = unsigned(raw, 30), unsigned(raw, 34)
    if (not 1 <= nx <= 100000 or not 1 <= ny <= 100000 or nx*ny != unsigned(raw, 6)
            or nx*ny > 16000000 or not 0 < dx < 1e9 or not 0 < dy < 1e9
            or not all(map(math.isfinite, (x0, y0, dx, dy)))):
        raise ValueError('Некорректные размеры или шаг сетки GRIB2')
    if scan & 0x3f:
        raise ValueError('Не поддерживается порядок сканирования сетки GRIB2')
    if template in (0,1):
        if any(unsigned(raw,p)==0xffffffff for p in (46,50,55,59,63,67)):
            raise ValueError('В GRIB2 отсутствует обязательный параметр сетки')
        last_y,last_x = signed(raw,55)*unit,signed(raw,59)*unit
        expected_y = y0 + ((ny-1)*dy if scan & 64 else -(ny-1)*dy)
        expected_x = x0 + (-(nx-1)*dx if scan & 128 else (nx-1)*dx)
        if (not -90 <= y0 <= 90 or not -90 <= last_y <= 90 or
                abs(last_y-expected_y)>1e-7 or abs((last_x-expected_x+180)%360-180)>1e-7):
            raise ValueError('grid extent/spacing/scanning differs from GRIB coordinates')
    x_first = (x0+180) % 360 - 180 if template in (0, 1) else x0
    west = x_first - ((nx-1)*dx if scan & 128 else 0) - dx/2
    south = y0 - (0 if scan & 64 else (ny-1)*dy) - dy/2
    crs = CRS.from_proj4(proj)
    body = {'schema': 'hmc-grib-crs/1', 'template': template, 'earth_shape_code': raw[14],
            'semi_major_m': a, 'semi_minor_m': b, 'proj': proj, 'wkt': crs.to_wkt(),
            'rotation': rotation, 'configuration': config, 'defaults_used': sorted(set(used)),
            'datum_mode': datum_mode, 'prime_meridian_degrees': pm,
            'datum_operation': ('GRIB-declared WGS84 horizontal datum; preserve geographic angles'
                                if datum_mode == 'wgs84-angular' else
                                'explicit geocentric translation prototype assumption; not producer-confirmed'),
            'grid': {'shape_yx': [ny, nx], 'spacing_xy': [dx, dy],
                     'outer_edges_wsen': [west, south, west+nx*dx, south+ny*dy],
                     'scanning_mode': scan, 'units': 'degrees' if template in (0, 1) else 'm'}}
    digest = hashlib.sha256(canonical(body)).hexdigest()
    return {**body, 'id': 'urn:hmc:crs:'+digest, 'sha256': digest}


@lru_cache(maxsize=128)
def transformer(encoded: str) -> Transformer:
    """WGS84 h=configuration height -> source grid; inverse uses same pipeline."""
    spec = json.loads(encoded)
    config = spec['configuration']['values']
    a, b = spec['semi_major_m'], spec['semi_minor_m']
    tx, ty, tz = config['geocentric_translation_m']
    # Explicit Cartesian bridge avoids silently selecting an unknown datum shift.
    steps = (f'+proj=pipeline +step +proj=cart +ellps=WGS84 '
             f'+step +proj=helmert +x={tx} +y={ty} +z={tz} '
             f'+step +inv +proj=cart +a={a:.15g} +b={b:.15g} ')
    if spec.get('datum_mode') == 'wgs84-angular':
        # GRIB shape code 8 explicitly fixes the horizontal datum to WGS84
        # despite a spherical projection surface; its geographic angles must
        # not be changed by an assumed Cartesian datum operation.
        steps = '+proj=pipeline +step +proj=unitconvert +xy_in=deg +xy_out=rad '
    proj = spec['proj']
    if spec['template'] in (0, 1):
        if spec['template'] == 1:
            steps += '+step ' + proj + ' '
        else:
            steps += f'+step +inv +proj=longlat +a={a:.15g} +b={b:.15g} +pm={spec["prime_meridian_degrees"]} '
        steps += '+step +proj=unitconvert +xy_in=rad +xy_out=deg'
    else:
        steps += '+step ' + proj
    return Transformer.from_pipeline(steps)


def transform(spec: dict, x, y, *, inverse: bool = False):
    operation = transformer(canonical(spec).decode())
    height = spec['configuration']['values']['coordinate_height_m']
    z = np.zeros(np.broadcast(x, y).shape) + height
    if inverse and spec.get('datum_mode') != 'wgs84-angular':
        # Native cells are 2-D: their discarded ellipsoidal height is not zero.
        # Solve for that height so the geographic output lies on the SAME WGS84
        # height surface used by the forward operation, rather than reversing
        # Cartesian coordinates of the source reference surface itself.
        for _ in range(8):
            result = operation.transform(x, y, z, direction='INVERSE')
            difference = np.asarray(result[2]) - height
            z = z-difference
            if np.all(np.abs(difference[np.isfinite(difference)]) < 1e-7):
                break
        result = operation.transform(x, y, z, direction='INVERSE')
    else:
        result = operation.transform(x, y, z, direction='INVERSE' if inverse else 'FORWARD')
    return result[0], result[1]


def public_id(spec: dict) -> str:
    config = spec['configuration']['values']
    if (spec['template'] == 0 and spec['semi_major_m'] == spec['semi_minor_m'] == 6371229
            and config['prime_meridian_degrees'] == 0
            and config['geocentric_translation_m'] == [0, 0, 0]
            and config['coordinate_height_m'] == 0):
        # The existing public identifier continues to mean precisely its frozen
        # operation. The full per-message resolution/provenance has its own ID.
        return 'urn:hmc:crs:icon-sphere-6371229'
    return spec['id']
