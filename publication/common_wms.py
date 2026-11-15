"""Immutable catalogue references; authorization and retention remain per request."""

import base64
import hashlib
import json
import re

from publication import retention, revisions
from publication.domain import database, resolve


def load_root(identifier: str, known: dict) -> list[dict]:
    if identifier not in known:
        raise KeyError('Неизвестная публикация закреплённого каталога WMS.')
    if known[identifier]['state'] != 'eligible':
        raise retention.ExpiredSelection(identifier)
    with database() as cursor:
        cursor.execute('SELECT manifest_path,manifest_sha256 FROM app.revisions WHERE revision=%s', (identifier,))
        row = cursor.fetchone()
    if row is None:
        return [resolve(identifier)]
    revision = revisions.load_revision(row['manifest_path'], row['manifest_sha256'])
    return [revisions.selected(revision, entry) for entry in revision['batches']]


def snapshot(token: str | None) -> tuple[str, list[dict]]:
    _, _, roots = retention.snapshot()
    known = {row['root']: row for row in roots}
    if token is None:
        # Select before checking eligibility: expiry/withdrawal must not reveal
        # an older run or revision as a new latest publication.
        latest: dict[str, dict] = {}
        for row in roots:
            model = row.get('model')
            if not model:
                from publication.domain import PublicationUnavailable
                raise PublicationUnavailable('publication model identity unavailable')
            reference = row['run'].rsplit('/', 1)[1]
            previous = latest.get(model)
            if previous is None or (reference, row['published_at'], row['state'] == 'eligible', row['root']) > (
                    previous['run'].rsplit('/', 1)[1], previous['published_at'], previous['state'] == 'eligible', previous['root']):
                latest[model] = row
        selected = sorted(row['root'] for row in latest.values() if row['state'] == 'eligible')
        if len(selected) > 64:
            raise ValueError('Общий WMS поддерживает до 64 моделей.')
        token = base64.urlsafe_b64encode(json.dumps(selected, separators=(',', ':')).encode()).decode().rstrip('=')
        return token, [manifest for identifier in selected for manifest in load_root(identifier, known)]
    else:
        if len(token) > 6000 or not re.fullmatch(r'[A-Za-z0-9_-]+', token):
            raise ValueError('Некорректная ссылка закреплённого каталога WMS.')
        try:
            selected = json.loads(base64.b64decode(token + '=' * (-len(token) % 4), altchars=b'-_', validate=True))
        except (ValueError, UnicodeError) as error:
            raise ValueError('Некорректная ссылка закреплённого каталога WMS.') from error
        if (not isinstance(selected, list) or len(selected) > 64
                or any(not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value) for value in selected)
                or len(set(selected)) != len(selected)):
            raise ValueError('Некорректный состав закреплённого каталога WMS.')
    manifests = []
    models: set[str] = set()
    for identifier in selected:
        fields = load_root(identifier, known)
        model = fields[0]['identity']['model']
        if model in models:
            raise ValueError('В закреплённом каталоге указаны разные публикации одной модели.')
        models.add(model)
        manifests.extend(fields)
    return token, manifests


def name(manifest: dict) -> str:
    identity = manifest['identity']
    scientific = {key: identity[key] for key in ('model', 'field', 'level', 'native_grid_sha256', 'member')}
    descriptor = manifest['source'].get('field_descriptor', {})
    interval = descriptor.get('interval')
    if interval:
        # The window can grow with forecast lead. Its bounds and duration are
        # observations, while the operation and sampling rule define the layer.
        scientific['aggregation'] = {key: interval[key] for key in
            ('statistical_process', 'time_increment_type', 'time_increment_unit', 'time_increment')}
        # Also normalize publications prepared before the sampling rule became
        # part of the GRIB field ID. Display names never define identity.
        scientific['field'] = {**descriptor['raw_identity'], **scientific['aggregation']}
    return 'hmc_' + hashlib.sha256(json.dumps(scientific, sort_keys=True).encode()).hexdigest()


def connection_name(manifest: dict) -> str:
    """The web wind overlay points to the already published scalar speed."""
    descriptor = manifest['source'].get('field_descriptor', {})
    if descriptor.get('wind_axis') and not descriptor.get('interval'):
        manifest = {**manifest, 'identity': dict(manifest['identity'])}
        raw = {**descriptor['raw_identity'], 'parameterNumber': 1, 'derived': 'native-uv-magnitude/1'}
        from decoder.sampling import canonical
        manifest['identity']['field'] = 'GRIB2:' + hashlib.sha256(canonical(raw)).hexdigest()
    return name(manifest)


def fields(manifests: list[dict]) -> dict[str, list[dict]]:
    result: dict[str, list[dict]] = {}
    for manifest in manifests:
        descriptor = manifest['source'].get('field_descriptor', {})
        raw = descriptor.get('raw_identity', {})
        if descriptor.get('wind_axis') or (raw.get('discipline'), raw.get('parameterCategory'), raw.get('parameterNumber')) in (
                (0, 2, 0), (0, 2, 2), (0, 2, 3)):
            continue
        choices = result.setdefault(name(manifest), [])
        if any(item['identity']['valid_time'] == manifest['identity']['valid_time'] for item in choices):
            raise ValueError('Неоднозначное совпадение слоя и срока WMS при подготовке каталога.')
        choices.append(manifest)
    return result


