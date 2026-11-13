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
    return 'hmc_' + hashlib.sha256(json.dumps(scientific, sort_keys=True).encode()).hexdigest()


def title(manifest: dict) -> str:
    descriptor = manifest['source'].get('field_descriptor', {})
    label = descriptor.get('label', 'Температура поверхности')
    if descriptor.get('short_name') == 'T_G':
        label = 'Температура поверхности'
    return label + ', ' + descriptor.get('units', 'K')
