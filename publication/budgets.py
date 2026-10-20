"""Shared organization/demo admission and secret-free durable request accounting."""

import argparse
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import re
import uuid

from publication.domain import database


@dataclass(frozen=True)
class Limits:
    requests: int = 6000
    bytes: int = 512 * 1024**2
    concurrency: int = 4
    seconds: int = 30
    output: int = 4 * 1024**2
    dimension: int = 1024
    zoom: int = 6

    @classmethod
    def parse(cls, value: dict):
        bounds = {'requests': (1, 100000), 'bytes': (1024, 1024**3), 'concurrency': (1, 4),
                  'seconds': (1, 30), 'output': (512, 4 * 1024**2), 'dimension': (1, 1024), 'zoom': (0, 6)}
        if set(value) - set(bounds) or any(type(v) is not int or not bounds[k][0] <= v <= bounds[k][1]
                                          for k, v in value.items()):
            raise ValueError('unsupported policy field or bound')
        return cls(**value)


def migrate() -> None:
    with database() as cursor:
        cursor.execute('CREATE TABLE IF NOT EXISTS access.policies (bucket text PRIMARY KEY, limits jsonb NOT NULL)')
        cursor.execute('CREATE TABLE IF NOT EXISTS access.usage ('
                       'request_id uuid PRIMARY KEY, observed_at timestamptz NOT NULL DEFAULT clock_timestamp(), '
                       'bucket text NOT NULL, organization text, key_id uuid, operation text NOT NULL, '
                       'product text, run text, revision text, status integer, duration_ms double precision, '
                       "bytes bigint, cache text NOT NULL DEFAULT 'not-accessed', "
                       'admitted boolean NOT NULL DEFAULT false, expires_at timestamptz, reservation bigint NOT NULL DEFAULT 0, '
                       'backend_started boolean NOT NULL DEFAULT false, backend_done boolean NOT NULL DEFAULT false)')
        # Upgrade before CREATE INDEX takes a ShareLock. A later no-op ALTER
        # would upgrade that lock and deadlock with a reader's following INSERT.
        cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='access' AND table_name='usage'")
        columns = {row['column_name'] for row in cursor.fetchall()}
        for name in ('backend_started', 'backend_done'):
            if name not in columns:
                cursor.execute('ALTER TABLE access.usage ADD COLUMN IF NOT EXISTS ' + name + ' boolean NOT NULL DEFAULT false')
        cursor.execute('CREATE INDEX IF NOT EXISTS usage_window ON access.usage(bucket,observed_at)')
        cursor.execute('CREATE TABLE IF NOT EXISTS access.usage_retention '
                       '(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), days integer NOT NULL CHECK(days BETWEEN 1 AND 365))')
        cursor.execute('INSERT INTO access.usage_retention VALUES(true,30) ON CONFLICT DO NOTHING')
        cursor.execute('GRANT SELECT ON access.policies TO hmc_gateway')
        cursor.execute('GRANT SELECT,INSERT,UPDATE ON access.usage TO hmc_gateway')
        cursor.execute('GRANT USAGE ON SCHEMA access TO hmc_api')
        cursor.execute('GRANT SELECT(request_id,admitted,expires_at,backend_started,backend_done), '
                       'UPDATE(backend_started,backend_done) ON access.usage TO hmc_api')


def begin(event: dict, admit: bool) -> tuple[bool, Limits]:
    """Serialize admission across keys/workers; reserve worst-case output atomically."""
    with database() as cursor:
        cursor.execute("SET LOCAL statement_timeout = '2000ms'")
        cursor.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,9))', (event['bucket'],))
        cursor.execute('SELECT limits FROM access.policies WHERE bucket=%s', (event['bucket'],))
        row = cursor.fetchone()
        limits = Limits.parse(row['limits']) if row else Limits(concurrency=2, requests=3000) if event['bucket'] == 'public' else Limits()
        allowed = False
        if admit:
            cursor.execute('SELECT count(*) AS requests, '
                           'COALESCE(sum(COALESCE(bytes,reservation)),0) AS bytes, '
                           'count(*) FILTER (WHERE admitted AND (expires_at>clock_timestamp() OR '
                           '(backend_started AND NOT backend_done))) AS active '
                           'FROM access.usage WHERE bucket=%s AND '
                           "(observed_at > clock_timestamp()-interval '60 seconds' OR "
                           '(admitted AND (expires_at>clock_timestamp() OR (backend_started AND NOT backend_done))))', (event['bucket'],))
            usage = cursor.fetchone()
            assert usage is not None
            allowed = (usage['requests'] < limits.requests and usage['active'] < limits.concurrency
                       and usage['bytes'] + limits.output <= limits.bytes)
        cursor.execute('INSERT INTO access.usage(request_id,observed_at,bucket,organization,key_id,operation,admitted,expires_at,reservation) '
                       "VALUES(%s,%s,%s,%s,%s,%s,%s,clock_timestamp()+(%s * interval '1 second'),%s)",
                       (event['request_id'], event['observed_at'], event['bucket'], event['organization'], event['key_id'], event['operation'],
                        allowed, 40 if allowed else 0, limits.output if allowed else 0))
    return allowed, limits


