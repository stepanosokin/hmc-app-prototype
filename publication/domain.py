"""Shared durable selection and manifest resolution used by worker and API."""

import hashlib
import json
import os
import time
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from functools import lru_cache

import pg8000.dbapi
from publication import reader_sessions
from publication.limited import request_deadline

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


_transaction: ContextVar[Records | None] = ContextVar('publication_transaction', default=None)


@contextmanager
def database_transaction():
    """Group related reads in one transaction without caching authorization/data."""
    with database() as cursor:
        token = _transaction.set(cursor)
        try:
            yield
        finally:
            _transaction.reset(token)


@contextmanager
def database(*, timeout: int = 5):
    deadline = request_deadline.get()
    if deadline is not None and deadline <= time.time():
        raise TimeoutError('publication request deadline exceeded')
    shared = _transaction.get()
    if shared is not None:
        yield shared
        return
    remaining = max(0.05, deadline-time.time()) if deadline is not None else timeout
    session = reader_sessions.acquire(min(timeout, remaining))
    connection = session.connection
    cursor = None
    healthy = False
    try:
        cursor = connection.cursor()
        if deadline is not None:
            remaining = deadline-time.time()
            if remaining <= 0:
                raise TimeoutError('publication request deadline exceeded')
            cursor.execute("SELECT set_config('statement_timeout',%s,true)", (str(max(1, int(remaining*1000))),))
        yield Records(cursor)
        connection.commit()
        healthy = True
    except BaseException:
        try:
            connection.rollback()
        except Exception:
            pass
        raise
    finally:
        try:
            if cursor is not None:
                cursor.close()
        except BaseException:
            healthy = False
            raise
        finally:
            reader_sessions.release(session, healthy)


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


@lru_cache(maxsize=64)
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
    from publication.retention import ensure
    ensure(selection.split('.', 1)[0])
    if '.' in selection:
        from publication.revisions import load_revision, selected
        revision, key = selection.split('.', 1)
        with database() as cursor:
            cursor.execute('SELECT manifest_path,manifest_sha256 FROM app.revisions WHERE revision=%s', (revision,))
            row = cursor.fetchone()
        if row is None:
            raise KeyError('unavailable published revision')
        try:
            manifest = load_revision(row['manifest_path'], row['manifest_sha256'])
            entries = [entry for entry in manifest['batches'] if entry['key'] == key]
            if not entries:
                raise KeyError('unavailable time in revision')
            return selected(manifest, entries[0])
        except (OSError, ValueError, TypeError, ValidationError) as error:
            raise PublicationUnavailable('published revision unavailable') from error
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
