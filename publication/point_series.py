"""Canonical point values across the published times of pinned groups."""

import base64
import json
import math
import re
import sys
import time
from datetime import datetime

import pg8000.dbapi

from decoder.inspect_forecast import ValidationError
from decoder.sampling import canonical
from publication.domain import PublicationUnavailable, resolve, resolve_revision
from publication import numerical, retention, revisions
from publication.limited import request_deadline

MAX_TIMES = 745
MAX_RESPONSE_BYTES = 4 * 1024**2
PAIR_KEYS = ('model', 'run', 'revision', 'level', 'native_grid_sha256', 'member',
             'wind_pair', 'uv_relative_to_grid', 'units', 'interval')


def record(revision: dict, entry: dict) -> dict:
    if 'discovery' in entry:
        return {**entry['discovery'], 'revision': revision['revision']}
    manifest = revisions.selected(revision, entry, numerical_only=True)
    return {**manifest['identity'], **manifest['source'].get('field_descriptor', {})}


def compatible(u: dict, v: dict) -> bool:
    return (u.get('wind_axis') == 'u' and v.get('wind_axis') == 'v'
            and u.get('units') == 'm s**-1' and isinstance(u.get('uv_relative_to_grid'), bool)
            and re.fullmatch(r'[0-9a-f]{64}', u.get('wind_pair') or '') is not None
            and all(u.get(key) == v.get(key) for key in PAIR_KEYS))


def read(args: dict, deadline: float) -> tuple[dict, dict]:
    selection = args['selection']
    wind_u, wind_v = args.get('wind_u'), args.get('wind_v')
    requested_wind = (wind_u, wind_v)
    if (not re.fullmatch(r'[0-9a-f]{64}(?:\.[0-9a-f]{64})?', selection)
            or any(requested_wind) and not all(requested_wind)
            or any(anchor is not None and not re.fullmatch(r'[0-9a-f]{64}\.[0-9a-f]{64}', anchor)
                   for anchor in requested_wind)):
        raise ValueError('Недопустимые ссылки на опубликованные группы.')
    lon, lat = float(args['lon']), float(args['lat'])
    if not math.isfinite(lon) or not math.isfinite(lat) or not -90 <= lat <= 90:
        raise ValueError('Недопустимые координаты.')
    first = args.get('from', '')
    if 'from' in args:
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', first):
            raise ValueError('Требуется точное время UTC для начала ряда.')
        datetime.fromisoformat(first.replace('Z', '+00:00'))

    if '.' not in selection:
        if any(requested_wind):
            raise ValueError('Для ряда ветра требуется закреплённая редакция.')
        manifest = resolve(selection)
        identity = manifest['identity']
        valid = identity['valid_time']
        return identity, {'scalar': [{'time': valid, **sample(manifest, args)}] if valid >= first else []}

    root, scalar_key = selection.split('.')
    retention.ensure(root)
    revision = resolve_revision(root)
    batches = {entry['key']: entry for entry in revision['batches']}
    identity = record(revision, batches[scalar_key])
    if identity['run'] != revision['run']:
        raise PublicationUnavailable('published series identity mismatch')

    def group(anchor: dict) -> dict:
        return {entry['valid_time']: entry for entry in batches.values()
                if entry.get('field', 'T_G:surface:0') == anchor['field']
                and revisions.batch_key({**anchor, 'valid_time': entry['valid_time']}) == entry['key']}

    scalar = group(identity)
    u_entries: dict = {}
    v_entries: dict = {}
    if wind_u is not None and wind_v is not None:
        u_id, v_id = wind_u.split('.'), wind_v.split('.')
        if u_id[0] != root or v_id[0] != root:
            raise ValueError('Компоненты ветра должны принадлежать закреплённой редакции.')
        u, v = (record(revision, batches[key]) for key in (u_id[1], v_id[1]))
        if (not compatible(u, v) or u['valid_time'] != v['valid_time']
                or any(u[key] != identity[key] for key in ('model', 'run', 'member'))):
            raise ValueError('Несовместимые компоненты ветра.')
        u_entries, v_entries = group(u), group(v)

    wind_times = set(u_entries) | set(v_entries)
    if len(scalar) > MAX_TIMES or len(wind_times) > MAX_TIMES:
        raise ValueError('Слишком длинный прогнозный ряд.')
    payload: dict = {'scalar': []}
    if all(requested_wind):
        payload['wind'] = []

    def item(entry: dict, model: str) -> dict:
        try:
            manifest = revisions.selected(revision, entry, numerical_only=True)
            if manifest['identity']['model'] != model:
                raise ValueError('published model mismatch')
            return sample(manifest, args)
        except (OSError, KeyError, ValueError, TypeError, ValidationError):
            return {'status': 'error'}

    for valid in sorted(valid for valid in set(scalar) | wind_times if valid >= first):
        if time.time() >= deadline:
            payload['next'] = valid
            break
        if valid in scalar:
            payload['scalar'].append({'time': valid, **item(scalar[valid], identity['model'])})
        if valid not in wind_times:
            continue
        row: dict = {'time': valid, 'status': 'missing'}
        if valid in u_entries and valid in v_entries:
            if time.time() >= deadline:
                row['status'] = 'error'
                payload['next'] = valid
            else:
                try:
                    paired = compatible(record(revision, u_entries[valid]), record(revision, v_entries[valid]))
                except (OSError, KeyError, ValueError, TypeError, ValidationError):
                    paired = False
                    row['status'] = 'error'
                if paired:
                    u_sample = item(u_entries[valid], identity['model'])
                    if time.time() >= deadline:
                        v_sample = {'status': 'error'}
                        payload['next'] = valid
                    else:
                        v_sample = item(v_entries[valid], identity['model'])
                    row.update(u=component(u_sample), v=component(v_sample))
                    u_point = u_sample.get('result')
                    if u_point and 'source_crs' not in payload:
                        payload['source_crs'] = u_point['source'].get('source_crs')
                    row['status'] = 'sampled' if 'result' in u_sample and 'result' in v_sample else 'error'
        payload['wind'].append(row)
        if 'next' in payload:
            break
    return identity, payload


