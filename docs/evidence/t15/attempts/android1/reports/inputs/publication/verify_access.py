"""Real edge-network and authorization-store failure probes for T8."""

import argparse
import json
from pathlib import Path
import socket

import requests


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--edge-only', action='store_true')
    args = parser.parse_args()
    if args.edge_only:
        for service, port in (('api', 8000), ('geoserver', 8080), ('db', 5432)):
            try:
                with socket.create_connection((service, port), timeout=3):
                    pass
            except OSError:
                continue
            raise RuntimeError('backend is reachable from edge: ' + service)
        response = requests.get('http://gateway:8000/org/api/v1/catalogue', timeout=10)
        if response.status_code != 401:
            raise RuntimeError('edge gateway did not enforce authorization')
        print(json.dumps({'status': 'passed', 'edge_backend_connections': 'denied', 'gateway': 401}))
        return
    evidence = Path('/evidence')
    selection = json.loads((evidence / 't8-access.json').read_bytes())
    token = (evidence / 't8-survivor.key').read_text().strip()
    response = requests.get('http://gateway:8000' + selection['tile'],
                            headers={'Authorization': 'Bearer ' + token}, timeout=30)
    if response.status_code != 503 or response.headers.get('Cache-Control') != 'no-store':
        raise RuntimeError('authorization store failure did not fail closed')
    (evidence / 't8-auth-store-failure.json').write_text(json.dumps({
        'status': 'passed', 'warm_numeric_tile_with_unavailable_key_store': 503}) + '\n')


if __name__ == '__main__':
    main()
