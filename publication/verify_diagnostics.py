"""T17 real-service operator exercises, driven by run-diagnostics.ps1."""

import argparse
import hashlib
import json
from pathlib import Path
import time

import requests

from publication.diagnostics import snapshot


def verify(phase: str) -> None:
    report = snapshot()
    base = 'http://gateway:8000'
    assert requests.get(base + '/ops/diagnostics', timeout=10).status_code == 404
    state = Path('/evidence/t17-retained.json')
    if phase == 'baseline':
        assert all(service['ready'] for service in report['services'].values()), report
        selected = requests.get(base + '/api/v1/catalogue', timeout=30).json()['selections'][0]
        url = base + selected['tiles']
        meta = requests.get(url, timeout=30).json()
        tile_url = base + meta['url'].replace('{z}', '3').replace('{x}', '4').replace('{y}', '2')
        tile = requests.get(tile_url, timeout=30)
        tile.raise_for_status()
        cold_url = base + meta['url'].replace('{z}', '4').replace('{x}', '8').replace('{y}', '5')
        state.write_text(json.dumps({'url': tile_url, 'cold_url': cold_url,
                                     'sha256': hashlib.sha256(tile.content).hexdigest()}))
    else:
        if phase in ('source', 'worker', 'api', 'gis', 'database'):
            assert report['services'][phase]['ready'] is False, report
        if phase == 'worker':
            assert report['publication']['pending_lag_seconds'] > 0, report
            assert any(row['state'] == 'discovered' for row in report['jobs']), report
        if phase in ('generation', 'cache'):
            before = report['tiles']['numeric'].get(phase + '_failure', 0)
            # The retained warm tile survives a fault affecting cold products.
            url = json.loads(state.read_bytes())['cold_url']
            response = requests.get(url, timeout=30)
            assert response.status_code == 503, (response.status_code, response.text)
            report = snapshot()
            assert report['tiles']['numeric'][phase + '_failure'] == before + 1, report
        if phase == 'job-linked':
            job = Path('/evidence/queued.stdout.log').read_text().strip()
            for _ in range(60):
                status = requests.get(base + '/api/v1/jobs/' + job, timeout=10)
                status.raise_for_status()
                if status.json()['state'] == 'published':
                    break
                time.sleep(1)
            assert status.json()['state'] == 'published', status.text
            selection = status.json()['selection']
            response = requests.get(base + '/api/v1/selections/' + selection + '/tiles.json', timeout=30)
            response.raise_for_status()
            report['linked_job'] = {'job_id': job, 'selection': selection,
                                    'request_id': response.headers['X-Request-ID']}
        if phase not in ('api', 'database'):
            retained = json.loads(state.read_bytes())
            attempts = []
            for _ in range(60 if phase == 'recovered' else 1):
                response = requests.get(retained['url'], timeout=30)
                attempts.append({'status': response.status_code,
                                 'request_id': response.headers.get('X-Request-ID')})
                if response.status_code == 200:
                    break
                time.sleep(0.5)
            if phase == 'recovered':
                report['recovery_attempts'] = attempts
            assert response.status_code == 200, response.text
            assert hashlib.sha256(response.content).hexdigest() == retained['sha256']
        else:
            assert report['publication']['available'] is False
    Path('/evidence/t17-' + phase + '.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'phase': phase, 'status': 'passed'}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['baseline', 'recovered', 'job-linked', 'source', 'worker', 'api', 'gis', 'database', 'generation', 'cache'])
    verify(parser.parse_args().phase)
