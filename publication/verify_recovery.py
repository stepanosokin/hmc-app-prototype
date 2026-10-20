"""Read back retained gateway selections after restart and source disappearance."""

import argparse
import hashlib
import json
from pathlib import Path

import requests

from publication.verify_revisions import ready
from decoder.sampling import file_hash

BASE = 'http://gateway:8000'


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs', type=Path)
    parser.add_argument('--base-commit')
    parser.add_argument('--clock', default='2026-10-19T07:00:00Z', help='Effective explicit acceptance clock for input evidence')
    args = parser.parse_args()
    evidence = Path('/evidence')
    if args.inputs:
        root = args.inputs
        files = [path for directory in ('publication', 'decoder', 'tests', 'tools', 'trials')
                 for path in (root / directory).rglob('*') if path.suffix in ('.py', '.ps1', '.json', '.sql', '.sh')]
        files.extend(path for path in root.iterdir() if path.name.startswith(('requirements', 'Dockerfile', 'compose')))
        files.extend([root / '.github/workflows/checks.yml', root / 'AGENTS.md', root / 'docs/development-workflow.md'])
        value = {'base_commit': args.base_commit, 'source_mode': 'read-only bind mounts in pinned image',
                 'clock': args.clock, 'inputs': [
                     {'path': path.relative_to(root).as_posix(), 'bytes': path.stat().st_size, 'sha256': file_hash(path)}
                     for path in sorted(files) if path.is_file()],
                 'actual_source_sha256': file_hash(Path('/input/ICON_EU_T_G_2026101500.grib2'))}
        (evidence / 'inputs.json').write_text(json.dumps(value, indent=2) + '\n')
        return
    ready()
    crashes = json.loads((evidence / 't6-crashes.json').read_bytes())
    old_selection = crashes['old_selection']
    response = requests.get(BASE + '/api/v1/catalogue', timeout=90)
    response.raise_for_status()
    selections = response.json()['selections']
    old = next(item for item in selections if item['selection'] == old_selection)
    query = {key: old[key] for key in ('selection', 'run', 'revision', 'valid_time')}
    query.update(layer=old['field'], lon=-23.5, lat=29.5)
    point = requests.get(BASE + '/api/v1/point', params=query, timeout=90)
    point.raise_for_status()
    metadata = requests.get(BASE + old['tiles'], timeout=90)
    metadata.raise_for_status()
    url = metadata.json()['url'].replace('{z}', '3').replace('{x}', '4').replace('{y}', '2')
    tile = requests.get(BASE + url, timeout=90)
    tile.raise_for_status()
    wms = requests.get(BASE + old['wms'], params={
        'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap', 'LAYERS': 'temperature',
        'TIME': old['valid_time'], 'CRS': 'EPSG:3857', 'BBOX': '-1000000,5000000,3000000,9000000',
        'WIDTH': 64, 'HEIGHT': 64, 'FORMAT': 'image/png', 'STYLES': ''}, timeout=90)
    wms.raise_for_status()
    observed = [point.json()['value'], hashlib.sha256(tile.content).hexdigest(), hashlib.sha256(wms.content).hexdigest()]
    if observed != crashes['observations'][0]['retained_reader']:
        raise ValueError('old immutable reader changed after restart')
    job = (evidence / 'detached-delivery.stdout.log').read_text().strip()
    status = requests.get(BASE + '/api/v1/jobs/' + job, timeout=90)
    status.raise_for_status()
    if status.json()['state'] != 'published' or Path('/input/removable.grib2').exists():
        raise ValueError('managed-source recovery did not publish after source removal')
    if not any(item['selection'] == status.json()['selection'] for item in selections):
        raise ValueError('detached-source result is absent from catalogue')
    (evidence / 't6-restart.json').write_text(json.dumps({'status': 'passed', 'old_selection': old_selection,
        'retained_reader': observed, 'source_removed_job': status.json(),
        'catalogue_selections': len(selections), 'cache': 'cold API process after restart'}, indent=2) + '\n')
    print('Retained point, numeric tile, WMS and managed-source publication passed after real service restart')


if __name__ == '__main__':
    main()
