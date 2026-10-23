"""T2 sample-only normalization and A2 gate. No publication is performed."""

import argparse
import hashlib
import importlib.metadata
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

import eccodes as ec
import numpy as np
import rasterio
import xarray as xr
import zarr
from numcodecs import Blosc
from rasterio.enums import Resampling
from rasterio.shutil import copy as raster_copy
from rasterio.transform import from_origin

from decoder.inspect_forecast import SAMPLE_SHA256, decode_message, require, sections, tool_versions
from decoder.sampling import ManifestSampler, asset_path, canonical, file_hash, read_values

PIPELINE = 't2.3'
TOLERANCE_K = 0.0001
MAX_FRAME_BYTES = 8 * 1024 * 1024
FIELD = 'T_G:surface:0'
RUN = 'ICON-EU/2026-10-15T00:00:00Z'
# GRIB table 3.2 code 6. Greenwich origin is the documented interpretation;
# producer confirmation of the precise datum/origin remains a GIS gate input.
NATIVE_CRS = rasterio.crs.CRS.from_string('+proj=longlat +R=6371229 +no_defs')


def field_metadata(frame: bytes, hour: int, source_crs: dict | None = None) -> dict:
    metadata = decode_message(frame, hour)
    raw = sections(frame)
    metadata.update(model='ICON-EU', ensemble_member=None,
                    native_crs_wkt=NATIVE_CRS.to_wkt(),
                    native_grid_sha256=hashlib.sha256(raw[3]).hexdigest(),
                    source_message_sha256=hashlib.sha256(frame).hexdigest(),
                    grib_metadata_sections_hex={str(number): section.hex()
                                                for number, section in raw.items() if number != 7})
    if source_crs is not None:
        from decoder.source_crs import apply
        apply(metadata, source_crs)
    return metadata


def bounded_frames(path: Path) -> Iterator[bytes]:
    """One compatible sample message at a time; bound allocation before reading."""
    with path.open('rb') as stream:
        while header := stream.read(16):
            require(len(header) == 16 and header[:4] == b'GRIB' and header[7] == 2, 'invalid GRIB header')
            length = int.from_bytes(header[8:16], 'big')
            require(20 <= length <= MAX_FRAME_BYTES, 'GRIB message exceeds bounded sample frame budget')
            rest = stream.read(length - 16)
            require(len(rest) == length - 16 and rest[-4:] == b'7777', 'truncated GRIB message')
            yield header + rest


def decoded_arrays(frame: bytes, shape: list[int]) -> tuple[np.ndarray, np.ndarray]:
    handle = ec.codes_new_from_message(frame)
    try:
        values = np.asarray(ec.codes_get_values(handle), dtype='<f8').reshape(shape)
        missing = (ec.codes_get_array(handle, 'bitmap') == 0 if ec.codes_get_long(handle, 'bitmapPresent')
                   else np.zeros(values.size, dtype=bool))
        return values, missing.reshape(shape)
    finally:
        ec.codes_release(handle)


