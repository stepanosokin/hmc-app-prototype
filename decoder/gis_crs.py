"""Explicit nearest-cell WGS84 GIS derivative, separate from native values."""
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rasterio.shutil import copy as raster_copy

from decoder.grib_crs import transform
from decoder.sampling import read_values, asset_path
import zarr


def derivative(root: Path, item: dict, target: Path) -> dict:
    spec = item['metadata']['source_crs']
    grid = item['metadata']['grid']
    w,s,e,n = grid['outer_cell_edges_wsen']
    t = np.linspace(0,1,257)
    xx = np.concatenate([w+(e-w)*t, np.full(t.shape,e), e-(e-w)*t, np.full(t.shape,w)])
    yy = np.concatenate([np.full(t.shape,s), s+(n-s)*t, np.full(t.shape,n), n-(n-s)*t])
    lon,lat = transform(spec,xx,yy,inverse=True)
    finite = np.isfinite(lon)&np.isfinite(lat)
    if not finite.any():
        raise ValueError('Не удалось определить покрытие производного ГИС-растра')
    bounds = [float(lon[finite].min()),float(lat[finite].min()),float(lon[finite].max()),float(lat[finite].max())]
    contained_poles=[]
    if item['metadata'].get('field_profile'):
        for pole in (-90,90):
            px,py=transform(spec,0,pole)
            if w<=px<e and s<=py<n:contained_poles.append(pole)
    if contained_poles:
        # A geographic pole in the interior cannot be found by sampling the
        # perimeter alone. Its footprint spans every longitude. Keep the
        # existing bounded nearest-cell GIS derivative, with explicit extent.
        bounds[0],bounds[2]=-180.,180.
        if -90 in contained_poles:bounds[1]=-90.
        if 90 in contained_poles:bounds[3]=90.
    elif bounds[2]-bounds[0]>180:
        raise ValueError('ГИС-покрытие через антимеридиан требует отдельного разбиения')
    ny,nx = grid['shape_yx']
    scale = max(1.,np.sqrt(nx*ny/2000000))
    width,height = max(2,round(nx/scale)),max(2,round(ny/scale))
    affine = from_bounds(*bounds,width,height)
    group = zarr.open_group(str(asset_path(root,item['zarr'])),mode='r',zarr_format=2)
    values = read_values(group,item.get('data_variable','temperature'))
    missing = read_values(group,'missing').astype(bool)
    output = np.zeros((height,width),dtype='<f4')
    valid = np.zeros((height,width),dtype='uint8')
    dx,dy = grid['spacing_degrees_xy']
    for first in range(0,height,128):
        rows = np.arange(first,min(height,first+128))
        x,y = np.meshgrid(affine.c+(np.arange(width)+.5)*affine.a,affine.f+(rows+.5)*affine.e)
        source_x,source_y = transform(spec,x,y)
        mask = np.isfinite(source_x)&np.isfinite(source_y)&(source_x>=w)&(source_x<e)&(source_y>=s)&(source_y<n)
        col = np.clip(np.floor(np.where(mask,(source_x-w)/dx,0)),0,nx-1).astype(int)
        row = np.clip(np.floor(np.where(mask,(source_y-s)/dy,0)),0,ny-1).astype(int)
        mask &= ~missing[row,col]
        output[first:first+len(rows)] = np.where(mask,values[row,col],0).astype('<f4')
        valid[first:first+len(rows)] = mask*255
    temporary = target.with_suffix('.working.tif')
    output[valid == 0] = np.nan
    with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True):
        with rasterio.open(temporary,'w',driver='GTiff',width=width,height=height,count=1,
                           crs='EPSG:4326',transform=affine,dtype='float32',nodata=float('nan'),tiled=True,
                           blockxsize=256,blockysize=256,compress='DEFLATE') as raster:
            raster.write(output,1)
            raster.write_mask(valid)
            raster.update_tags(derived='true',resampling='nearest-native-cell',
                               source_crs=spec['id'],point_values='Use native Zarr point/EDR')
        raster_copy(temporary,target,driver='COG',COMPRESS='DEFLATE',BLOCKSIZE=256)
    temporary.unlink()
    return {'derived':True,'crs':'EPSG:4326','resampling':'nearest-native-cell',
            **({'contained_geographic_poles':contained_poles,'extent_method':'densified-boundary-and-contained-poles'} if contained_poles else {}),
            'source_crs':spec['id'],'bounds':bounds,'shape_yx':[height,width]}
