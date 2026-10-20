"""Organization keys: private one-time delivery, hashed storage, uncached checks."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import uuid

from publication.domain import database

PROFILES = {'numeric': ('api',), 'gis': ('gis',), 'all': ('api', 'gis')}
KEY_PATTERN = re.compile(r'hmc_[0-9a-f]{32}_[A-Za-z0-9_-]{43}')


def migrate() -> None:
    """Add key metadata without changing publication/API reader privileges."""
    with database() as cursor:
        cursor.execute('CREATE TABLE IF NOT EXISTS access.keys ('
                       'id uuid PRIMARY KEY, organization text NOT NULL, digest text UNIQUE NOT NULL, '
                       "profile text NOT NULL CHECK(profile IN ('numeric','gis','all')), "
                       'created_at timestamptz NOT NULL DEFAULT clock_timestamp(), revoked_at timestamptz)')
        cursor.execute('GRANT USAGE ON SCHEMA access TO hmc_gateway')
        cursor.execute('GRANT SELECT ON access.keys TO hmc_gateway')


def authorize(token: str, scope: str) -> int:
    """Observe committed revocations on every call, before upstream cache access."""
    if not KEY_PATTERN.fullmatch(token):
        return 401
    digest = hashlib.sha256(token.encode('ascii')).hexdigest()
    with database() as cursor:
        cursor.execute('SELECT profile FROM access.keys WHERE digest=%s AND revoked_at IS NULL', (digest,))
        row = cursor.fetchone()
    if row is None:
        return 401
    return 200 if scope in PROFILES[row['profile']] else 403


def issue(organization: str, profile: str, output: Path, previous: str | None = None) -> dict:
    """Failed exclusive-file delivery cannot revoke the previous credential."""
    key_id = uuid.uuid4()
    token = 'hmc_' + key_id.hex + '_' + secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode('ascii')).hexdigest()
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(token + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        with database() as cursor:
            if previous is not None:
                cursor.execute('UPDATE access.keys SET revoked_at=clock_timestamp() '
                               'WHERE id=%s AND revoked_at IS NULL RETURNING organization,profile', (previous,))
                row = cursor.fetchone()
                if row is None:
                    raise ValueError('active key not found')
                organization, profile = row['organization'], row['profile']
            cursor.execute('INSERT INTO access.keys(id,organization,digest,profile) VALUES(%s,%s,%s,%s)',
                           (str(key_id), organization, digest, profile))
    except BaseException:
        output.unlink(missing_ok=True)
        raise
    return {'id': str(key_id), 'organization': organization, 'profile': profile}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('migrate')
    create = commands.add_parser('create')
    create.add_argument('--organization', required=True)
    create.add_argument('--profile', choices=PROFILES, required=True)
    create.add_argument('--out', type=Path, required=True)
    rotate = commands.add_parser('rotate')
    rotate.add_argument('--id', type=uuid.UUID, required=True)
    rotate.add_argument('--out', type=Path, required=True)
    revoke = commands.add_parser('revoke')
    revoke.add_argument('--id', type=uuid.UUID, required=True)
    commands.add_parser('list')
    args = parser.parse_args()
    try:
        if args.command == 'migrate':
            migrate()
            result = {'status': 'ready'}
        elif args.command == 'create':
            if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}', args.organization):
                raise ValueError('organization must be an identifier of 1..64 characters')
            result = issue(args.organization, args.profile, args.out)
        elif args.command == 'rotate':
            result = issue('', 'all', args.out, str(args.id))
        elif args.command == 'revoke':
            with database() as cursor:
                cursor.execute('UPDATE access.keys SET revoked_at=COALESCE(revoked_at,clock_timestamp()) '
                               'WHERE id=%s RETURNING id', (str(args.id),))
                if cursor.fetchone() is None:
                    raise ValueError('key not found')
            result = {'id': str(args.id), 'status': 'revoked'}
        else:
            with database() as cursor:
                cursor.execute('SELECT id,organization,profile,created_at,revoked_at FROM access.keys ORDER BY created_at,id')
                result = {'keys': cursor.fetchall()}
        print(json.dumps(result, default=str))
    except Exception as error:
        parser.exit(1, 'Key command failed: ' + type(error).__name__ + '\n')


if __name__ == '__main__':
    main()