def write_field(root: Path, name: str, metadata: dict, values: np.ndarray, missing: np.ndarray) -> dict:
    """Internal one-field writer; COG reads the completed Zarr, never the GRIB array."""
    zpath, cpath = root / f'{name}.zarr', root / f'{name}.tif'
    require(metadata['grid']['earth_shape_code'] == 6, 'unsupported native earth shape')
    group = zarr.open_group(str(zpath), mode='w-', zarr_format=2)
    group.attrs.update(metadata=metadata, pipeline_version=PIPELINE)
    ny, nx = values.shape
    dx, dy = metadata['grid']['spacing_degrees_xy']
    west, south, east, north = metadata['grid']['outer_cell_edges_wsen']
    arrays = [('temperature', values, ['latitude', 'longitude'], (256, 256)),
              ('missing', missing.astype('uint8'), ['latitude', 'longitude'], (256, 256)),
              ('longitude', west + dx / 2 + np.arange(nx) * dx, ['longitude'], (nx,)),
              ('latitude', south + dy / 2 + np.arange(ny) * dy, ['latitude'], (ny,))]
    for variable, data, dimensions, chunks in arrays:
        array = group.create_array(variable, data=data, chunks=chunks, fill_value=None,
                                   compressor=Blosc(cname='zstd', clevel=5, shuffle=Blosc.BITSHUFFLE))
        array.attrs['_ARRAY_DIMENSIONS'] = dimensions
    group['temperature'].attrs.update(units=metadata['identity']['units'], coordinates='latitude longitude')
    group['missing'].attrs.update(long_name='1 = native missing; 0 = valid')
    group['latitude'].attrs.update(units='degrees_north', standard_name='latitude')
    group['longitude'].attrs.update(units='degrees_east', standard_name='longitude')
    from decoder.source_crs import LEGACY_ID, identifier
    corrected = identifier(metadata) != LEGACY_ID
    if corrected:
        group['latitude'].attrs.update(units='degrees', standard_name='grid_latitude')
        group['longitude'].attrs.update(units='degrees', standard_name='grid_longitude')
    zarr.consolidate_metadata(str(zpath))
    stored = zarr.open_group(str(zpath), mode='r', zarr_format=2)
    # GRIB/Zarr rows scan south->north. TIFF rows scan north->south.
    numeric = np.asarray(read_values(stored, 'temperature'), dtype='<f4')[::-1].copy()
    valid = (1 - read_values(stored, 'missing'))[::-1].astype('uint8') * 255
    temporary = root / f'{name}.working.tif'
    if corrected:
        from decoder.gis_derivative import write
        derivative = write(temporary, metadata, read_values(stored, 'temperature'), read_values(stored, 'missing').astype(bool))
        with rasterio.Env(GDAL_NUM_THREADS='1'):
            raster_copy(temporary, cpath, driver='COG', BLOCKSIZE=256, COMPRESS='DEFLATE',
                        OVERVIEWS='AUTO', RESAMPLING='NEAREST')
        temporary.unlink()
        return {'field': FIELD, 'metadata': metadata, 'zarr': zpath.name, 'cog': cpath.name,
                'gis_derivative': derivative}
    with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True, GDAL_NUM_THREADS='1'):
        with rasterio.open(temporary, 'w', driver='GTiff', width=nx, height=ny, count=1,
                           dtype='float32', crs=NATIVE_CRS,
                           transform=from_origin(west, north, dx, dy), tiled=True,
                           blockxsize=256, blockysize=256, compress='DEFLATE') as raster:
            raster.write(numeric, 1)
            raster.write_mask(valid)
            raster.update_tags(native_grid=json.dumps(metadata['grid']), units=metadata['identity']['units'],
                               valid_time=metadata['valid_time'], field=FIELD, pipeline=PIPELINE,
                               point_values='Use manifest-backed Zarr; never overviews')
            raster.build_overviews([2, 4], Resampling.nearest)
        raster_copy(temporary, cpath, driver='COG', COMPRESS='DEFLATE', BLOCKSIZE=256,
                    OVERVIEWS='FORCE_USE_EXISTING', RESAMPLING='NEAREST', NUM_THREADS='1')
    temporary.unlink()
    return {'field': FIELD, 'zarr': zpath.name, 'cog': cpath.name, 'metadata': metadata,
            'encoding': {'zarr_format': 2, 'zarr_dtype': '<f8', 'chunks_yx': [256, 256],
                         'codec': 'Blosc/zstd/5/bitshuffle', 'cog_dtype': 'float32',
                         'cog_compression': 'DEFLATE', 'max_abs_error_bound_K': TOLERANCE_K,
                         'overview_resampling': 'nearest', 'overviews_for_point_values': False}}


