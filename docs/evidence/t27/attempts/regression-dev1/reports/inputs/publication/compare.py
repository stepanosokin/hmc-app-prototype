"""Actual-sample engine/encoding experiment; selection follows browser evidence."""

import argparse
import base64
import hashlib
import json
import math
import time
from pathlib import Path

import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rio_tiler.io import Reader

from decoder.sampling import ManifestSampler, canonical, file_hash
from decoder.storage import build, bounded_frames, decoded_arrays, field_metadata
from publication.tiles import CONTRACT, CONTRACT_PATH, coordinates, render, encode, decode

EVIDENCE = Path('/evidence')
ACTUAL = Path('/assets/comparison')
SOURCE = Path('/input/ICON_EU_T_G_2026101500.grib2')


def reference(values: np.ndarray, lon: float, lat: float) -> float | None:
    # Independent literal sample geometry and scalar weighted sum, from raw GRIB.
    if not (-23.53125 <= lon < 62.53125 and 29.46875 <= lat < 70.53125):
        return None
    column = min(max((lon + 23.5) / 0.0625, 0), 1376)
    row = min(max((lat - 29.5) / 0.0625, 0), 656)
    x, y = math.floor(column), math.floor(row)
    right, upper = min(x + 1, 1376), min(y + 1, 656)
    a, b = column - x, row - y
    return float(values[y, x]*(1-a)*(1-b) + values[y, right]*a*(1-b)
                 + values[upper, x]*(1-a)*b + values[upper, right]*a*b)


def browser_page(fixtures: list[dict]) -> str:
    return '''<!doctype html><meta charset="utf-8"><title>T4 isolated numeric decode/upload check</title>
<pre id="result">pending</pre><canvas id="gpu" width="258" height="258"></canvas>
<script>
const fixtures = ''' + json.dumps(fixtures) + ''';
(async()=>{try {
const gl=document.getElementById('gpu').getContext('webgl2');
if(!gl)throw Error('WebGL2 unavailable');
const debug=gl.getExtension('WEBGL_debug_renderer_info');
const results=[];
for(const item of fixtures){
 const bytes=Uint8Array.from(atob(item.payload),c=>c.charCodeAt(0));
 const start=performance.now(); let values,mask;
 if(item.encoding==='f32'){
  const view=new DataView(bytes.buffer); values=new Float32Array(258*258);
  for(let i=0;i<values.length;i++)values[i]=view.getFloat32(i*4,true);
  mask=bytes.slice(values.length*4);
 }else{
  const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
  const canvas=new OffscreenCanvas(258,258),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
  const rgba=ctx.getImageData(0,0,258,258).data;values=new Float32Array(258*258);mask=new Uint8Array(values.length);
  for(let i=0;i<values.length;i++){values[i]=(rgba[4*i]*65536+rgba[4*i+1]*256+rgba[4*i+2])*0.001;mask[i]=rgba[4*i+3]===255?1:0;}
  bitmap.close();
 }
 const decoded=performance.now();let maximum=0;
 for(const check of item.checks){if(mask[check.index]!==check.valid)throw Error('mask mismatch');
 if(check.valid)maximum=Math.max(maximum,Math.abs(values[check.index]-check.value));}
 if(maximum>0.001)throw Error('encoding error budget exceeded');
 gl.pixelStorei(gl.UNPACK_ALIGNMENT,1); const textures=[];
 for(const [internal,format,type,data] of [[gl.R32F,gl.RED,gl.FLOAT,values],[gl.R8,gl.RED,gl.UNSIGNED_BYTE,mask]]){
  const texture=gl.createTexture();textures.push(texture);gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D,0,internal,258,258,0,format,type,data);
 }
 gl.finish();const uploaded=performance.now();if(gl.getError()!==gl.NO_ERROR)throw Error('GPU upload failed');
 for(const texture of textures)gl.deleteTexture(texture);
 results.push({encoding:item.encoding,zxy:item.zxy,bytes:bytes.length,decode_ms:decoded-start,upload_ms:uploaded-decoded,max_abs_error_K:maximum});
}
document.getElementById('result').textContent=JSON.stringify({status:'passed',user_agent:navigator.userAgent,
 renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),results});
}catch(e){document.getElementById('result').textContent=JSON.stringify({status:'failed',error:String(e)});}})();
</script>'''


