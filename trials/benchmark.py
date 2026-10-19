"""Equivalent, agreement/correctness-gated numerical adapter measurements."""

import argparse
import hashlib
import json
import math
import os
import random
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from decoder.sampling import canonical, file_hash
from trials import ROOT
from trials.fixture import atomic_json
from trials.preflight import agreement
from trials.validate import fingerprint

REPORTS = Path('/reports')


def corpus() -> list[dict]:
    baseline = json.loads(Path('/app/baseline-a1.json').read_text())['messages']
    identity = json.loads((ROOT / 'index.json').read_text())['actual']
    rng = random.Random(15)
    requests = []
    # Exactly 40% domain point, 40% EDR position, 20% scoped metadata.
    for index in range(1000):
        message = baseline[index % len(baseline)]
        cell = rng.choice(message['grid']['cell_centres'])
        operation = ['domain', 'edr', 'domain', 'edr', 'metadata'][index % 5]
        if operation == 'metadata':
            path, query, expected = '/ogc/collections', identity, None
        elif operation == 'domain':
            path = '/api/v1/point'
            query = {**identity, 'layer': 'surface-temperature', 'valid_time': message['valid_time'],
                     'lon': cell['lon'], 'lat': cell['lat']}
            expected = cell['value']
        else:
            path = '/ogc/collections/surface-temperature/position'
            query = {**identity, 'datetime': message['valid_time'], 'parameter-name': 'T_G',
                     'coords': f"POINT({cell['lon']} {cell['lat']})", 'f': 'json'}
            expected = cell['value']
        requests.append({'operation': operation, 'path': path, 'query': query, 'expected_value': expected})
    return requests


def fetch(candidate: str, item: dict, token: str) -> dict:
    url = f"http://gateway:8000/{candidate}{item['path']}?{urlencode(item['query'])}"
    started = time.perf_counter()
    status, body, correct, cache = 0, b'', False, None
    try:
        try:
            response = urlopen(Request(url, headers={'X-API-Key': token}), timeout=10)
        except HTTPError as error:
            response = error
        with response:
            status, body, cache = response.status, response.read(65537), response.headers.get('X-Cache')
        document = json.loads(body)
        if status == 200:
            if item['operation'] == 'metadata':
                selection = document['collections'][0]['selection']
                correct = len(selection['valid_times']) == 24
            else:
                selection = document['selection'] if item['operation'] == 'edr' else document
                correct = selection['value'] == item['expected_value'] and selection['reason'] is None
                if item['operation'] == 'edr':
                    correct = correct and document['ranges']['T_G']['values'] == [item['expected_value']]
            correct = (correct and selection['run'] == item['query']['run']
                       and selection['revision'] == item['query']['revision'])
            if item['operation'] != 'metadata':
                correct = correct and selection['valid_time'] == item['query'].get('valid_time', item['query'].get('datetime'))
    except (URLError, TimeoutError, OSError, ValueError, KeyError, IndexError):
        correct = False
    return {'operation': item['operation'], 'status': status, 'correct': correct,
            'elapsed_ms': (time.perf_counter() - started) * 1000, 'response_body_bytes': len(body),
            'response_sha256': hashlib.sha256(body).hexdigest(), 'cache': cache}


def percentiles(rows: list[dict]) -> dict:
    values = sorted(row['elapsed_ms'] for row in rows if row['correct'] and row['status'] == 200)
    return {f'p{p}_ms': values[max(0, math.ceil(len(values) * p / 100) - 1)] if values else None
            for p in [50, 95, 99]}


def telemetry(host: str) -> dict:
    with urlopen(f'http://{host}:8000/metrics', timeout=5) as response:
        return json.loads(response.read())


