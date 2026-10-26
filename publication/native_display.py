"""Versioned native cells for one interpolation, independent of frozen v2 tiles."""

import hashlib
import json
import io
from pathlib import Path

import numpy as np
import zarr
from PIL import Image

from decoder.sampling import asset_path, canonical, read_values
from publication.domain import PublicationUnavailable, sampler

CONTRACT_PATH = Path(__file__).with_name('native-display.v1.json')
CONTRACT = json.loads(CONTRACT_PATH.read_bytes())
CONTRACT_SHA256 = hashlib.sha256(CONTRACT_PATH.read_bytes()).hexdigest()
BLOCK = CONTRACT['tile_size'][0]
SIZE = CONTRACT['stored_size'][0]
HEIGHT, WIDTH = CONTRACT['supported_grid']['shape_yx']
COLUMNS, ROWS = (WIDTH+BLOCK-1)//BLOCK, (HEIGHT+BLOCK-1)//BLOCK
CONTRACT_V2_PATH = Path(__file__).with_name('native-display.v2.json')
CONTRACT_V2 = json.loads(CONTRACT_V2_PATH.read_bytes())
CONTRACT_V2_SHA256 = hashlib.sha256(CONTRACT_V2_PATH.read_bytes()).hexdigest()


def profile(spec: dict | None, field_profile: str | None = None) -> tuple[dict, str, int]:
    if field_profile:
        payload = Path(__file__).with_name('native-display.v3.json').read_bytes()
        return json.loads(payload), hashlib.sha256(payload).hexdigest(), 3
    if spec:
        from decoder.grib_crs import public_id
        grid = spec['grid']
        if (public_id(spec) != CONTRACT['crs'] or grid['shape_yx'] != [HEIGHT, WIDTH]
                or grid['spacing_xy'] != CONTRACT['supported_grid']['spacing_degrees_xy']
                or grid['outer_edges_wsen'] != CONTRACT['supported_grid']['outer_cell_edges_wsen']):
            return CONTRACT_V2, CONTRACT_V2_SHA256, 2
    return CONTRACT, CONTRACT_SHA256, 1


