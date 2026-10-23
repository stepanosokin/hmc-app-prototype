"""Bound the public WMS image and identify context independently of QGIS defaults."""

import math
import re

MAX_MAP_SIZE = 512
MAX_IDENTIFY_SIZE = 16384


def integer(value: str, maximum: int, minimum: int = 1) -> int:
    if not re.fullmatch(r'[0-9]{1,5}', value) or not minimum <= int(value) <= maximum:
        raise ValueError('WMS dimension or pixel outside supported bounds')
    return int(value)


def check_dimensions(params: dict[str, str], limit: int) -> None:
    """Identify describes a virtual canvas, not an image to allocate or render."""
    identify = params.get('REQUEST') == 'GetFeatureInfo'
    maximum = MAX_IDENTIFY_SIZE if identify else min(MAX_MAP_SIZE, limit)
    for name in ('WIDTH', 'HEIGHT'):
        if name in params:
            integer(params[name], maximum)
    if identify:
        for pixel, dimension in (('I', 'WIDTH'), ('J', 'HEIGHT')):
            integer(params.get(pixel, ''), integer(params.get(dimension, ''), maximum)-1, 0)


def normalize(params: dict[str, str], limit: int) -> dict[str, str]:
    """Discard only validated presentation hints; preserve the selected pixel centre."""
    params = dict(params)
    check_dimensions(params, limit)
    for name in ('DPI', 'MAP_RESOLUTION'):
        if name in params:
            integer(params.pop(name), 1200)
    if 'FORMAT_OPTIONS' in params:
        if not re.fullmatch(r'dpi:[0-9]{1,4}', params['FORMAT_OPTIONS'], re.IGNORECASE):
            raise ValueError('unsupported WMS format option')
        integer(params.pop('FORMAT_OPTIONS').split(':')[1], 1200)
    if params.get('REQUEST') == 'GetLegendGraphic' and 'SCALE' in params:
        scale = float(params.pop('SCALE'))
        if not math.isfinite(scale) or not 0 < scale <= 1e12:
            raise ValueError('unsupported legend scale')
    if params.get('REQUEST') == 'GetFeatureInfo':
        width, height = int(params['WIDTH']), int(params['HEIGHT'])
        i, j = int(params['I']), int(params['J'])
        bbox = [float(value) for value in params.get('BBOX', '').split(',')]
        if (len(bbox) != 4 or not all(math.isfinite(value) and abs(value) <= 1e9 for value in bbox)
                or bbox[0] >= bbox[2] or bbox[1] >= bbox[3]):
            raise ValueError('unsupported identify extent')
        dx, dy = (bbox[2]-bbox[0])/width, (bbox[3]-bbox[1])/height
        # BBOX axis order is already CRS-specific. I follows its first axis,
        # except EPSG:4326 where WMS 1.3 declares latitude before longitude.
        if params.get('CRS') == 'EPSG:4326':
            dx, dy = (bbox[2]-bbox[0])/height, (bbox[3]-bbox[1])/width
            centre = (bbox[2]-(j+.5)*dx, bbox[1]+(i+.5)*dy)
        else:
            centre = (bbox[0]+(i+.5)*dx, bbox[3]-(j+.5)*dy)
        params.update(BBOX=','.join(format(value, '.17g') for value in
            (centre[0]-dx/2, centre[1]-dy/2, centre[0]+dx/2, centre[1]+dy/2)),
            WIDTH='1', HEIGHT='1', I='0', J='0')
    return params