def freshness(candidate: str, token: str) -> dict:
    index = json.loads((ROOT / 'index.json').read_text())
    initial = ['actual/manifest.json', 'masked/manifest.json']
    item = {'operation': 'metadata', 'path': '/ogc/collections', 'query': index['revised']}
    def get_revision(identity):
        with urlopen(Request(f'http://gateway:8000/{candidate}/ogc/collections?' + urlencode(identity),
                             headers={'X-API-Key': token}), timeout=10) as response:
            return json.loads(response.read())['collections'][0]['selection']
    try:
        atomic_json(ROOT / 'catalog.json', initial)
        get_revision(index['actual'])
        before = fetch(candidate, item, token)
        if before['status'] != 404:
            raise ValueError('new trial revision was already visible')
        started = time.perf_counter()
        atomic_json(ROOT / 'catalog.json', initial + ['actual/revised.json'])
        selected = get_revision(index['revised'])
        elapsed = (time.perf_counter() - started) * 1000
        if len(selected['valid_times']) != 12 or len(get_revision(index['actual'])['valid_times']) != 24:
            raise ValueError('revision routing lost availability identity')
        atomic_json(ROOT / 'catalog.json', initial + ['actual/missing.json'])
        if len(get_revision(index['actual'])['valid_times']) != 24:
            raise ValueError('failed update lost old reader')
        return {'numerical_manifest_visibility_ms': elapsed, 'old_revision_preserved': True,
                'failed_refresh_preserved_old_reader': True, 'geoserver_publication_ms': None,
                'scope': 'synthetic availability revision over real immutable assets; numerical discovery only; not M2/M3 GIS publication freshness'}
    finally:
        atomic_json(ROOT / 'catalog.json', initial)
        get_revision(index['actual'])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate', choices=['narrow', 'pygeoapi'])
    parser.add_argument('--repetition', type=int, required=True)
    parser.add_argument('--startup-seconds', type=float, required=True)
    args = parser.parse_args()
    agreed = agreement(Path('/app/trials/agreement.json'))
    correctness = json.loads((REPORTS / 'correctness.json').read_text())
    if correctness['status'] != 'passed' or correctness['fingerprint'] != fingerprint():
        raise ValueError('current data/toolchain require passing gateway correctness before measurement')
    requests = corpus()
    corpus_hash = hashlib.sha256(canonical(requests)).hexdigest()
    atomic_json(REPORTS / 'request-corpus.json', requests)
    token = json.loads((ROOT / 'secrets.json').read_text())['main']
    limits = telemetry(args.candidate)
    quota, period = map(int, limits['cpu_max'].split())
    if quota / period != agreed['cpus'] or limits['memory_limit_bytes'] != agreed['memory_mib'] * 1024 ** 2:
        raise ValueError('actual cgroup CPU/RAM limits differ from user agreement')
    first: list[dict] = []
    for operation in ['metadata', 'domain', 'edr']:
        row = fetch(args.candidate, next(item for item in requests if item['operation'] == operation), token)
        row['prior_operations_since_restart'] = [item['operation'] for item in first]
        first.append(row)
    warmups = [fetch(args.candidate, item, token) for item in requests[:50]]
    before = {name: telemetry(name) for name in [args.candidate, 'gateway']}
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=agreed['concurrency']) as pool:
        rows = list(pool.map(lambda item: fetch(args.candidate, item, token), requests))
    elapsed = time.perf_counter() - started
    after = {name: telemetry(name) for name in [args.candidate, 'gateway']}
    successful = sum(row['correct'] and row['status'] == 200 for row in rows)
    operations = {operation: {'count': len(subset), **percentiles(subset),
                               'errors': sum(not row['correct'] for row in subset),
                               'successful_rps_in_mixed_workload': sum(row['correct'] for row in subset) / elapsed,
                               'response_body_bytes': sum(row['response_body_bytes'] for row in subset)}
                  for operation in ['domain', 'edr', 'metadata']
                  for subset in [[row for row in rows if row['operation'] == operation]]}
    point = percentiles([row for row in rows if row['operation'] != 'metadata'])
    metadata = operations['metadata']
    thresholds_passed = (successful == len(rows) and successful / elapsed >= agreed['min_success_rps']
                         and all(operations[operation][f'p{p}_ms'] <= agreed[f'point_p{p}_ms']
                                 for operation in ['domain', 'edr'] for p in [95, 99])
                         and all(metadata[f'p{p}_ms'] <= agreed[f'metadata_p{p}_ms'] for p in [95, 99])
                         and all(row['correct'] and row['elapsed_ms'] <= agreed[
                             'metadata_p99_ms' if row['operation'] == 'metadata' else 'point_p99_ms'] for row in first)
                         and all(row['correct'] for row in warmups))
    resources = {}
    for name in before:
        cpu = after[name]['cgroup_cpu']['usage_usec'] - before[name]['cgroup_cpu']['usage_usec']
        resources[name] = {'before': before[name], 'after': after[name], 'cpu_seconds': cpu / 1e6,
                           'cpu_one_core_percent': cpu / 1e6 / elapsed * 100,
                           'cgroup_io_delta': ({key: after[name]['cgroup_io'].get(key, 0) - before[name]['cgroup_io'].get(key, 0)
                                               for key in set(before[name]['cgroup_io']) | set(after[name]['cgroup_io'])}
                                              if before[name]['cgroup_io'] and after[name]['cgroup_io'] else None),
                           'worker_io_delta': {key: after[name]['worker_io'][key] - before[name]['worker_io'][key]
                                               for key in before[name]['worker_io']}}
    report = {'candidate': args.candidate, 'repetition': args.repetition,
              'status': 'passed' if thresholds_passed else 'failed', 'agreement': agreed,
              'fingerprint': correctness['fingerprint'], 'image_id': os.environ['TRIAL_IMAGE_ID'],
              'request_corpus_sha256': corpus_hash, 'manifest_index': json.loads((ROOT / 'index.json').read_text()),
              'zarr_layout': {name: json.loads((ROOT / 'actual/hour-01.zarr' / name / '.zarray').read_text())
                              for name in ['temperature', 'missing', 'longitude', 'latitude']},
              'lock_sha256': {str(path.name): file_hash(path) for path in Path('/app').glob('requirements*.lock')},
              'percentile_estimator': 'nearest rank, successful semantically correct responses only',
              'cache_phase': '50 warm-up requests; gateway cache bypassed; host page cache uncontrolled',
              'first_operations_after_process_restart': first, 'warmup_errors': sum(not row['correct'] for row in warmups),
              'compose_recreate_to_healthy_seconds': args.startup_seconds,
              'elapsed_seconds': elapsed, 'count': len(rows), 'successful': successful,
              'successful_rps': successful / elapsed, 'errors': len(rows) - successful,
              'error_rate': 1 - successful / len(rows), 'operations': operations,
              'point_combined': point, 'resources': resources, 'requests': rows,
              'publication_freshness': freshness(args.candidate, token)}
    atomic_json(REPORTS / f'{args.candidate}-{args.repetition}.json', report)
    print(json.dumps({key: report[key] for key in ['candidate', 'repetition', 'status', 'successful_rps', 'errors', 'operations']}))
    return 0 if thresholds_passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
