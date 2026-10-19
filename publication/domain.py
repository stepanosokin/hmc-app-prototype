"""Shared durable selection and manifest resolution used by worker and API."""

import hashlib
import json
import os
from contextlib import contextmanager
from pathlib import Path
from functools import lru_cache

import pg8000.dbapi

from decoder.sampling import ManifestSampler, asset_path, canonical, file_hash
from decoder.inspect_forecast import ValidationError

ROOT = Path('/assets')
PIPELINE = 't4.1'
STATES = ['discovered', 'staged', 'decoded', 'normalized', 'derivatives_ready', 'validated', 'published']


class PublicationUnavailable(RuntimeError):
    """A known selection exists but its durable storage or GIS is not ready."""


class Records:
    """Map PostgreSQL column names to the shared domain record shape."""

    def __init__(self, cursor):
        self.cursor = cursor

    def execute(self, query: str, parameters: tuple = ()) -> None:
        self.cursor.execute(query, parameters)

    def fetchone(self) -> dict | None:
        row = self.cursor.fetchone()
        return None if row is None else dict(zip((item[0] for item in self.cursor.description), row))

    def fetchall(self) -> list[dict]:
        names = [item[0] for item in self.cursor.description]
        return [dict(zip(names, row)) for row in self.cursor.fetchall()]


@contextmanager
def database():
    connection = pg8000.dbapi.connect(host='db', database='hmc', user=os.environ['DB_USER'],
                                     password=os.environ['DB_PASSWORD'], timeout=5, ssl_context=False)
    cursor = connection.cursor()
    try:
        yield Records(cursor)
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()


def write_once(path: Path, value: dict) -> str:
    payload = canonical(value)
    with path.open('xb') as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())
    path.chmod(0o444)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    return hashlib.sha256(payload).hexdigest()


@lru_cache(maxsize=8)
def load_manifest(relative: str, checksum: str) -> dict:
    path = asset_path(ROOT, relative)
    if file_hash(path) != checksum:
        raise ValueError('publication manifest integrity failed')
    manifest = json.loads(path.read_bytes())
    if manifest['pipeline_version'] != PIPELINE:
        raise ValueError('unsupported pipeline')
    for name, expected in manifest['assets'].items():
        target = asset_path(ROOT, name)
        if target.stat().st_size != expected['bytes'] or file_hash(target) != expected['sha256']:
            raise ValueError('publication asset integrity failed')
    return manifest


def resolve(selection: str) -> dict:
    with database() as cursor:
        cursor.execute('SELECT * FROM app.catalogue WHERE selection=%s', (selection,))
        row = cursor.fetchone()
    if row is None:
        raise KeyError('unavailable published selection')
    try:
        return load_manifest(row['manifest_path'], row['manifest_sha256'])
    except (OSError, ValueError, KeyError, TypeError, ValidationError) as error:
        raise PublicationUnavailable('published assets unavailable') from error


def sampler(manifest: dict) -> ManifestSampler:
    relative = manifest['numerical_manifest']
    try:
        return _verified_sampler(relative, manifest['assets'][relative]['sha256'])
    except (OSError, ValueError, KeyError, TypeError, ValidationError) as error:
        raise PublicationUnavailable('numerical assets unavailable') from error


@lru_cache(maxsize=8)
def _verified_sampler(relative: str, checksum: str) -> ManifestSampler:
    path = asset_path(ROOT, relative)
    if file_hash(path) != checksum:
        raise ValueError('numerical manifest integrity failed')
    return ManifestSampler(path)
