"""Explicit geographic GIS portrayal; canonical values remain in native Zarr."""

import math
from pathlib import Path

import numpy as np
import rasterio
from pyproj import CRS, Transformer
from rasterio.transform import from_origin
from rasterio.windows import Window

from decoder.source_crs import definition

RESOLUTION = .03125
GEOGRAPHIC = '+proj=longlat +R=6371229 +no_defs'


def axes(metadata: dict) -> tuple[Transformer, Transformer]:
    native = CRS.from_proj4(definition(metadata))
    geographic = CRS.from_proj4(GEOGRAPHIC)
    return (Transformer.from_crs(native, geographic, always_xy=True),
            Transformer.from_crs(geographic, native, always_xy=True))


def grid(metadata: dict) -> dict:
    w, s, e, n = metadata['grid']['outer_cell_edges_wsen']
    x, y = np.linspace(w, e, 513), np.linspace(s, n, 513)
    transform, _ = axes(metadata)
    _, lat = transform.transform(np.concatenate([x, x, np.full(513, w), np.full(513, e)]),
                                 np.concatenate([np.full(513, s), np.full(513, n), y, y]))
    south = max(-90., math.floor((float(np.min(lat))-RESOLUTION)/RESOLUTION)*RESOLUTION)
    north = min(90., math.ceil((float(np.max(lat))+RESOLUTION)/RESOLUTION)*RESOLUTION)
    # Whole longitude domain avoids clipping a footprint crossing the antimeridian.
    return {'crs': GEOGRAPHIC, 'srid': 100001, 'resampling': 'nearest-native-cell',
            'role': 'reprojected-gis-portrayal-not-canonical-native-grid',
            'bounds': [-180., south, 180., north], 'resolution_degrees': RESOLUTION,
            'shape_yx': [round((north-south)/RESOLUTION), round(360/RESOLUTION)]}


def native_indices(metadata: dict, lon: np.ndarray, lat: np.ndarray, *, independent: bool = False):
    if independent:
        rotation = metadata['source_crs']['rotation']
        if rotation['kind'] != 'ob_tran':
            raise ValueError('independent GIS reference requires spherical ob_tran')
        lam = np.deg2rad(lon-rotation['lon_0'])
        phi, pole = np.deg2rad(lat), np.deg2rad(rotation['o_lat_p'])
        x = np.rad2deg(np.arctan2(np.cos(phi)*np.sin(lam),
            np.sin(pole)*np.cos(phi)*np.cos(lam)+np.cos(pole)*np.sin(phi)))+rotation['o_lon_p']
        y = np.rad2deg(np.arcsin(np.clip(np.sin(pole)*np.sin(phi)-np.cos(pole)*np.cos(phi)*np.cos(lam),-1,1)))
    else:
        _, transform = axes(metadata)
        x, y = transform.transform(lon, lat)
    x = (x+180)%360-180
    w, s, e, n = metadata['grid']['outer_cell_edges_wsen']
    dx, dy = metadata['grid']['spacing_degrees_xy']
    ny, nx = metadata['grid']['shape_yx']
    valid = np.isfinite(x)&np.isfinite(y)&(x>=w)&(x<e)&(y>=s)&(y<n)
    rows = np.clip(np.floor((y-s)/dy),0,ny-1).astype(int)
    columns = np.clip(np.floor((x-w)/dx),0,nx-1).astype(int)
    return rows, columns, valid


def pixels(description: dict, row: int, count: int):
    ny, nx = description['shape_yx']
    w, s, e, n = description['bounds']
    step = description['resolution_degrees']
    return np.meshgrid(w+(np.arange(nx)+.5)*step, n-(np.arange(row,row+count)+.5)*step)


def write(path: Path, metadata: dict, values: np.ndarray, missing: np.ndarray) -> dict:
    description = grid(metadata)
    ny, nx = description['shape_yx']
    w, s, e, n = description['bounds']
    with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True, GDAL_NUM_THREADS='1'):
        with rasterio.open(path, 'w', driver='GTiff', width=nx, height=ny, count=1,
                           dtype='float32', crs=GEOGRAPHIC, transform=from_origin(w,n,RESOLUTION,RESOLUTION),
                           tiled=True, blockxsize=256, blockysize=256, compress='DEFLATE') as raster:
            for row in range(0,ny,64):
                count = min(64,ny-row)
                rr, cc, valid = native_indices(metadata,*pixels(description,row,count))
                valid &= ~missing[rr,cc]
                window = Window(0,row,nx,count)
                raster.write(np.where(valid,values[rr,cc],0).astype('float32'),1,window=window)
                raster.write_mask(valid.astype('uint8')*255,window=window)
            raster.update_tags(units=metadata['identity']['units'], field='T_G:surface:0',
                valid_time=metadata['valid_time'], source_crs=metadata['source_crs']['resolved_proj'],
                role=description['role'], resampling=description['resampling'],
                point_values='Canonical native values: manifest-backed Zarr point/EDR')
    return description


def check(path: Path, item: dict, baseline: np.ndarray, missing: np.ndarray) -> float:
    description = item['gis_derivative']
    error = 0.
    with rasterio.open(path) as raster:
        if (list(raster.shape) != description['shape_yx'] or list(raster.bounds) != description['bounds']
                or raster.crs.to_dict() != rasterio.crs.CRS.from_string(GEOGRAPHIC).to_dict()):
            raise ValueError(f'GIS derivative georeferencing changed: {raster.shape}, {raster.bounds}, {raster.crs.to_dict()}')
        for row in range(0,raster.height,64):
            count = min(64,raster.height-row)
            rr,cc,valid = native_indices(item['metadata'],*pixels(description,row,count),independent=True)
            valid &= ~missing[rr,cc]
            window = Window(0,row,raster.width,count)
            actual, mask = raster.read(1,window=window), raster.read_masks(1,window=window)>0
            if not np.array_equal(mask,valid):
                raise ValueError('GIS derivative mask/reference differ')
            if np.any(valid):
                error = max(error,float(np.max(np.abs(actual[valid].astype('float64')-baseline[rr[valid],cc[valid]]))))
        if error>.0001:
            raise ValueError('GIS derivative source-value precision failed')
    return error