def check_field(root: Path, item: dict, baseline: np.ndarray, missing: np.ndarray) -> dict:
    metadata = item['metadata']
    zpath = asset_path(root, item['zarr'])
    group = zarr.open_group(str(zpath), mode='r', zarr_format=2)
    require(json.loads((zpath / '.zgroup').read_text())['zarr_format'] == 2, 'not explicit Zarr v2')
    require(dict(group.attrs)['metadata'] == metadata, 'Zarr metadata changed')
    stored, stored_missing = read_values(group, 'temperature'), read_values(group, 'missing').astype(bool)
    require(np.array_equal(stored_missing, missing), 'Zarr mask changed')
    require(np.array_equal(stored[~missing], baseline[~missing]), 'Zarr precision failed')
    with xr.open_zarr(str(zpath), consolidated=True, chunks=None, zarr_format=2) as dataset:
        require(np.array_equal(dataset.temperature.values[~missing], baseline[~missing]), 'Xarray precision failed')
        require(np.array_equal(dataset.missing.values.astype(bool), missing), 'Xarray mask failed')
        require(dataset.temperature.attrs['units'] == metadata['identity']['units'], 'Xarray units changed')
        require(np.array_equal(dataset.latitude.values, read_values(group, 'latitude'))
                and np.array_equal(dataset.longitude.values, read_values(group, 'longitude')), 'Xarray coordinates changed')
    ny, nx = baseline.shape
    dx, dy = metadata['grid']['spacing_degrees_xy']
    west, south, east, north = metadata['grid']['outer_cell_edges_wsen']
    require(np.array_equal(read_values(group, 'longitude'), west + dx / 2 + np.arange(nx) * dx), 'longitude centres changed')
    require(np.array_equal(read_values(group, 'latitude'), south + dy / 2 + np.arange(ny) * dy), 'latitude centres changed')
    if 'gis_derivative' in item:
        from decoder.gis_derivative import check
        error = check(asset_path(root,item['cog']),item,baseline,missing)
        return {'message': metadata['message'], 'valid_time': metadata['valid_time'],
                'native_crs_wkt': metadata['native_crs_wkt'], 'gis_derivative': item['gis_derivative'],
                'finite_cells': int(np.count_nonzero(~missing)), 'missing_cells': int(missing.sum()),
                'cog_max_abs_error': error, 'zarr_max_abs_error': 0.,
                'checks': 'all native Zarr/Xarray values/masks; all GIS derivative pixels against independent spherical rotation',
                'representative_cells': metadata['grid']['cell_centres']}
    with rasterio.open(asset_path(root, item['cog'])) as raster:
        require(metadata['grid']['earth_shape_code'] == 6, 'unsupported native earth shape')
        # GeoTIFF normalizes geographic WKT axis ordering. Compare operative
        # projection/ellipsoid/prime-meridian parameters, not that serialization.
        require(raster.crs.to_dict() == NATIVE_CRS.to_dict(), 'COG native spherical CRS changed')
        require(raster.transform == from_origin(west, north, dx, dy), 'half-cell georeferencing failed')
        require(tuple(raster.bounds) == (west, south, east, north), 'COG bounds failed')
        require(raster.tags(ns='IMAGE_STRUCTURE').get('LAYOUT') == 'COG', 'COG layout failed')
        require(raster.overviews(1) == [2, 4], 'COG overviews absent')
        require(raster.tags()['units'] == metadata['identity']['units'], 'COG units changed')
        actual = raster.read(1)[::-1]
        actual_missing = raster.read_masks(1)[::-1] == 0
        require(np.array_equal(actual_missing, missing), 'COG mask changed')
        error = float(np.max(np.abs(actual[~missing].astype('float64') - baseline[~missing])))
        require(error <= TOLERANCE_K, f'COG precision failed: {error} K')
        # Full arrays establish numeric placement; independent baseline centres check the affine.
        for cell in metadata['grid']['cell_centres']:
            lon, lat = raster.xy(ny - 1 - cell['row'], cell['column'])
            require((lon, lat) == (cell['lon'], cell['lat']), 'COG cell centre failed')
    return {'message': metadata['message'], 'valid_time': metadata['valid_time'],
            'native_crs_wkt': raster.crs.to_wkt(),
            'finite_cells': int(np.count_nonzero(~missing)), 'missing_cells': int(missing.sum()),
            'zarr_max_abs_error': 0.0, 'cog_max_abs_error': error,
            'checks': 'all native values/masks; Zarr+Xarray readers; COG full resolution/centres/bounds/overviews',
            'representative_cells': metadata['grid']['cell_centres']}