def prepare() -> None:
    if not ACTUAL.exists():
        report = build(SOURCE, ACTUAL, '2026-10-19T00:00:00Z')
        (EVIDENCE / 'storage.json').write_bytes(canonical(report))
    sampler = ManifestSampler(ACTUAL / 'manifest.json')
    item = sampler.manifest['fields'][0]
    frame = next(bounded_frames(SOURCE))
    values, missing = decoded_arrays(frame, field_metadata(frame, 1)['grid']['shape_yx'])
    fixtures, errors, toolkit = [], [], []
    for z, x, y in CONTRACT['readiness']['representatives']:
        actual, valid = render(ACTUAL, item, z, x, y)
        lon, lat = coordinates(z, x, y)
        checks = []
        for row in [0, 1, 64, 128, 256, 257]:
            for column in [0, 1, 64, 128, 256, 257]:
                # Independent inverse Mercator and WGS84 geocentric latitude.
                map_fraction = (y*256+row-1+0.5)/(256*2**z)
                geodetic = math.atan(math.sinh(math.pi*(1-2*map_fraction)))
                native_lat = math.degrees(math.atan((1-0.0066943799901413165)*math.tan(geodetic)))
                native_lon = (x*256+column-1+0.5)/(256*2**z)*360-180
                native_lon = (native_lon+180)%360-180
                if abs(native_lon-lon[row,column])>1e-10 or abs(native_lat-lat[row,column])>1e-10:
                    raise ValueError('native projection differs from independent geocentric calculation')
                expected = reference(values, native_lon, native_lat)
                if bool(valid[row, column]) != (expected is not None):
                    raise ValueError('project footprint differs from independent baseline')
                if expected is not None:
                    errors.append(abs(expected - actual[row, column]))
                checks.append({'index': row*258+column, 'value': expected or 0, 'valid': int(expected is not None)})
        for encoding in ('f32', 'png'):
            payload = encode(actual, valid, encoding)
            restored, restored_mask = decode(payload, encoding)
            error = float(np.max(np.abs(restored-actual)))
            if error > 0.001 or not np.array_equal(valid, restored_mask):
                raise ValueError('project encoding/mask failed')
            fixtures.append({'encoding': encoding, 'zxy': [z, x, y], 'payload': base64.b64encode(payload).decode(), 'checks': checks})
        try:
            with Reader(str(ACTUAL / item['cog'])) as reader:
                image = reader.tile(x, y, z, tilesize=256, buffer=1,
                                    resampling_method='bilinear', reproject_method='bilinear',
                                    vrt_options={'OVERVIEW_LEVEL': 'NONE'})
                candidate = image.data[0]
                mask = image.mask > 0
                common = mask & valid.astype(bool)
                toolkit.append({'zxy': [z, x, y], 'shape': list(candidate.shape),
                                'mask_differences': int(np.count_nonzero(mask != valid)),
                                'max_abs_error_K': float(np.max(np.abs(candidate[common]-actual[common]))) if np.any(common) else 0})
        except Exception as error:
            toolkit.append({'zxy': [z,x,y], 'error': type(error).__name__, 'detail': str(error)[:1000]})
        # Fair second probe: remove overviews and declare the agreed datum operation.
        # This remains a COG-derived float32 input, with T2's separate bound.
        try:
            with rasterio.open(ACTUAL / item['cog']) as source, MemoryFile() as memory:
                profile = source.profile.copy()
                profile['crs'] = rasterio.crs.CRS.from_string('+proj=longlat +R=6371229 +towgs84=0,0,0,0,0,0,0 +no_defs')
                with memory.open(**profile) as output:
                    output.write(source.read())
                    output.write_mask(source.dataset_mask())
                with memory.open() as full_resolution, Reader('', dataset=full_resolution) as reader:
                    image = reader.tile(x, y, z, tilesize=256, buffer=1,
                                        resampling_method='bilinear', reproject_method='bilinear')
                    mask = image.mask > 0
                    common = mask & valid.astype(bool)
                    toolkit.append({'configuration': 'no overviews; explicit zero-shift native CRS',
                                    'zxy':[z,x,y], 'mask_differences':int(np.count_nonzero(mask!=valid)),
                                    'max_abs_error_K':float(np.max(np.abs(image.data[0][common]-actual[common]))) if np.any(common) else 0})
        except Exception as error:
            toolkit.append({'configuration':'no overviews; explicit native CRS','zxy':[z,x,y],
                            'error':type(error).__name__, 'detail':str(error)[:1000]})
    # Adjacent and vertical seam overlaps use the independently decoded source.
    left, left_valid = render(ACTUAL, item, 3, 4, 2)
    right, right_valid = render(ACTUAL, item, 3, 5, 2)
    upper, upper_valid = render(ACTUAL, item, 3, 4, 1)
    if not (np.array_equal(left[:,-2:],right[:,:2]) and np.array_equal(left_valid[:,-2:],right_valid[:,:2])
            and np.array_equal(upper[-2:,:],left[:2,:]) and np.array_equal(upper_valid[-2:,:],left_valid[:2,:])):
        raise ValueError('project halo/seam failed')
    report = {'status': 'pending-geoserver-browser', 'source_sha256': file_hash(SOURCE),
              'contract_sha256': file_hash(CONTRACT_PATH),
              'project': {'engine': 'project-bilinear/1', 'max_reference_error_K': max(errors),
                          'halo_horizontal_vertical': 'passed', 'encodings': ['f32','png']},
              'rio_tiler': {'version': '7.9.2', 'tiles': toolkit}}
    (EVIDENCE / 'comparison.json').write_bytes(canonical(report))
    (EVIDENCE / 'browser.html').write_text(browser_page(fixtures))
    print(json.dumps(report))


