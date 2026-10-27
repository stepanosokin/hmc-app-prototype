"""Shared native-cell selection for both future numerical adapters.

These are validated TEST manifests, not publication/catalogue authority.
Construct once per immutable manifest, then reuse for requests.
"""

import hashlib
import json
import math
from pathlib import Path
from typing import Any

import zarr
import numpy as np

from decoder.inspect_forecast import require


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def file_hash(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def asset_path(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    require(path.is_relative_to(root.resolve()), 'asset escapes manifest directory')
    return path


def read_values(group: zarr.Group, name: str, index: Any = ...) -> np.ndarray:
    array = group[name]
    require(isinstance(array, zarr.Array), f'expected Zarr array: {name}')
    if not isinstance(array, zarr.Array):
        raise TypeError(name)
    return np.asarray(array[index])


class ManifestSampler:
    def __init__(self, path: Path):
        self.root = path.parent
        self.manifest = json.loads(path.read_text(encoding='utf-8'))
        body = dict(self.manifest)
        self.revision = body.pop('revision')
        require(hashlib.sha256(canonical(body)).hexdigest() == self.revision, 'manifest checksum mismatch')
        require(body['schema_version'] == 1 and body['state'] == 'validated-test', 'not a validated test manifest')
        for name, expected in body['assets'].items():
            asset = asset_path(self.root, name)
            require(asset.is_file() and asset.stat().st_size == expected['bytes']
                    and file_hash(asset) == expected['sha256'], f'asset integrity failed: {name}')

    def sample(self, *, run: str, revision: str, field: str, valid_time: str,
               lon: float, lat: float) -> dict[str, Any]:
        if run != self.manifest['run'] or revision != self.revision:
            raise KeyError('unavailable run/revision')
        selected = [item for item in self.manifest['fields']
                    if item['field'] == field and item['metadata']['valid_time'] == valid_time]
        if len(selected) != 1:
            raise KeyError('unavailable field/time')
        item = selected[0]
        angular = item['metadata'].get('source_crs', {}).get('template', 0) in (0, 1)
        require(math.isfinite(lon) and math.isfinite(lat) and (not angular or -90 <= lat <= 90), 'invalid position')
        if angular:
            lon = (lon + 180) % 360 - 180
        grid = item['metadata']['grid']
        west, south, east, north = grid['outer_cell_edges_wsen']
        result: dict[str, Any] = {'run': run, 'revision': revision, 'field': field, 'valid_time': valid_time,
                  'units': item['metadata']['identity']['units'], 'method': 'native_cell',
                  'value': None, 'cell': None, 'reason': 'outside_coverage',
                  'source': self.manifest['source'], 'batch': item['zarr']}
        # Half-open footprint; exact internal ties select the east/north cell.
        if not (west <= lon < east and south <= lat < north):
            return result
        dx, dy = grid['spacing_degrees_xy']
        column, row = math.floor((lon - west) / dx), math.floor((lat - south) / dy)
        group = zarr.open_group(str(asset_path(self.root, item['zarr'])), mode='r', zarr_format=2)
        result['cell'] = {'row': row, 'column': column,
                          'lon': float(read_values(group, 'longitude', column)), 'lat': float(read_values(group, 'latitude', row))}
        if bool(read_values(group, 'missing', (row, column))):
            result['reason'] = 'native_nodata'
            if 'missing_reason' in group:
                result['nodata_reason'] = ('source_missing' if int(read_values(group, 'missing_reason', (row, column))) == 1
                                           else 'rejected_value')
        else:
            value = float(read_values(group, item.get('data_variable', 'temperature'), (row, column)))
            require(math.isfinite(value), 'non-finite unmasked stored value')
            result.update(value=value, reason=None)
        return result