def finish(event: dict) -> None:
    with database() as cursor:
        cursor.execute('UPDATE access.usage SET status=%s,duration_ms=%s,bytes=%s,cache=%s,product=%s,run=%s,revision=%s, '
                       'expires_at=CASE WHEN %s=504 THEN expires_at ELSE clock_timestamp() END '
                       'WHERE request_id=%s',
                       tuple(event[name] for name in ('status', 'duration_ms', 'bytes', 'cache', 'product', 'run', 'revision', 'status', 'request_id')))


def backend(request_id: str, *, done: bool = False) -> bool:
    """Explicit API completion; a timer cannot establish that file I/O stopped."""
    with database(timeout=2) as cursor:
        if done:
            cursor.execute('UPDATE access.usage SET backend_done=true WHERE request_id=%s RETURNING request_id', (request_id,))
        else:
            cursor.execute('UPDATE access.usage SET backend_started=true WHERE request_id=%s '
                           'AND admitted AND expires_at>clock_timestamp() AND NOT backend_done AND NOT backend_started '
                           'RETURNING request_id', (request_id,))
        return cursor.fetchone() is not None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('gis-limits')
    release = commands.add_parser('release')
    release.add_argument('--request-id', type=uuid.UUID, required=True,
                         help='Operator recovery only after API is stopped and its work is confirmed terminated')
    configure = commands.add_parser('configure')
    configure.add_argument('--file', type=Path, required=True)
    usage = commands.add_parser('usage')
    usage.add_argument('--limit', type=int, default=1000)
    for command in (configure, usage):
        profile = command.add_mutually_exclusive_group()
        profile.add_argument('--organization')
        profile.add_argument('--public', action='store_true')
    retention = commands.add_parser('retention')
    retention.add_argument('--days', type=int, required=True)
    collect = commands.add_parser('collect')
    collect.add_argument('--now', help='Isolated-test UTC collection clock only')
    args = parser.parse_args()
    try:
        if args.command == 'gis-limits':
            from publication.geoserver import configure_limits
            print(json.dumps(configure_limits()))
            return
        organization = getattr(args, 'organization', None)
        if organization and not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}', organization):
            raise ValueError('invalid organization identifier')
        bucket = 'org:' + organization if organization else 'public' if getattr(args, 'public', False) else None
        with database() as cursor:
            if args.command == 'configure':
                if bucket is None:
                    raise ValueError('select organization or public')
                limits = Limits.parse(json.loads(args.file.read_bytes()))
                cursor.execute('INSERT INTO access.policies VALUES(%s,%s::jsonb) ON CONFLICT(bucket) '
                               'DO UPDATE SET limits=excluded.limits', (bucket, json.dumps(asdict(limits))))
                result = {'bucket': bucket, 'limits': asdict(limits)}
            elif args.command == 'usage':
                if not 1 <= args.limit <= 10000:
                    raise ValueError('limit outside 1..10000')
                cursor.execute('SELECT * FROM (SELECT * FROM access.usage WHERE (%s::text IS NULL OR bucket=%s) '
                               'ORDER BY observed_at DESC,request_id DESC LIMIT %s) AS recent ORDER BY observed_at,request_id',
                               (bucket, bucket, args.limit))
                result = {'requests': cursor.fetchall()}
            elif args.command == 'retention':
                if not 1 <= args.days <= 365:
                    raise ValueError('days outside 1..365')
                cursor.execute('UPDATE access.usage_retention SET days=%s', (args.days,))
                result = {'days': args.days}
            elif args.command == 'release':
                cursor.execute('UPDATE access.usage SET backend_done=true,expires_at=clock_timestamp() '
                               'WHERE request_id=%s RETURNING request_id', (str(args.request_id),))
                result = {'released': [str(row['request_id']) for row in cursor.fetchall()]}
            else:
                cursor.execute('DELETE FROM access.usage WHERE observed_at < '
                               "COALESCE(%s::timestamptz,clock_timestamp()) - "
                               "(SELECT days * interval '1 day' FROM access.usage_retention) "
                               "AND observed_at < clock_timestamp()-interval '60 seconds' "
                               'AND NOT (backend_started AND NOT backend_done) '
                               'AND (status IS NOT NULL OR expires_at<clock_timestamp()) RETURNING request_id', (args.now,))
                result = {'deleted': len(cursor.fetchall())}
        print(json.dumps(result, default=str))
    except Exception as error:
        parser.exit(1, 'Usage command failed: ' + type(error).__name__ + '\n')


if __name__ == '__main__':
    main()
