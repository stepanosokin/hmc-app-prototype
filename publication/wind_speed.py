"""Publish a scalar native-cell speed without replacing the original U/V."""
import copy
import hashlib
from pathlib import Path

import numpy as np
import zarr

from decoder.sampling import ManifestSampler, asset_path, canonical, file_hash, read_values
from decoder.storage import write_field, check_field
from publication.domain import load_manifest, sampler, write_once


def components(entries: dict) -> list[tuple[dict, dict]]:
    groups: dict[tuple, dict] = {}
    for entry in entries.values():
        batch = load_manifest(entry['manifest_path'], entry['manifest_sha256'])
        descriptor = batch['source'].get('field_descriptor', {})
        axis, pair = descriptor.get('wind_axis'), descriptor.get('wind_pair')
        if axis not in ('u', 'v') or not pair or descriptor['units'] != 'm s**-1':
            continue
        # Magnitude of mean components is not mean wind speed. This product is
        # defined only for instantaneous U/V, matching the earth wind field.
        if descriptor.get('interval') is not None:
            continue
        identity = batch['identity']
        key = (pair, identity['run'], identity['valid_time'], identity['level'],
               identity['native_grid_sha256'], identity['member'], descriptor.get('uv_relative_to_grid'))
        groups.setdefault(key, {})[axis] = batch
    return [(pair['u'], pair['v']) for pair in groups.values() if 'u' in pair and 'v' in pair]


def numerical(u: dict, v: dict, target: Path) -> ManifestSampler:
    if any(batch['source']['field_descriptor'].get('interval') is not None for batch in (u, v)):
        raise ValueError('Скорость вычисляется только из мгновенных компонент ветра')
    original = sampler(u)
    a, b = original.manifest['fields'][0], sampler(v).manifest['fields'][0]
    metadata = copy.deepcopy(a['metadata'])
    metadata['source_components'] = [
        {'selection': batch['selection'], 'identity': copy.deepcopy(item['metadata']['identity']),
         'raw_identity': copy.deepcopy(item['metadata']['raw_identity']),
         'source_message_sha256': item['metadata']['source_message_sha256'],
         'grib_metadata_sections_hex': item['metadata']['grib_metadata_sections_hex']}
        for batch, item in ((u, a), (v, b))]
    metadata.pop('source_message_sha256', None)
    metadata.pop('grib_metadata_sections_hex', None)
    first = zarr.open_group(str(asset_path(original.root, a['zarr'])), mode='r', zarr_format=2)
    other = sampler(v)
    second = zarr.open_group(str(asset_path(other.root, b['zarr'])), mode='r', zarr_format=2)
    values = np.hypot(read_values(first, a['data_variable']), read_values(second, b['data_variable']))
    missing = read_values(first, 'missing').astype(bool) | read_values(second, 'missing').astype(bool)
    metadata['raw_identity']['parameterNumber'] = 1
    metadata['field_identity']['parameterNumber'] = 1
    metadata['field_identity']['derived'] = 'native-uv-magnitude/1'
    metadata['field'] = 'GRIB2:' + hashlib.sha256(canonical(metadata['field_identity'])).hexdigest()
    metadata['identity'].update(shortName='wind_speed', units='m s**-1', name='Wind speed derived from U/V')
    metadata['identity'].pop('paramId', None)
    metadata['identity'].pop('uv_relative_to_grid', None)
    metadata['float32_abs_error_bound'] = float(np.max(np.abs(values[~missing]))) * 2**-23 if (~missing).any() else 0.
    metadata['derived_from'] = [u['selection'], v['selection']]
    target.mkdir(parents=True)
    item = write_field(target, 'speed', metadata, values, missing)
    write_once(target / 'validation.json', check_field(target, item, values, missing))
    descriptor = copy.deepcopy(u['source']['field_descriptor'])
    for key in ('wind_axis', 'wind_pair', 'uv_relative_to_grid'):
        descriptor.pop(key, None)
    descriptor.update(id=metadata['field'], short_name='wind_speed', label='Скорость ветра',
                      raw_identity=metadata['field_identity'])
    source = {**original.manifest['source'], 'field_descriptor': descriptor,
              'derived_from': metadata['derived_from'], 'derived': 'native-uv-magnitude/1'}
    source['components'] = [{key: batch['source'].get(key) for key in ('name', 'sha256', 'message_sha256')}
                            for batch in (u, v)]
    # A derived batch must never satisfy raw-message ingestion idempotence.
    source['message_sha256'] = hashlib.sha256(canonical({'derived': source['derived'],
                                                       'components': source['components']})).hexdigest()
    body = {**{key: value for key, value in original.manifest.items() if key not in ('revision', 'assets', 'fields')},
            'source': source, 'fields': [item],
            'assets': {p.relative_to(target).as_posix(): {'bytes': p.stat().st_size, 'sha256': file_hash(p)}
                       for p in sorted(target.rglob('*')) if p.is_file()}}
    write_once(target / 'manifest.json', {**body, 'revision': hashlib.sha256(canonical(body)).hexdigest()})
    for path in target.rglob('*'):
        if path.is_file():
            path.chmod(0o444)
    return ManifestSampler(target / 'manifest.json')


def add(job: dict, entries: dict, directory: Path, cache: dict | None = None) -> dict:
    from publication import revisions, worker, recovery
    from publication.catalogue import discovery
    cache = {} if cache is None else cache
    result = dict(entries)
    for entry in entries.values():
        batch = load_manifest(entry['manifest_path'], entry['manifest_sha256'])
        source = batch['source']
        if source.get('derived') == 'native-uv-magnitude/1':
            cache.setdefault(tuple(source['derived_from']), entry)
    for index, (u, v) in enumerate(components(entries)):
        pair = (u['selection'], v['selection'])
        if pair not in cache:
            recovery.reserve(sum(asset['bytes'] for batch in (u, v) for asset in batch['assets'].values()))
            attempt = directory / f'speed-{index:05d}'
            data = numerical(u, v, attempt / 'numerical')
            batch, relative, checksum = worker.publish_batch(job, attempt, data, commit=False)
            cache[pair] = {'key': revisions.batch_key(batch['identity']), 'field': batch['identity']['field'],
                          'valid_time': batch['identity']['valid_time'], 'manifest_path': relative,
                          'manifest_sha256': checksum, 'discovery': discovery(batch)}
        entry = cache[pair]
        result[entry['key']] = entry
    return result
