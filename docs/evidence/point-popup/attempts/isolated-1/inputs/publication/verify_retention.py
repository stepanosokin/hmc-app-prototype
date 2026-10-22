"""Recheck permanent expiry through the gateway after real service restart."""

import json
from pathlib import Path

import requests

from publication.verify_revisions import BASE


def main() -> None:
    evidence = json.loads(Path('/evidence/t7-retention.json').read_bytes())
    catalogue = requests.get(BASE + '/api/v1/catalogue', timeout=90)
    catalogue.raise_for_status()
    if catalogue.json()['selections']:
        raise ValueError('restart resurrected expired selections')
    for selection in evidence['expired_selections']:
        for suffix in ('/tiles.json', '/tiles/2/3/4/2.f32'):
            response = requests.get(BASE + '/api/v1/selections/' + selection + suffix, timeout=90)
            if response.status_code != 410 or response.headers.get('Cache-Control') != 'no-store':
                raise ValueError('restart lost permanent expiry')
    Path('/evidence/t7-restart.json').write_text(json.dumps({
        'status': 'passed', 'expired_selections': evidence['expired_selections'],
        'services': ['PostgreSQL', 'API', 'gateway', 'GeoServer']}, indent=2) + '\n')


if __name__ == '__main__':
    main()
