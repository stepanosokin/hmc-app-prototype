"""T18: compare public pinned selections across a full-volume restore, never keys."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

BASE = 'http://gateway:8000'


def command(module: str, *arguments: str) -> dict:
    result = subprocess.run([sys.executable, '-m', module, *arguments], capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError('operator command failed: ' + module)
    return json.loads(result.stdout)


def observe(pinned: list[str] | None = None) -> dict:
    def get(url: str, **kwargs):
        response = requests.get(BASE + url, timeout=90, **kwargs)
        response.raise_for_status()
        return response

    selections = get('/api/v1/catalogue').json()['selections']
    actual = [item for item in selections if item['fixture'] == 'actual']
    if not actual:
        raise ValueError('actual-source publication missing')
    readers = []
    for item in ([next(item for item in actual if item['selection'] == selection) for selection in pinned]
                 if pinned else [actual[0], actual[-1]]):
        query = {key: item[key] for key in ('selection', 'run', 'revision', 'valid_time')}
        query.update(layer=item['field'], lon=-23.5, lat=29.5)
        point = get('/api/v1/point', params=query).json()
        tiles = get(item['tiles']).json()
        if tiles['identity'] != point['identity']:
            raise ValueError('point/tile selection mismatch')
        tile_url = tiles['url'].replace('{z}', '3').replace('{x}', '4').replace('{y}', '2')
        tile = get(tile_url)
        if tile.headers.get('Cache-Control') != 'private, no-cache':
            raise ValueError('browser tile may be reused without revalidation')
        if get(tile_url).content != tile.content:
            raise ValueError('warm tile differs from cold tile')
        native = get(item['native_display']).json()
        if native['identity'] != point['identity']:
            raise ValueError('native/point selection mismatch')
        native_url = native['url'].replace('{column}', '0').replace('{row}', '0')
        block = get(native_url)
        wms = get(item['wms'], params={
            'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap', 'LAYERS': 'temperature',
            'TIME': item['valid_time'], 'CRS': 'EPSG:3857', 'BBOX': '-1000000,5000000,3000000,9000000',
            'WIDTH': 64, 'HEIGHT': 64, 'FORMAT': 'image/png', 'STYLES': ''})
        if not wms.content.startswith(b'\x89PNG'):
            raise ValueError('scoped WMS did not produce PNG')
        readers.append({'selection': item['selection'], 'identity': point['identity'], 'point': point, 'point_query': query,
                        'tiles': tiles, 'native': native,
                        'tile_sha256': hashlib.sha256(tile.content).hexdigest(),
                        'native_sha256': hashlib.sha256(block.content).hexdigest(),
                        'wms_sha256': hashlib.sha256(wms.content).hexdigest(),
                        'wms_url': item['wms'],
                        'tile_url': tile_url, 'tile_etag': tile.headers['ETag'],
                        'browser_cache': tile.headers.get('Cache-Control')})
    retention = command('publication.retention', 'report')
    # Supplement the HTTP gates with the persisted usage-retention setting (no public read command).
    from publication.domain import database
    with database() as cursor:
        cursor.execute('SELECT days FROM access.usage_retention WHERE singleton')
        usage_days = cursor.fetchone()['days']
    return {'catalogue': sorted(item['selection'] for item in selections), 'readers': readers,
            'keys': command('publication.access', 'list'),
            'retention_policy': retention['policy'],
            'usage_retention_days': usage_days,
            'retention_roots': [{key: item[key] for key in ('root', 'state', 'expires_at')}
                                for item in retention['roots']],
            'usage_ids': [item['request_id'] for item in command('publication.budgets', 'usage', '--limit', '10000')['requests']]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['before', 'after', 'resumed', 'expired'])
    args = parser.parse_args()
    baseline = Path('/evidence/t18-before.json')
    if args.phase == 'before':
        policy_file = Path('/evidence/t18-budget-policy.json')
        policy_file.write_text(json.dumps({'zoom': 2}))
        command('publication.budgets', 'configure', '--organization', 'beta', '--file', str(policy_file))
        command('publication.budgets', 'retention', '--days', '17')
        baseline.write_text(json.dumps(observe(), indent=2) + '\n')
        return
    expected = json.loads(baseline.read_bytes())
    if args.phase == 'expired':
        # Observe ordinary recorded traffic until it leaves the active 60-second accounting window.
        deadline = time.monotonic() + 65
        while True:
            records = command('publication.budgets', 'usage', '--limit', '10000')['requests']
            oldest = min(datetime.fromisoformat(item['observed_at']) for item in records)
            if (datetime.now(timezone.utc) - oldest).total_seconds() > 61:
                break
            if time.monotonic() > deadline:
                raise ValueError('usage did not leave active window')
            time.sleep(2)
        now = datetime.now(timezone.utc)
        kept = command('publication.budgets', 'collect', '--now', (now + timedelta(days=16)).isoformat())
        removed = command('publication.budgets', 'collect', '--now', (now + timedelta(days=18)).isoformat())
        if kept['deleted'] != 0 or removed['deleted'] < 1:
            raise ValueError('restored 17-day usage policy ineffective')
        command('publication.retention', 'configure', '--days', '7', '--clock', '2026-11-20T00:00:00Z')
        reader = expected['readers'][0]
        responses = {}
        for name, url in [('tile', reader['tile_url']),
                          ('metadata', '/api/v1/selections/' + reader['selection'] + '/tiles.json'),
                          ('native', reader['native']['metadata_url']),
                          ('wms', reader['wms_url'])]:
            response = requests.get(BASE + url, headers={'If-None-Match': reader['tile_etag']},
                                    params={'SERVICE': 'WMS', 'REQUEST': 'GetCapabilities'} if name == 'wms' else {}, timeout=90)
            if response.status_code != 410:
                raise ValueError('expired cached selection revived: ' + name)
            responses[name] = response.status_code
        response = requests.get(BASE + '/api/v1/point', params=reader['point_query'], timeout=90)
        if response.status_code != 410:
            raise ValueError('expired canonical point revived')
        responses['point'] = response.status_code
        Path('/evidence/t18-expired.json').write_text(json.dumps({
            'status': 'passed', 'old_etag_requests': responses, 'usage_kept_16_days': kept,
            'usage_collected_18_days': removed, 'policy_days': 17}, indent=2) + '\n')
        return
    # Health precedes bounded retained-reader readiness; GeoServer startup is asynchronous.
    deadline = time.monotonic() + 180
    while True:
        try:
            observed = observe([item['selection'] for item in expected['readers']])
            break
        except requests.RequestException:
            if time.monotonic() >= deadline:
                raise
            time.sleep(2)
    for key in expected:
        if key == 'usage_ids':
            if not set(expected[key]) <= set(observed[key]):
                raise ValueError('restored usage history is incomplete')
        elif args.phase == 'resumed' and key in ('catalogue', 'retention_roots'):
            if key == 'catalogue' and not set(expected[key]) < set(observed[key]):
                raise ValueError('queued delivery did not add a publication')
        elif expected[key] != observed[key]:
            raise ValueError('restored state differs: ' + key)
    token = Path('/evidence/t8-survivor.key').read_text().strip()
    reader = expected['readers'][0]
    conditional = requests.get(BASE + reader['tile_url'], headers={'If-None-Match': reader['tile_etag']}, timeout=90)
    if conditional.status_code not in (200, 304) or conditional.headers.get('ETag') != reader['tile_etag']:
        raise ValueError('retained browser validator changed')
    protected = json.loads(Path('/evidence/t8-access.json').read_bytes())
    # A persisted non-default zoom policy rejects this z=3 URL even with a valid key.
    denied = requests.get(BASE + protected['tile'], headers={'Authorization': 'Bearer ' + token}, timeout=90)
    if denied.status_code != 400:
        raise ValueError('restored zoom budget ineffective')
    revoked = Path('/evidence/t8-revoked.key').read_text().strip()
    denied = requests.get(BASE + protected['tile'], headers={'Authorization': 'Bearer ' + revoked}, timeout=90)
    if denied.status_code != 401:
        raise ValueError('revoked key revived after restoration')
    permitted = requests.get(BASE + protected['tiles'], headers={'Authorization': 'Bearer ' + token}, timeout=90)
    permitted.raise_for_status()
    for file in Path('/evidence').rglob('*'):
        if file.is_file() and file.suffix in ('.json', '.jsonl', '.log'):
            payload = file.read_bytes()
            if token.encode() in payload or revoked.encode() in payload:
                raise ValueError('raw API key in evidence')
    if args.phase == 'resumed':
        identifier = Path('/evidence/queued.stdout.log').read_text().strip()
        job = requests.get(BASE + '/api/v1/jobs/' + identifier, timeout=90)
        job.raise_for_status()
        if job.json()['state'] != 'published':
            raise ValueError('queued job did not recover')
        replay = subprocess.run([sys.executable, '-m', 'publication.worker', 'submit', '--recoverable',
                                 '--clock', '2026-10-19T07:00:00Z', '--hours', '21'],
                                capture_output=True, text=True, timeout=120)
        if replay.returncode or replay.stdout.strip() != identifier:
            raise ValueError('queued delivery lost idempotency')
    Path('/evidence/t18-' + args.phase + '.json').write_text(json.dumps({
        'status': 'passed', 'preserved': list(expected), 'observed': observed,
        'cache': 'new API process; deterministic numeric/native bytes and scoped WMS preserved'}, indent=2) + '\n')
    print('Restored catalogue, point, numeric/native tiles, WMS, key metadata, retention and usage agree')


if __name__ == '__main__':
    main()
