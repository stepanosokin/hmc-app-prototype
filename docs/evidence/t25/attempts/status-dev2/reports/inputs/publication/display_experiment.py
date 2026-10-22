"""Isolated T23a server-screen comparator; not an advertised publication contract."""

from pathlib import Path

import numpy as np
import zarr
from pyproj import Transformer

from decoder.sampling import asset_path, read_values
from publication.tiles import bilinear, encode
from publication.numerical import TO_NATIVE

FRAMES: dict[str, dict] = {
    'ortho': {'crs': '+proj=ortho +lat_0=50 +lon_0=20 +R=6378137', 'extent': 6378137., 'engine': 'server-screen-bilinear/1'},
    'laea': {'crs': 'EPSG:3576', 'extent': 5000000., 'engine': 'server-screen-bilinear/1'},
}


def render(root: Path, item: dict, mode: str) -> bytes:
    frame = FRAMES[mode]
    extent = float(frame['extent'])
    axis = (np.arange(258)+.5)/258*2*extent-extent
    x, y = np.meshgrid(axis, -axis)
    inverse = Transformer.from_crs(frame['crs'], 'EPSG:4326', always_xy=True)
    longitude, latitude = inverse.transform(x, y)
    eligible = np.isfinite(longitude) & np.isfinite(latitude)
    if mode == 'laea':
        eligible &= latitude >= 45
    lon, lat, _ = TO_NATIVE.transform(np.where(eligible, longitude, 0),
                                    np.where(eligible, latitude, 0), np.zeros(x.shape))
    group = zarr.open_group(str(asset_path(root, item['zarr'])), mode='r', zarr_format=2)
    grid = item['metadata']['grid']
    values, valid = bilinear(read_values(group, 'temperature'), read_values(group, 'missing').astype(bool),
                            lon, lat, grid['outer_cell_edges_wsen'], grid['spacing_degrees_xy'])
    valid &= eligible.astype('uint8')
    return encode(np.where(valid, values, 0), valid, 'f32')
