"""Physical colour scales shared by GPU metadata, cached images and WMS."""
import json
from functools import lru_cache
from pathlib import Path

import numpy as np

VERSION = 'earth-palette/1'


@lru_cache(maxsize=1)
def catalogue() -> dict:
    return json.loads((Path(__file__).parents[1] / 'config' / 'earth-palettes.json').read_bytes())


@lru_cache(maxsize=5)
def scale(key: str) -> dict:
    """One shared 250-colour table leaves room for GeoServer's NoData entries."""
    source = catalogue()['palettes'][key]
    colors = np.asarray(source['colors'], dtype='uint8').reshape(-1, 4)
    indices = np.floor(np.linspace(0, len(colors)-1, 250)+.5).astype(int)
    return {'range': source['range'], 'colors': colors[indices].reshape(-1).tolist()}


def select(metadata: dict) -> dict | None:
    identity = metadata['identity']
    raw = metadata.get('raw_identity', {})
    quantity = tuple(raw.get(key) for key in ('discipline', 'parameterCategory', 'parameterNumber'))
    units, surface = identity['units'], identity.get('typeOfLevel')
    interval = metadata.get('interval')
    ordinary = not interval
    key = None
    # Match quantities, surfaces and temporal semantics, never UI groups.
    if units == 'K' and ordinary and surface in ('heightAboveGround', 'isobaricInhPa', 'isobaricInPa'):
        if quantity == (0, 0, 0) or quantity == (0, 0, 6) and surface == 'heightAboveGround' and identity.get('level') == 2:
            key = 'temperature'
    if units == '%' and ordinary and quantity == (0, 1, 1):
        key = 'relative-humidity'
    if units in ('Pa', 'hPa') and ordinary and quantity == (0, 3, 1) and surface == 'meanSea':
        key = 'mslp'
    if units == 'm s**-1' and ordinary and quantity == (0, 2, 1):
        key = 'wind'
    if quantity == (0, 1, 8) and units in ('kg m**-2', 'm') and interval and interval['statistical_process'] == 1:
        from datetime import datetime
        duration = datetime.fromisoformat(interval['end']) - datetime.fromisoformat(interval['start'])
        if duration.total_seconds() == 10800:
            key = 'precip-3h'
    if key is None:
        return None
    selected = scale(key)
    # LUT thresholds are in source units. Numerical values are never converted.
    factor = .01 if key == 'mslp' and units == 'hPa' else .001 if key == 'precip-3h' and units == 'm' else 1.
    return {'id': key, 'version': VERSION, 'range': [v * factor for v in selected['range']],
            'colors': selected['colors'], 'source_sha256': catalogue()['source']['sha256']}


def rgb(values: np.ndarray, palette: dict) -> np.ndarray:
    low, high = palette['range']
    colors = np.asarray(palette['colors'], dtype='uint8').reshape(-1, 4)[:, :3]
    indices = np.floor(np.clip((values-low)/(high-low), 0, 1)*(len(colors)-1)).astype(int)
    return colors[indices]


def entries(palette: dict) -> list[tuple[float, str]]:
    """Exact 250-colour WMS knots; reserve slots for zero and NoData."""
    colors = np.asarray(palette['colors'], dtype=float).reshape(-1, 4)[:, :3]
    if len(colors) > 250:
        raise ValueError('WMS palette exceeds the shared colour budget')
    selected = {0, len(colors)-1}
    selected.update(range(len(colors)))
    low, high = palette['range']
    return [(low+(high-low)*i/(len(colors)-1), '#' + ''.join(f'{int(c):02x}' for c in colors[i]))
            for i in sorted(selected)]
