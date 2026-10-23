"""Versioned native cells for one interpolation, independent of frozen v2 tiles."""

import hashlib
import json
from pathlib import Path

import numpy as np
import zarr

from decoder.sampling import asset_path, canonical, read_values
from decoder.source_crs import LEGACY_ID, identifier
from publication.domain import PublicationUnavailable, sampler

CONTRACT_PATH = Path(__file__).with_name('native-display.v1.json')
CONTRACT = json.loads(CONTRACT_PATH.read_bytes())
CONTRACT_SHA256 = hashlib.sha256(CONTRACT_PATH.read_bytes()).hexdigest()
CRS_CONTRACT_PATH = Path(__file__).with_name('native-display.v2.json')
CRS_CONTRACT = json.loads(CRS_CONTRACT_PATH.read_bytes())
CRS_CONTRACT_SHA256 = hashlib.sha256(CRS_CONTRACT_PATH.read_bytes()).hexdigest()
BLOCK = CONTRACT['tile_size'][0]
SIZE = CONTRACT['stored_size'][0]
HEIGHT, WIDTH = CONTRACT['supported_grid']['shape_yx']
COLUMNS, ROWS = (WIDTH+BLOCK-1)//BLOCK, (HEIGHT+BLOCK-1)//BLOCK


def source(manifest: dict) -> tuple[Path, dict]:
    """Resolve verified immutable storage and detect loss even before cache hits."""
    try:
        numerical = sampler(manifest)
        identity = manifest['identity']
        item = next(item for item in numerical.manifest['fields']
                    if item['field'] == identity['field']
                    and item['metadata']['valid_time'] == identity['valid_time'])
        grid = item['metadata']['grid']
        if (any(grid[name] != expected for name, expected in CONTRACT['supported_grid'].items())
                or item['metadata']['native_grid_sha256'] != identity['native_grid_sha256']):
            raise ValueError('unsupported native display grid')
        for name, expected in numerical.manifest['assets'].items():
            if name.startswith(item['zarr'] + '/'):
                if asset_path(numerical.root, name).stat().st_size != expected['bytes']:
                    raise OSError('native storage length changed')
        return numerical.root, item
    except (OSError, KeyError, ValueError, StopIteration, RuntimeError) as error:
        raise PublicationUnavailable('native display unavailable') from error


def key(manifest: dict, item: dict, *part) -> tuple:
    grid = item['metadata']['grid']
    return (manifest['selection'], CRS_CONTRACT_SHA256 if identifier(item['metadata']) != LEGACY_ID else CONTRACT_SHA256,
            CONTRACT['engine'], identifier(item['metadata']),
            canonical({name: manifest['identity'][name] for name in CONTRACT['selection_identity']}),
            canonical(grid), *part)


def validate_address(column: int, row: int) -> None:
    if not (0 <= column < COLUMNS and 0 <= row < ROWS):
        raise ValueError('Блок вне нативной сетки: column 0..5, row 0..2.')


def render(root: Path, item: dict, column: int, row: int) -> bytes:
    validate_address(column, row)
    height, width = item['metadata']['grid']['shape_yx']
    x0, y0 = column * BLOCK - 1, row * BLOCK - 1
    left, bottom, right, top = max(0, x0), max(0, y0), min(width, x0+SIZE), min(height, y0+SIZE)
    group = zarr.open_group(str(asset_path(root, item['zarr'])), mode='r', zarr_format=2)
    index = (slice(bottom, top), slice(left, right))
    values = read_values(group, 'temperature', index)
    missing = read_values(group, 'missing', index).astype(bool)
    if not np.all(np.isfinite(values[~missing])):
        raise ValueError('non-finite native display value')
    encoded = np.where(missing, 0, values).astype('<f4')
    if not np.all(np.isfinite(encoded)) or np.any(np.abs(encoded[~missing]-values[~missing]) > .001):
        raise ValueError('native encoding exceeds approved error')
    result = np.zeros((SIZE, SIZE), dtype='<f4')
    valid = np.zeros((SIZE, SIZE), dtype='uint8')
    target = (slice(bottom-y0, top-y0), slice(left-x0, right-x0))
    result[target], valid[target] = encoded, ~missing
    return result.tobytes() + valid.tobytes()


def metadata(root: Path, item: dict) -> bytes:
    probes = []
    for column, row in CONTRACT['readiness']['representatives']:
        payload = render(root, item, column, row)
        if payload != render(root, item, column, row):
            raise ValueError('native readiness is not deterministic')
        probes.append({'column': column, 'row': row, 'sha256': hashlib.sha256(payload).hexdigest()})
    left = np.frombuffer(render(root, item, 0, 0)[:SIZE*SIZE*4], dtype='<f4').reshape(SIZE, SIZE)
    right = np.frombuffer(render(root, item, 1, 0)[:SIZE*SIZE*4], dtype='<f4').reshape(SIZE, SIZE)
    if not np.array_equal(left[:, -2:], right[:, :2]):
        raise ValueError('native representative halo mismatch')
    corrected = identifier(item['metadata']) != LEGACY_ID
    contract = {**CONTRACT, **CRS_CONTRACT} if corrected else CONTRACT
    return canonical({**contract, 'contract_sha256': CRS_CONTRACT_SHA256 if corrected else CONTRACT_SHA256,
        'crs': identifier(item['metadata']), 'crs_definition': item['metadata'].get('native_crs_wkt', CONTRACT['crs_definition']),
        'source_crs': item['metadata'].get('source_crs'),
        'matrix': CONTRACT['matrix_prefix'] + item['metadata']['native_grid_sha256'],
        'grid': item['metadata']['grid'], 'columns': [0, COLUMNS-1], 'rows': [0, ROWS-1],
        'representative_blocks': probes, 'readiness_state': 'ready'})
