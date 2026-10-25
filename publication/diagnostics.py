"""Private operator snapshot; no credentials, paths or exception messages leave probes."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import time

import requests

from decoder.inspect_forecast import SAMPLE_SHA256
from decoder.sampling import file_hash
from publication.domain import ROOT, database
from publication.recovery import MAX_STORAGE_BYTES, storage_bytes


def emit(service: str, event: str, **fields) -> None:
    print(json.dumps({'service': service, 'event': event,
                      'observed_at': datetime.now(timezone.utc).isoformat(), **fields}), flush=True)


def heartbeat() -> None:
    # One atomic, overwritten record, never an append-only diagnostic history.
    temporary = ROOT / '.worker-heartbeat.tmp'
    temporary.write_text(str(time.time()), encoding='ascii')
    temporary.replace(ROOT / '.worker-heartbeat')


def snapshot(now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    result: dict = {'observed_at': now.isoformat(), 'services': {}, 'publication': {'available': None}}
    services = result['services']
    try:
        source = Path('/input/ICON_EU_T_G_2026101500.grib2')
        services['source'] = {'ready': source.is_file() and file_hash(source) == SAMPLE_SHA256}
    except OSError:
        services['source'] = {'ready': False}
    try:
        age = max(0, time.time() - float((ROOT / '.worker-heartbeat').read_text()))
        services['worker'] = {'ready': age < 15, 'heartbeat_age_seconds': age}
    except (OSError, ValueError):
        services['worker'] = {'ready': False}
    try:
        with database(timeout=2) as cursor:
            cursor.execute("SET LOCAL statement_timeout = '2000ms'")
            cursor.execute("SELECT id,state,COALESCE(stage,CASE WHEN state='failed' THEN history->-2->>'state' "
                           "ELSE state END) AS stage,selection,submitted_at FROM app.jobs "
                           "WHERE state<>'published' ORDER BY submitted_at,id LIMIT 129")
            jobs = cursor.fetchall()
            result['jobs'] = [{'job_id': str(row['id']), 'state': row['state'], 'stage': row['stage'],
                               'selection': row['selection'],
                               'age_seconds': max(0, (now-row['submitted_at']).total_seconds())}
                              for row in jobs[:128]]
            result['jobs_truncated'] = len(jobs) > 128
            cursor.execute("SELECT state,count(*) AS count FROM app.jobs GROUP BY state")
            result['job_counts'] = cursor.fetchall()
            cursor.execute("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' "
                           "AND objid=16001 AND classid=0 AND granted) AS active")
            services['worker']['processing'] = cursor.fetchone()['active']
            services['worker']['ready'] |= services['worker']['processing']
            cursor.execute("SELECT min(submitted_at) AS oldest FROM app.jobs WHERE state NOT IN ('published','failed')")
            oldest = cursor.fetchone()['oldest']
            result['publication']['pending_lag_seconds'] = max(0, (now-oldest).total_seconds()) if oldest else 0
            cursor.execute('SELECT max(published_at) AS latest FROM '
                           '(SELECT published_at FROM app.catalogue UNION ALL SELECT published_at FROM app.revisions) p')
            latest = cursor.fetchone()['latest']
            result['publication']['last_commit_age_seconds'] = (
                max(0, (now-latest).total_seconds()) if latest else None)
            cursor.execute('SELECT days FROM access.usage_retention')
            result['usage_retention_days'] = cursor.fetchone()['days']
            cursor.execute("SELECT pg_total_relation_size('access.usage') AS bytes")
            result['usage_storage'] = cursor.fetchone()
        services['database'] = {'ready': True}
    except Exception:
        # An unavailable database must not suppress the remaining independent probes.
        services['database'] = {'ready': False}
    for name, url in [('api', 'http://api:8000/ops/diagnostics'),
                      ('gis', 'http://geoserver:8080/geoserver/web/')]:
        try:
            response = requests.get(url, timeout=3)
            services[name] = {'ready': response.status_code == 200}
            if name == 'api' and response.status_code == 200:
                result['tiles'] = response.json()
                services[name]['alive'] = True
                services[name]['ready'] = requests.get('http://api:8000/health', timeout=3).status_code == 200
        except (requests.RequestException, ValueError):
            services[name] = {'ready': False}
    try:
        response = requests.get('http://gateway:8000/api/v1/catalogue', timeout=5)
        response.raise_for_status()
        selections = response.json()['selections']
        # Discovery alone does not prove usable data. Probe a retained numeric product.
        usable = False
        if selections:
            selection = selections[-1]['selection']
            probe = requests.get(f'http://gateway:8000/api/v1/selections/{selection}/tiles.json', timeout=10)
            if probe.status_code == 200:
                url = probe.json()['url'].replace('{z}', '3').replace('{x}', '4').replace('{y}', '2')
                tile = requests.get('http://gateway:8000' + url, timeout=10)
                usable = tile.status_code == 200 and len(tile.content) == 332820
        result['publication'].update(available=usable, advertised_selections=len(selections))
    except (requests.RequestException, ValueError, KeyError):
        result['publication']['available'] = False
    try:
        disk = shutil.disk_usage(ROOT)
        result['storage'] = {'managed_bytes': storage_bytes(), 'budget_bytes': MAX_STORAGE_BYTES,
                             'free_bytes': disk.free}
    except OSError:
        result['storage'] = {'ready': False}
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clock', help='Explicit UTC diagnostic/demo clock, not a retention policy change')
    args = parser.parse_args()
    now = datetime.fromisoformat(args.clock.replace('Z', '+00:00')) if args.clock else None
    if now is not None and now.utcoffset() is None:
        parser.error('clock must include a timezone')
    print(json.dumps(snapshot(now), ensure_ascii=False))


if __name__ == '__main__':
    main()