def source(manifest: dict) -> tuple[Path, dict]:
    """Resolve verified immutable storage and detect loss even before cache hits."""
    try:
        numerical = sampler(manifest)
        identity = manifest['identity']
        item = next(item for item in numerical.manifest['fields']
                    if item['field'] == identity['field']
                    and item['metadata']['valid_time'] == identity['valid_time'])
        grid = item['metadata']['grid']
        if ((not item['metadata'].get('source_crs') and any(grid[name] != expected for name, expected in CONTRACT['supported_grid'].items()))
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
    contract,checksum,_ = profile(item['metadata'].get('source_crs'),item['metadata'].get('field_profile'))
    return (manifest['selection'], checksum, contract['engine'], contract['crs'],
            canonical({name: manifest['identity'][name] for name in CONTRACT['selection_identity']}),
            canonical(grid), *part)


def validate_address(column: int, row: int, shape: list | None = None) -> None:
    height, width = shape or [HEIGHT, WIDTH]
    if not (0 <= column < (width+BLOCK-1)//BLOCK and 0 <= row < (height+BLOCK-1)//BLOCK):
        raise ValueError(f'Блок вне нативной сетки: column 0..{(width+BLOCK-1)//BLOCK-1}, row 0..{(height+BLOCK-1)//BLOCK-1}.')


def render(root: Path, item: dict, column: int, row: int) -> bytes:
    height, width = item['metadata']['grid']['shape_yx']
    validate_address(column, row, [height, width])
    x0, y0 = column * BLOCK - 1, row * BLOCK - 1
    left, bottom, right, top = max(0, x0), max(0, y0), min(width, x0+SIZE), min(height, y0+SIZE)
    group = zarr.open_group(str(asset_path(root, item['zarr'])), mode='r', zarr_format=2)
    index = (slice(bottom, top), slice(left, right))
    values = read_values(group, item.get('data_variable', 'temperature'), index)
    missing = read_values(group, 'missing', index).astype(bool)
    if not np.all(np.isfinite(values[~missing])):
        raise ValueError('non-finite native display value')
    encoded = np.where(missing, 0, values).astype('<f4')
    bound = item['metadata'].get('float32_abs_error_bound', .001)
    if not np.all(np.isfinite(encoded)) or np.any(np.abs(encoded[~missing]-values[~missing]) > bound):
        raise ValueError('native encoding exceeds approved error')
    result = np.zeros((SIZE, SIZE), dtype='<f4')
    valid = np.zeros((SIZE, SIZE), dtype='uint8')
    target = (slice(bottom-y0, top-y0), slice(left-x0, right-x0))
    result[target], valid[target] = encoded, ~missing
    return result.tobytes() + valid.tobytes()


def portrayal(root: Path, item: dict, column: int, row: int) -> bytes:
    """T19 cached-image comparator; colours never become canonical numbers."""
    payload=render(root,item,column,row)
    values=np.frombuffer(payload[:SIZE*SIZE*4],dtype='<f4').reshape(SIZE,SIZE)
    mask=np.frombuffer(payload[SIZE*SIZE*4:],dtype='uint8').reshape(SIZE,SIZE)
    low,high=(item['metadata']['values'][key] for key in ('min','max')) if item['metadata'].get('field_profile') else (253.15,313.15)
    stops=np.array([[114,114,181],[82,154,189],[112,200,178],[214,214,127],[237,171,104],[201,103,97]],dtype=float)
    scale=np.clip((values-low)/max(high-low,1e-30),0,1)*5
    left=np.minimum(scale.astype(int),4);fraction=scale-left
    colors=np.rint(stops[left]*(1-fraction[...,None])+stops[left+1]*fraction[...,None]).astype('uint8')
    rgba=np.dstack((colors,mask*255));rgba[mask==0]=0
    output=io.BytesIO();Image.fromarray(rgba).save(output,format='PNG')
    return output.getvalue()


def metadata(root: Path, item: dict) -> bytes:
    contract, contract_hash, _ = profile(item['metadata'].get('source_crs'),item['metadata'].get('field_profile'))
    height, width = item['metadata']['grid']['shape_yx']
    columns, rows = (width+BLOCK-1)//BLOCK, (height+BLOCK-1)//BLOCK
    if columns*rows > contract['limits']['blocks']:
        raise ValueError('Сетка превышает лимит числовых блоков браузера')
    probes = []
    representatives = sorted({(min(c,columns-1),min(r,rows-1)) for c,r in CONTRACT['readiness']['representatives']})
    for column, row in representatives:
        payload = render(root, item, column, row)
        if payload != render(root, item, column, row):
            raise ValueError('native readiness is not deterministic')
        probes.append({'column': column, 'row': row, 'sha256': hashlib.sha256(payload).hexdigest()})
    left = np.frombuffer(render(root, item, 0, 0)[:SIZE*SIZE*4], dtype='<f4').reshape(SIZE, SIZE)
    if columns > 1:
        right = np.frombuffer(render(root, item, 1, 0)[:SIZE*SIZE*4], dtype='<f4').reshape(SIZE, SIZE)
        if not np.array_equal(left[:, -2:], right[:, :2]):
            raise ValueError('native representative halo mismatch')
    spec = item['metadata'].get('source_crs')
    extra = {}
    if spec:
        from decoder.grib_crs import public_id
        extra = {'source_crs': spec, 'crs': public_id(spec), 'crs_definition': spec['proj']}
    if item['metadata'].get('field_profile'):
        extra.update(units=item['metadata']['identity']['units'],
                     encoding_max_abs_error=item['metadata']['float32_abs_error_bound'],
                     display_range=[item['metadata']['values']['min'], item['metadata']['values']['max']],
                     interval=item['metadata']['interval'])
        if 'uv_relative_to_grid' in item['metadata']['identity']:
            extra['uv_relative_to_grid']=item['metadata']['identity']['uv_relative_to_grid']
    return canonical({**contract, 'contract_sha256': contract_hash,
        'matrix': CONTRACT['matrix_prefix'] + item['metadata']['native_grid_sha256'],
        'grid': item['metadata']['grid'], 'columns': [0, columns-1], 'rows': [0, rows-1],
        **extra,
        'representative_blocks': probes, 'readiness_state': 'ready'})