def sample(manifest: dict, args: dict) -> dict:
    try:
        return {'status': 'sampled', 'result': numerical.sample_manifest(
            manifest, args['lon'], args['lat'], numerical.CRS84)}
    except (PublicationUnavailable, numerical.CoordinateError):
        return {'status': 'error'}


def component(item: dict) -> dict:
    point = item.get('result')
    if point is None:
        return item
    return {'status': 'sampled', 'result': {key: point[key] for key in
            ('selection', 'identity', 'units', 'value', 'reason', 'cell')}}


def process(args: dict) -> dict:
    deadline = args['deadline']
    token = request_deadline.set(deadline)
    try:
        identity, result = read(args['args'], deadline - 0.75)
        body = canonical(result)
        if len(body) > MAX_RESPONSE_BYTES:
            return {'error': 413}
        return {'body': base64.b64encode(body).decode(),
                'identity': {key: identity[key] for key in ('model', 'run', 'revision')}}
    except retention.ExpiredSelection:
        status, code, description = 410, 'Expired', 'published selection expired'
    except KeyError:
        status, code, description = 404, 'NotFound', 'unavailable published selection'
    except (ValueError, ValidationError) as error:
        status, code, description = 400, 'InvalidParameterValue', str(error)[:200]
    except (PublicationUnavailable, pg8000.dbapi.Error, OSError):
        status, code, description = 503, 'Unavailable', 'published service temporarily unavailable'
    finally:
        request_deadline.reset(token)
    return {'status': status, 'body': base64.b64encode(canonical({'code': code, 'description': description})).decode()}


def main() -> None:
    for line in sys.stdin:
        args = json.loads(line)
        result = {'body': ''} if args['operation'] == 'initialize' else process(args)
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