def versions() -> dict:
    result = tool_versions()
    result['packages'].update({name: importlib.metadata.version(name)
                               for name in ['zarr', 'numcodecs', 'xarray', 'rasterio', 'pandas']})
    result['gdal'] = rasterio.__gdal_version__
    result['proj'] = rasterio.__proj_version__
    return result


def build(source: Path, target: Path, clock: str, synthetic_nodata: bool = False,
          legacy_source_crs: bool = False) -> dict:
    require(file_hash(source) == SAMPLE_SHA256, 'checksum differs from supplied sample')
    target.mkdir(parents=True, exist_ok=False)
    tools = versions()
    require('AEC' in tools['features'], 'AEC required')
    fields, checks = [], []
    from decoder.source_crs import resolve
    source_crs = None if legacy_source_crs else resolve(source.parent / 'proj.txt')
    for hour, frame in enumerate(bounded_frames(source), 1):
        metadata = field_metadata(frame, hour, source_crs)
        values, missing = decoded_arrays(frame, metadata['grid']['shape_yx'])
        if synthetic_nodata:
            # Explicit supplement to the mandatory sample, never producer data.
            missing[0, 0] = missing[values.shape[0] // 2, values.shape[1] // 2] = True
            metadata['synthetic_nodata'] = {'cells_yx': [[0, 0], [values.shape[0] // 2, values.shape[1] // 2]],
                                             'original_values_metadata': metadata.pop('values')}
            for cell in metadata['grid']['cell_centres']:
                if missing[cell['row'], cell['column']]:
                    cell['value'] = None
        item = write_field(target, f'hour-{hour:02d}', metadata, values, missing)
        checks.append(check_field(target, item, values, missing))
        fields.append(item)
        if synthetic_nodata:
            break
    require(len(fields) == (1 if synthetic_nodata else 24), 'unexpected field count')
    # Recheck source after processing, preventing a changed input from yielding a manifest.
    require(file_hash(source) == SAMPLE_SHA256, 'source changed during normalization')
    assets: dict[str, Any] = {path.relative_to(target).as_posix(): {'bytes': path.stat().st_size, 'sha256': file_hash(path)}
              for path in sorted(target.rglob('*')) if path.is_file()}
    body = {'schema_version': 1, 'pipeline_version': PIPELINE, 'state': 'validated-test',
            'clock': clock, 'run': RUN, 'model': 'ICON-EU', 'member': None,
            'synthetic_nodata': synthetic_nodata,
            'source': {'name': source.name, 'bytes': source.stat().st_size, 'sha256': SAMPLE_SHA256,
                       'revision': SAMPLE_SHA256}, 'tools': tools, 'fields': fields, 'assets': assets}
    revision = hashlib.sha256(canonical(body)).hexdigest()
    manifest = {**body, 'revision': revision}
    manifest_path = target / 'manifest.pending.json'
    with manifest_path.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(manifest, indent=2, allow_nan=False) + '\n')
    sampler = ManifestSampler(manifest_path)
    for item in fields:
        for cell in item['metadata']['grid']['cell_centres']:
            point = sampler.sample(run=RUN, revision=revision, field=FIELD,
                                   valid_time=item['metadata']['valid_time'], lon=cell['lon'], lat=cell['lat'])
            require(point['value'] == cell['value'], 'manifest sampler differs from ecCodes cell')
    manifest_path.rename(target / 'manifest.json')
    manifest_path = target / 'manifest.json'
    # Application never rewrites these files. Read-only permissions reinforce that contract.
    for path in target.rglob('*'):
        if path.is_file():
            path.chmod(0o444)
    zarr_bytes = sum(info['bytes'] for name, info in assets.items() if '.zarr/' in name)
    cog_bytes = sum(info['bytes'] for name, info in assets.items() if name.endswith('.tif'))
    return {'status': 'passed', 'gate': 'synthetic-mask-supplement' if synthetic_nodata else 'A2',
            'pipeline_version': PIPELINE, 'clock': clock,
            'revision': revision, 'source': body['source'], 'tools': tools, 'fields': checks,
            'zarr_max_abs_error': 0.0, 'cog_max_abs_error': max(item['cog_max_abs_error'] for item in checks),
            'cog_max_abs_error_bound_K': TOLERANCE_K,
            'storage_bytes': {'source': source.stat().st_size, 'zarr': zarr_bytes, 'cog': cog_bytes,
                              'manifest': manifest_path.stat().st_size,
                              'total_with_source': source.stat().st_size + zarr_bytes + cog_bytes + manifest_path.stat().st_size},
            'limitations': 'Local storage A2 only; no GIS/publication/QGIS/adapter or capacity claim'}


def verify(source: Path, manifest_path: Path) -> dict:
    sampler = ManifestSampler(manifest_path)
    require(not sampler.manifest['synthetic_nodata'], 'synthetic supplement is not actual-sample A2 evidence')
    require(file_hash(source) == sampler.manifest['source']['sha256'] == SAMPLE_SHA256, 'source checksum mismatch')
    fields = sampler.manifest['fields']
    checks = []
    for hour, frame in enumerate(bounded_frames(source), 1):
        require(hour <= len(fields), 'unexpected source field')
        metadata = field_metadata(frame, hour, fields[hour - 1]['metadata'].get('source_crs'))
        require(metadata == fields[hour - 1]['metadata'], 'field metadata differs from ecCodes')
        values, missing = decoded_arrays(frame, metadata['grid']['shape_yx'])
        checks.append(check_field(manifest_path.parent, fields[hour - 1], values, missing))
    require(len(checks) == len(fields) == 24, 'field count differs')
    return {'status': 'passed', 'gate': 'A2-recheck', 'revision': sampler.revision, 'fields': checks}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['build', 'verify'])
    parser.add_argument('source', type=Path)
    parser.add_argument('target', type=Path, help='New output directory for build; manifest.json for verify')
    parser.add_argument('--clock', required=True)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--synthetic-nodata', action='store_true',
                        help='Build one explicitly synthetic field with two missing cells; not A2 sample evidence')
    parser.add_argument('--legacy-source-crs', action='store_true', help='Reproduce historical T2 source CRS; normal builds use proj.txt/GRIB')
    args = parser.parse_args()
    try:
        require(args.clock.endswith('Z'), 'clock must be explicit UTC ending in Z')
        datetime.fromisoformat(args.clock.replace('Z', '+00:00'))
        require(not args.synthetic_nodata or args.operation == 'build', 'synthetic flag is for build only')
        report = (build(args.source, args.target, args.clock, args.synthetic_nodata, args.legacy_source_crs) if args.operation == 'build'
                  else verify(args.source, args.target))
        report['clock'] = args.clock
    except Exception as error:
        report = {'status': 'failed', 'gate': 'A2', 'clock': args.clock,
                  'error': {'type': type(error).__name__, 'message': str(error)},
                  'decision': 'Block publication; retain source and diagnostics; reopen affected storage decision on real compatibility/precision failure.'}
    payload = json.dumps(report, indent=2, allow_nan=False) + '\n'
    if args.report:
        temporary = args.report.with_suffix(args.report.suffix + '.tmp')
        temporary.write_text(payload, encoding='utf-8')
        temporary.replace(args.report)
    else:
        sys.stdout.write(payload)
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
