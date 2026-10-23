"""Resolve source coordinates once; immutable publications never reread configuration."""

import hashlib
import math
import os
from functools import lru_cache
from pathlib import Path

from pyproj import CRS, Transformer

LEGACY_ID = 'urn:hmc:crs:icon-sphere-6371229'
LEGACY_PROJ = '+proj=longlat +R=6371229 +no_defs'
DATUM = 'WGS84 h=0 -> WGS84 Cartesian -> source ellipsoid Cartesian inverse; zero geocentric shift prototype hypothesis, not producer-confirmed'


def resolve(path: Path | None = None, earth_radius: float = 6371229) -> dict:
    """External override, GRIB shape fallback; never change the source text."""
    path = path or Path(os.environ.get('GRIB_CRS_FILE', '/input/proj.txt'))
    raw = None
    reason = None
    try:
        raw = path.read_bytes()
        if len(raw) > 16384:
            raise ValueError('source CRS exceeds 16 KiB')
        text = raw.decode('utf-8-sig').strip()
        if not text or not text.startswith('+proj='):
            raise ValueError('expected a PROJ string')
        parameters = {token.lstrip('+').split('=', 1)[0] for token in text.split()}
        completed = text
        if not any(key in parameters for key in ('R', 'a', 'ellps', 'datum')):
            completed += f' +R={earth_radius:.16g}'
        crs = CRS.from_proj4(completed)
        if not (crs.is_geographic or crs.is_projected):
            raise ValueError('expected a horizontal CRS')
        # Construct both directions before accepting the override.
        transformation(completed)
        source = 'proj.txt'
    except (OSError, UnicodeError, ValueError, RuntimeError) as error:
        completed = f'+proj=longlat +R={earth_radius:.16g} +no_defs'
        crs = CRS.from_proj4(completed)
        source = 'GRIB'
        reason = 'missing' if isinstance(error, FileNotFoundError) else 'invalid'
    fingerprint = hashlib.sha256(crs.to_wkt().encode()).hexdigest()
    ellipsoid = crs.ellipsoid
    assert ellipsoid is not None
    legacy = crs.equals(CRS.from_proj4(LEGACY_PROJ), ignore_axis_order=True)
    return {'schema': 'hmc-source-crs/1', 'id': LEGACY_ID if legacy else 'urn:hmc:crs:' + fingerprint,
            'source': source, 'fallback_reason': reason,
            'file_sha256': hashlib.sha256(raw).hexdigest() if raw is not None else None,
            'source_text': raw.decode('utf-8-sig', errors='replace') if raw is not None else None,
            'resolved_proj': completed, 'wkt': crs.to_wkt(), 'sha256': fingerprint,
            'semi_major_m': ellipsoid.semi_major_metre, 'semi_minor_m': ellipsoid.semi_minor_metre,
            'datum_operation': DATUM, 'producer_control_point': False,
            'rotation': rotation(completed)}


def rotation(proj: str) -> dict:
    parameters = dict(token.lstrip('+').split('=', 1) for token in proj.split() if '=' in token)
    if parameters.get('proj') == 'longlat':
        return {'kind': 'identity', 'o_lon_p': 0., 'o_lat_p': 90., 'lon_0': 0.}
    if parameters.get('proj') == 'ob_tran' and parameters.get('o_proj') in ('longlat', 'latlong', 'lonlat'):
        return {'kind': 'ob_tran', **{key: float(parameters.get(key, '0')) for key in ('o_lon_p', 'o_lat_p', 'lon_0')}}
    return {'kind': 'unsupported-native-display'}


def definition(metadata: dict) -> str:
    return metadata.get('source_crs', {}).get('resolved_proj', LEGACY_PROJ)


def identifier(metadata: dict) -> str:
    return metadata.get('source_crs', {}).get('id', LEGACY_ID)


@lru_cache(maxsize=64)
def transformation(proj: str = LEGACY_PROJ, mercator: bool = False) -> Transformer:
    """WGS84 geodetic h=0 to source coordinates; source angular axes in degrees."""
    crs = CRS.from_proj4(proj)
    ellipsoid = crs.ellipsoid
    assert ellipsoid is not None
    a, b = ellipsoid.semi_major_metre, ellipsoid.semi_minor_metre
    shape = f'+a={a:.16g} +b={b:.16g}'
    start = '+step +inv +proj=webmerc +ellps=WGS84 ' if mercator else ''
    parameters = ' '.join(token for token in proj.split()
                          if not token.startswith(('+type=', '+to_meter=', '+units=', '+towgs84=')))
    angular = '+step +proj=unitconvert +xy_in=rad +xy_out=deg' if crs.is_geographic else ''
    # PROJ ob_tran/longlat is angular: pipeline output radians are converted by
    # pyproj to degrees. to_meter is not a multiplier of native angular axes.
    return Transformer.from_pipeline('+proj=pipeline ' + start +
        '+step +proj=cart +ellps=WGS84 +step +inv +proj=cart ' + shape +
        ' +step ' + parameters + ' ' + angular)


def to_wgs84(x: float, y: float, metadata: dict) -> tuple[float, float]:
    """Intersect the source geocentric ray with WGS84 h=0 (same native cell)."""
    crs = CRS.from_proj4(definition(metadata))
    ellipsoid = crs.ellipsoid
    assert ellipsoid is not None
    base = CRS.from_proj4(f'+proj=longlat +a={ellipsoid.semi_major_metre} +b={ellipsoid.semi_minor_metre}')
    lon, lat = Transformer.from_crs(crs, base, always_xy=True).transform(x, y)
    # Equal geocentric latitude, with explicit zero geocentric shift.
    native_e2 = 1 - (ellipsoid.semi_minor_metre / ellipsoid.semi_major_metre) ** 2
    wgs_e2 = 0.0066943799901413165
    phi = math.radians(lat)
    return lon, math.degrees(math.atan2((1-native_e2)*math.sin(phi), (1-wgs_e2)*math.cos(phi)))


def apply(metadata: dict, value: dict) -> dict:
    """Keep raw Section 3 identity, bind corrected grid identity to resolved CRS."""
    metadata['source_crs'] = value
    metadata['native_crs_wkt'] = value['wkt']
    if value['id'] != LEGACY_ID:
        raw = metadata['native_grid_sha256']
        metadata['raw_native_grid_sha256'] = raw
        metadata['native_grid_sha256'] = hashlib.sha256((raw + value['sha256']).encode()).hexdigest()
    return metadata
