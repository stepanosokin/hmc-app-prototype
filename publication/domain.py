"""Shared durable selection and manifest resolution used by worker and API."""

import hashlib
import json
import os
from contextlib import contextmanager
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

from decoder.sampling import ManifestSampler, asset_path, canonical, file_hash

ROOT = Path('/assets')
PIPELINE = 't4.1'
STATES = ['discovered', 'staged', 'decoded', 'normalized', 'derivatives_ready', 'validated', 'published']


@contextmanager
def database():
    connection = psycopg2.connect(host='db', dbname='hmc', user=os.environ['DB_USER'],
                                 password=os.environ['DB_PASSWORD'], connect_timeout=5)
    try:
        with connection:
            with connection.cursor(cursor_factory=RealDictCursor) as cursor:
                yield cursor
    finally:
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
    return load_manifest(row['manifest_path'], row['manifest_sha256'])


def sampler(manifest: dict) -> ManifestSampler:
    return ManifestSampler(asset_path(ROOT, manifest['numerical_manifest']))
