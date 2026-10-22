"""Recheck retained HTTP selections after restart and export immutable graph evidence."""

import argparse
import hashlib
import json
import time
from pathlib import Path
import xml.etree.ElementTree as ET

import requests

from publication import geoserver, revisions
from publication.domain import ROOT, database

BASE = 'http://gateway:8000'


def ready() -> None:
    for attempt in range(90):
        try:
            geoserver.admin('GET', '/about/version.json')
            response = requests.get(BASE + '/health', timeout=5)
            response.raise_for_status()
            return
        except requests.RequestException:
            time.sleep(1)
    raise RuntimeError('real services did not become ready')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ready-only', action='store_true')
    args = parser.parse_args()
    ready()
    if args.ready_only:
        return
    evidence = Path('/evidence')
    acceptance = json.loads((evidence / 't5-acceptance.json').read_bytes())
    catalogue = requests.get(BASE + '/api/v1/catalogue', timeout=90)
    catalogue.raise_for_status()
    selections = catalogue.json()['selections']
    old = next(item for item in selections if item['selection'] == acceptance['old_selection'])
    query = {key: old[key] for key in ('selection', 'run', 'revision', 'valid_time')}
    query.update(layer=old['field'], lon=-23.5, lat=29.5)
    point = requests.get(BASE + '/api/v1/point', params=query, timeout=90)
    point.raise_for_status()
    if point.json()['value'] != 298.2274169921875:
        raise ValueError('retained native value changed after restart')
    metadata = requests.get(BASE + old['tiles'], timeout=90)
    metadata.raise_for_status()
    url = metadata.json()['url'].replace('{z}', '3').replace('{x}', '4').replace('{y}', '2')
    tile = requests.get(BASE + url, timeout=90)
    tile.raise_for_status()
    if hashlib.sha256(tile.content).hexdigest() != acceptance['old_tile_sha256']:
        raise ValueError('retained tile changed after restart')
    discovery = []
    for revision in dict.fromkeys(item['revision'] for item in selections):
        items = [item for item in selections if item['revision'] == revision]
        capabilities = requests.get(BASE + items[0]['wms'], params={
            'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetCapabilities'}, timeout=90)
        capabilities.raise_for_status()
        root = ET.fromstring(capabilities.content)
        times = [node.text for node in root.findall('.//{*}Dimension') if node.get('name') == 'time']
        if times != [','.join(sorted({item['valid_time'] for item in items}))]:
            raise ValueError('revision discovery changed after restart')
        discovery.append({'revision': revision, 'times': times})
    with database() as cursor:
        cursor.execute('SELECT * FROM app.revisions ORDER BY published_at,revision')
        rows = cursor.fetchall()
    manifests = [revisions.load_revision(row['manifest_path'], row['manifest_sha256']) for row in rows]
    batches = {(entry['manifest_path'], entry['manifest_sha256']) for value in manifests for entry in value['batches']}
    gis_checks = []
    for relative, checksum in sorted(batches):
        from publication.domain import load_manifest
        batch = load_manifest(relative, checksum)
        gis_checks.append({'batch': batch['selection'], 'fixture': batch.get('fixture'),
                           'result': geoserver.verify(batch['gis'])})
    result = {'status': 'passed', 'retained_point_K': point.json()['value'],
              'retained_tile_sha256': hashlib.sha256(tile.content).hexdigest(), 'discovery': discovery,
              'real_geoserver_granule_and_identify_checks': gis_checks,
              'unique_batches': len(batches), 'revision_count': len(manifests),
              'revision_manifest_bytes': [int((ROOT / row['manifest_path']).stat().st_size) for row in rows],
              'revision_manifests': manifests}
    (evidence / 't5-restart-and-manifests.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: result[key] for key in ('status', 'unique_batches', 'revision_count', 'retained_point_K')}))


if __name__ == '__main__':
    main()
