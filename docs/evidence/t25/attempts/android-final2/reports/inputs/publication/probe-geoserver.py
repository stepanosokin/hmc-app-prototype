"""Private actual-sample numerical GeoServer experiment; not a public route."""

import json
import time
import uuid
from pathlib import Path

import numpy as np
import requests
from rasterio.io import MemoryFile
from morecantile import tms, Tile

from decoder.sampling import ManifestSampler, canonical
from publication import geoserver
from publication.tiles import render


def main() -> None:
    for attempt in range(60):
        try:
            geoserver.admin('GET', '/about/version.json')
            break
        except requests.RequestException:
            time.sleep(2)
    workspace = 'compare' + uuid.uuid4().hex[:12]
    root = Path('/assets/comparison')
    sampler = ManifestSampler(root / 'manifest.json')
    item = sampler.manifest['fields'][0]
    result = {'engine': 'GeoServer 2.27.0', 'source': sampler.manifest['source'], 'outputs': []}
    geoserver.admin('POST', '/workspaces', json={'workspace': {'name': workspace}})
    geoserver.admin('PUT', f'/workspaces/{workspace}/coveragestores/temperature/external.geotiff?configure=all',
                     data=str(root / item['cog']), headers={'Content-Type':'text/plain'})
    coverages = geoserver.admin('GET', f'/workspaces/{workspace}/coveragestores/temperature/coverages.json').json()
    name = coverages['coverages']['coverage'][0]['name']
    geoserver.admin('PUT', f'/workspaces/{workspace}/coveragestores/temperature/coverages/{name}.json',
                     json={'coverage':{'srs':'EPSG:100001','projectionPolicy':'FORCE_DECLARED','enabled':True}})
    gis = {'workspace':workspace, 'layer':workspace+':'+name}
    for z, x, y in [[3,4,2],[6,35,21]]:
        box = tms.get('WebMercatorQuad').xy_bounds(Tile(x,y,z))
        pixel = (box.right-box.left)/256
        bounds = [box.left-pixel, box.bottom-pixel, box.right+pixel, box.top+pixel]
        params = {'SERVICE':'WMS','VERSION':'1.3.0','REQUEST':'GetMap','LAYERS':gis['layer'],
                  'STYLES':'','CRS':'EPSG:3857','BBOX':','.join(map(str,bounds)),
                  'WIDTH':258,'HEIGHT':258,'FORMAT':'image/geotiff','TRANSPARENT':'true'}
        for protocol in ['WMS','WCS']:
          try:
            if protocol == 'WMS':
                response = geoserver.wms(gis,params)
            else:
                response = requests.get(geoserver.BASE+'/'+workspace+'/wcs',params={
                    'SERVICE':'WCS','VERSION':'1.0.0','REQUEST':'GetCoverage','COVERAGE':gis['layer'],
                    'CRS':'EPSG:3857','RESPONSE_CRS':'EPSG:3857','BBOX':params['BBOX'],
                    'WIDTH':258,'HEIGHT':258,'FORMAT':'GeoTIFF','INTERPOLATION':'bilinear'},timeout=60)
                response.raise_for_status()
            with MemoryFile(response.content) as mem:
                with mem.open() as raster:
                    array, mask = raster.read(1), raster.dataset_mask()>0
                    reference, valid = render(root,item,z,x,y)
                    common = mask & valid.astype(bool) & np.isfinite(array)
                    result['outputs'].append({'protocol':protocol, 'zxy':[z,x,y], 'dtype':raster.dtypes,
                        'bands':raster.count,'content_type':response.headers['Content-Type'],
                        'nonfinite_valid':int(np.count_nonzero(mask & ~np.isfinite(array))),
                        'mask_differences':int(np.count_nonzero(mask != valid)),
                        'max_abs_error_K':float(np.max(np.abs(array[common]-reference[common]))) if np.any(common) else None})
          except Exception as error:
            result['outputs'].append({'protocol':protocol, 'zxy':[z,x,y], 'error':type(error).__name__, 'detail':str(error)[:1500]})
    result['status'] = 'rejected-numeric-contract' if any(
        item.get('error') or item.get('max_abs_error_K') is None or item.get('max_abs_error_K',1)>0.01
        or item.get('mask_differences',1) for item in result['outputs']) else 'needs-full-mask-halo-time-validation'
    Path('/evidence/geoserver-numeric.json').write_bytes(canonical(result))
    print(json.dumps(result))


if __name__=='__main__':
    main()
