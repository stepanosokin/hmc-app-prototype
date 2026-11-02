"""On-demand display derivatives of verified native cells; never canonical samples."""
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import zarr

from decoder.sampling import asset_path, canonical, read_values
from publication import native_display

CONTRACT_BYTES = Path(__file__).with_name('display-pyramid.v1.json').read_bytes()
CONTRACT = json.loads(CONTRACT_BYTES)
CONTRACT_SHA256 = hashlib.sha256(CONTRACT_BYTES).hexdigest()


def shape(item: dict, factor: int) -> list[int]:
    if factor not in CONTRACT['levels']:
        raise ValueError('Неизвестный уровень отображения.')
    return [math.ceil(n/factor) for n in item['metadata']['grid']['shape_yx']]


def reduce_axis(values: np.ndarray, valid: np.ndarray, edges: np.ndarray, axis: int):
    source, mask = np.moveaxis(values, axis, -1), np.moveaxis(valid, axis, -1)
    output = np.zeros((*source.shape[:-1], len(edges)-1), dtype=np.float64)
    validity = np.zeros(output.shape, dtype=bool)
    for index, (left, right) in enumerate(zip(edges[:-1], edges[1:])):
        lo, hi = math.floor(left), math.ceil(right)
        cells = np.arange(lo, hi)
        weights = np.maximum(0, np.minimum(right, cells+1)-np.maximum(left, cells))
        output[..., index] = np.sum(source[..., lo:hi]*weights, axis=-1)/(right-left)
        validity[..., index] = np.all(mask[..., lo:hi] | (weights == 0), axis=-1)
    return np.moveaxis(output, -1, axis), np.moveaxis(validity, -1, axis)


def render(root: Path, item: dict, factor: int, column: int, row: int) -> bytes:
    height, width = shape(item, factor)
    native_display.validate_address(column, row, [height, width])
    source_height, source_width = item['metadata']['grid']['shape_yx']
    # Match the native reader's supported input budget, even for small derived outputs.
    if math.ceil(source_height/256)*math.ceil(source_width/256) > 64:
        raise ValueError('Исходная сетка превышает лимит отображения.')
    x0, y0 = column*256-1, row*256-1
    left, bottom, right, top = max(0, x0), max(0, y0), min(width, x0+258), min(height, y0+258)
    xedges = np.arange(left, right+1, dtype=np.float64)*source_width/width
    yedges = np.arange(bottom, top+1, dtype=np.float64)*source_height/height
    sx, sy, ex, ey = math.floor(xedges[0]), math.floor(yedges[0]), math.ceil(xedges[-1]), math.ceil(yedges[-1])
    group = zarr.open_group(str(asset_path(root, item['zarr'])), mode='r', zarr_format=2)
    index = (slice(sy, ey), slice(sx, ex))
    source = read_values(group, item.get('data_variable', 'temperature'), index)
    valid = ~read_values(group, 'missing', index).astype(bool)
    encoded = np.where(valid, source, 0).astype('<f4')
    if (not np.all(np.isfinite(encoded)) or not np.all(np.isfinite(source[valid]))
            or np.any(np.abs(encoded[valid]-source[valid]) > item['metadata'].get('float32_abs_error_bound', .001))):
        raise ValueError('Исходное float32-кодирование превышает допуск.')
    values, mask = reduce_axis(encoded, valid, xedges-sx, 1)
    values, mask = reduce_axis(values, mask, yedges-sy, 0)
    output = np.zeros((258, 258), dtype='<f4')
    validity = np.zeros((258, 258), dtype='uint8')
    target = (slice(bottom-y0, top-y0), slice(left-x0, right-x0))
    output[target], validity[target] = np.where(mask, values, 0), mask
    if not np.all(np.isfinite(output)):
        raise ValueError('Неконечное значение производного отображения.')
    return output.tobytes()+validity.tobytes()


def metadata(root: Path, item: dict, factor: int) -> bytes:
    height, width = shape(item, factor)
    original = json.loads(native_display.metadata(root, item))
    if original['contract'] != 'hmc-native-display/3':
        raise ValueError('Пирамида требует профиль полей GRIB.')
    grid = dict(original['grid'])
    west, south, east, north = grid['outer_cell_edges_wsen']
    grid.update(shape_yx=[height, width], spacing_degrees_xy=[(east-west)/width, (north-south)/height])
    if 'spacing_xy' in grid:
        grid['spacing_xy'] = grid['spacing_degrees_xy']
    for name in ('cell_centres', 'coordinate_check'):
        grid.pop(name, None)
    grid_hash = hashlib.sha256(canonical(grid)).hexdigest()
    columns, rows = math.ceil(width/256), math.ceil(height/256)
    representatives = sorted({(min(c, columns-1), min(r, rows-1)) for c, r in native_display.CONTRACT['readiness']['representatives']})
    probes = []
    for column, row in representatives:
        payload = render(root, item, factor, column, row)
        probes.append({'column': column, 'row': row, 'sha256': hashlib.sha256(payload).hexdigest()})
    original['source_encoding_max_abs_error'] = original.pop('encoding_max_abs_error', None)
    original.update(CONTRACT)
    original.update(contract_sha256=CONTRACT_SHA256, display_level=factor,
        source_grid=original['grid'], grid=grid, display_grid_sha256=grid_hash,
        matrix='DisplayPyramid256-'+grid_hash, columns=[0, columns-1], rows=[0, rows-1],
        representative_blocks=probes, readiness_state='ready')
    # Request-time identity/prefix injection is shared with the native endpoint.
    for name in ('metadata_url', 'url_template'):
        original[name] = original[name].replace('{factor}', str(factor))
    return canonical(original)