def select() -> None:
    report = json.loads((EVIDENCE / 'comparison.json').read_bytes())
    browser = json.loads((EVIDENCE / 'browser.json').read_bytes())
    gis = json.loads((EVIDENCE / 'geoserver-numeric.json').read_bytes())
    if browser.get('fixture_sha256') != file_hash(EVIDENCE / 'browser.html'):
        raise ValueError('browser evidence does not belong to current tile fixtures')
    if report['contract_sha256'] != file_hash(CONTRACT_PATH):
        raise ValueError('comparison does not belong to current contract')
    if gis.get('status') != 'rejected-numeric-contract':
        raise ValueError('revisit preference for GeoServer reuse before selecting a custom engine')
    if browser['status'] != 'passed' or len(browser['results']) != 8 or 'status' not in gis:
        raise ValueError('comparison evidence incomplete')
    if report['project']['max_reference_error_K'] > 0.01:
        raise ValueError('project display error failed')
    decision = {'status': 'selected', 'engine': 'project-bilinear/1', 'encoding': 'f32',
                'contract_sha256': report['contract_sha256'], 'source_sha256': report['source_sha256'],
                'evidence_sha256': {name: file_hash(EVIDENCE / name) for name in ['comparison.json','browser.json','geoserver-numeric.json']},
                'rationale': 'Strict explicit native mask/edge/halo semantics; bounded raw Float32 decode and texture upload; preserve GeoServer WMS. See retained candidate results; no general performance or GPU-renderer claim.'}
    (EVIDENCE / 'selection.json').write_bytes(canonical(decision))
    print(json.dumps(decision))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['prepare', 'select'])
    args = parser.parse_args()
    prepare() if args.phase == 'prepare' else select()
