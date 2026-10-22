"""Candidate numeric encoder and native bilinear display sampler, contract v1."""

import io
import json
from pathlib import Path

import numpy as np
import zarr
from PIL import Image
from pyproj import Transformer

from decoder.sampling import read_values, asset_path

CONTRACT_PATH = Path(__file__).with_name('contract.v2.json')
CONTRACT = json.loads(CONTRACT_PATH.read_text())
MAP_TO_NATIVE = Transformer.from_pipeline('+proj=pipeline +step +inv +proj=webmerc +ellps=WGS84 '
    '+step +proj=cart +ellps=WGS84 +step +inv +proj=cart +R=6371229')
SIZE = 258


def coordinates(z: int, x: int, y: int) -> tuple[np.ndarray, np.ndarray]:
    if not (0 <= z <= 6 and 0 <= x < 2**z and 0 <= y < 2**z):
        raise ValueError('tile outside matrix bounds')
    # Integer global pixels make shared halo coordinates exactly identical.
    px = (x * 256 + np.arange(-1, 257) + 0.5) / (256 * 2**z)
    py = (y * 256 + np.arange(-1, 257) + 0.5) / (256 * 2**z)
    extent = np.pi * 6378137
    map_x, map_y = np.meshgrid((px*2-1)*extent, (1-py*2)*extent)
    lon, lat, _ = MAP_TO_NATIVE.transform(map_x, map_y, np.zeros(map_x.shape))
    return lon, lat


def bilinear(values: np.ndarray, missing: np.ndarray, lon: np.ndarray, lat: np.ndarray,
             bounds: list, spacing: list) -> tuple[np.ndarray, np.ndarray]:
    west, south, east, north = bounds
    dx, dy = spacing
    ny, nx = values.shape
    fx = np.clip((lon - west) / dx - 0.5, 0, nx - 1)
    fy = np.clip((lat - south) / dy - 0.5, 0, ny - 1)
    x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
    x1, y1 = np.minimum(x0 + 1, nx - 1), np.minimum(y0 + 1, ny - 1)
    wx, wy = fx - x0, fy - y0
    valid = (lon >= west) & (lon < east) & (lat >= south) & (lat < north)
    result = np.zeros(lon.shape)
    for xx, yy, weight in [(x0, y0, (1-wx)*(1-wy)), (x1, y0, wx*(1-wy)),
                           (x0, y1, (1-wx)*wy), (x1, y1, wx*wy)]:
        contributes = weight > 0
        valid &= ~(missing[yy, xx] & contributes)
        result += np.where(contributes, values[yy, xx], 0) * weight
    valid &= np.isfinite(result)
    return np.where(valid, result, 0), valid.astype('uint8')


def render(root: Path, item: dict, z: int, x: int, y: int) -> tuple[np.ndarray, np.ndarray]:
    group = zarr.open_group(str(asset_path(root, item['zarr'])), mode='r', zarr_format=2)
    grid = item['metadata']['grid']
    return bilinear(read_values(group, 'temperature'), read_values(group, 'missing').astype(bool),
                    *coordinates(z, x, y), grid['outer_cell_edges_wsen'], grid['spacing_degrees_xy'])


def encode(values: np.ndarray, valid: np.ndarray, encoding: str) -> bytes:
    if encoding == 'f32':
        return values.astype('<f4').tobytes() + valid.astype('uint8').tobytes()
    if encoding != 'png':
        raise ValueError('unknown tile encoding')
    if np.any((values[valid.astype(bool)] < 0) | (values[valid.astype(bool)] > 16777.215)):
        raise ValueError('temperature outside packed range')
    q = np.rint(values * 1000).astype('uint32')
    rgba = np.stack([(q >> 16) & 255, (q >> 8) & 255, q & 255, valid * 255], axis=-1).astype('uint8')
    stream = io.BytesIO()
    Image.fromarray(rgba).save(stream, format='PNG')
    return stream.getvalue()


def decode(payload: bytes, encoding: str, shape: tuple = (SIZE, SIZE)) -> tuple[np.ndarray, np.ndarray]:
    if encoding == 'f32':
        count = shape[0] * shape[1]
        if len(payload) != count * 5:
            raise ValueError('wrong tile byte count')
        return (np.frombuffer(payload[:count*4], dtype='<f4').reshape(shape),
                np.frombuffer(payload[count*4:], dtype='uint8').reshape(shape))
    rgba = np.asarray(Image.open(io.BytesIO(payload)).convert('RGBA')).astype('uint32')
    return ((rgba[..., 0]*65536 + rgba[..., 1]*256 + rgba[..., 2])*0.001,
            (rgba[..., 3] == 255).astype('uint8'))