def titles(catalogue: dict[str, list[dict]]) -> dict[str, str]:
    result = {key: title(choices[0]) for key, choices in catalogue.items()}
    duplicates: dict[tuple, list[str]] = {}
    for key, choices in catalogue.items():
        duplicates.setdefault((choices[0]['identity']['model'], result[key]), []).append(key)
    for keys in duplicates.values():
        if len(keys) < 2:
            continue
        for key in keys:
            manifest = catalogue[key][0]
            identity = manifest['identity']
            interval = manifest['source'].get('field_descriptor', {}).get('interval')
            result[key] += ' · сетка ' + identity['native_grid_sha256']
            result[key] += ' · участник ' + str(identity['member'] if identity['member'] is not None else 'детерминированный')
            if interval:
                result[key] += ' · статистическая операция ' + str(interval['statistical_process'])
                result[key] += ' · правило интервала ' + '/'.join(str(interval[k]) for k in
                    ('time_increment_type', 'time_increment_unit', 'time_increment'))
        if len({result[key] for key in keys}) != len(keys):
            raise ValueError('Не удалось объяснить различия одноимённых вариантов WMS при подготовке каталога.')
    return result


def title(manifest: dict) -> str:
    descriptor = manifest['source'].get('field_descriptor', {})
    if not descriptor or descriptor.get('short_name') == 'T_G':
        return 'Температура поверхности'
    labels = {
        't': 'Температура', '2t': 'Температура', 'min_2t': 'Минимальная температура',
        'max_2t': 'Максимальная температура', 'sot': 'Температура почвы', '2d': 'Точка росы',
        'prmsl': 'Давление на уровне моря', 'sp': 'Давление у поверхности',
        'q': 'Удельная влажность', '2sh': 'Удельная влажность', '2r': 'Относительная влажность',
        'wind_speed': 'Скорость ветра', 'max_i10fg': 'Максимальные порывы ветра',
        'tp': 'Суммарные осадки', 'cp': 'Конвективные осадки', 'lsp': 'Крупномасштабные осадки',
        'lsrr': 'Интенсивность крупномасштабного дождя', 'crr': 'Интенсивность конвективного дождя',
        'lsfwe': 'Водный эквивалент крупномасштабного снегопада',
        'csfwe': 'Водный эквивалент конвективного снегопада', 'tgrp': 'Снежная крупа',
        'sde': 'Высота снежного покрова', 'sd': 'Водный эквивалент снежного покрова',
        'ccl': 'Облачность', 'vis': 'Видимость'}
    short = descriptor.get('short_name')
    raw = descriptor.get('raw_identity', {})
    quantity = tuple(raw.get(key) for key in ('discipline', 'parameterCategory', 'parameterNumber'))
    raw_labels = {(0, 0, 0): 'Температура', (0, 0, 6): 'Точка росы',
                  (0, 1, 0): 'Удельная влажность', (0, 1, 1): 'Относительная влажность',
                  (0, 1, 8): 'Суммарные осадки', (0, 2, 1): 'Скорость ветра',
                  (0, 2, 22): 'Максимальные порывы ветра', (0, 3, 0): 'Давление у поверхности',
                  (0, 3, 1): 'Давление на уровне моря', (2, 3, 18): 'Температура почвы'}
    label = labels.get(short, raw_labels.get(quantity, descriptor['label']))
    level, kind = descriptor['level'], descriptor['level_type']
    if kind == 'heightAboveGround':
        return f'{label} на высоте {level} м'
    if kind in ('isobaricInhPa', 'isobaricInPa'):
        return f'{label} · {level if kind == "isobaricInhPa" else level / 100:g} гПа'
    second = bytes.fromhex(raw.get('second_surface_hex', 'ff0000000000'))
    if second[0] != 255:
        def surface(kind, scale, value):
            if kind == 1:
                return 'поверхность'
            if kind == 100 and scale != 255 and value != 0xffffffff:
                signed = -(scale & 127) if scale & 128 else scale
                return f'{value * 10. ** -signed / 100:g} гПа'
            if kind in (103, 106) and scale != 255 and value != 0xffffffff:
                signed = -(scale & 127) if scale & 128 else scale
                return f'{value * 10. ** -signed:g} м'
            return f'тип GRIB {kind} (масштаб {scale}, значение {value})'
        first = surface(raw['typeOfFirstFixedSurface'], raw['scaleFactorOfFirstFixedSurface'], raw['scaledValueOfFirstFixedSurface'])
        return label + ' · слой ' + first + ' — ' + surface(second[0], second[1], int.from_bytes(second[2:], 'big'))
    if short in ('prmsl', 'sp'):
        return label
    if kind == 'surface':
        return 'Температура поверхности' if label == 'Температура' else label + ' · поверхность'
    if kind == 'depthBelowLand':
        return f'{label} на глубине {level:g} м'
    return label + (' · уровень моря' if kind == 'meanSea' else
                    f' · уровень {level} · тип поверхности GRIB {raw.get("typeOfFirstFixedSurface", "не определён")}')
