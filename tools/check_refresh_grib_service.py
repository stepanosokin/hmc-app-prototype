"""Actual-source acceptance for the refresh_grib operator, on an isolated stand."""
import argparse
import json
import posixpath
import shutil
import time
import uuid
from pathlib import Path

import requests

from decoder.sampling import file_hash
from publication import grib_sync, recovery, worker
from publication.domain import database

BASE = 'http://gateway:8000'
EVIDENCE = Path('/evidence')


def catalogue() -> list[dict]:
    for _ in range(60):
        try:
            response = requests.get(BASE+'/api/v1/catalogue', timeout=10)
            response.raise_for_status()
            return response.json()['selections']
        except requests.RequestException:
            time.sleep(.5)
    raise RuntimeError('refreshed catalogue did not become ready')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['seed', 'verify', 'verify-empty'])
    args = parser.parse_args()
    if args.mode == 'seed':
        source = EVIDENCE/'input'/'removed.grib2'
        shutil.copyfile(EVIDENCE/'sample.grib2', source)
        job = recovery.submit('2026-10-19T05:00:00Z',
            {'hours':[1], 'fixture':'actual', 'recoverable':True, 'batch':uuid.uuid4().hex},
            source.name, file_hash(source), 0)
        assert worker.once(job)
        with database() as cursor:
            cursor.execute('SELECT state,error FROM app.jobs WHERE id=%s', (job,))
            result = cursor.fetchone()
        assert result is not None
        assert result['state'] == 'published', result
        old = catalogue()
        assert len(old) == 1
        (EVIDENCE/'old.json').write_text(json.dumps(old[0]))
        return
    records = catalogue()
    old = json.loads((EVIDENCE/'old.json').read_bytes())
    old_status = requests.get(BASE+old['native_display'], timeout=30).status_code
    assert old_status == 410, old_status
    root = EVIDENCE/('operations-empty' if args.mode == 'verify-empty' else 'operations with spaces')
    reports = list(root.glob('*/refresh.json'))
    assert len(reports) == 1
    status = json.loads(reports[0].read_text(encoding='utf-8-sig'))
    assert status['state'] == 'completed', status
    assert status['storage_budget_bytes'] == 68719476736
    if args.mode == 'verify-empty':
        assert not records
        assert status['grib_files'] == 0
        assert not (reports[0].parent/'load.stdout.log').exists()
    else:
        assert len(records) == 24, len(records)
        assert len({row['valid_time'] for row in records}) == 24
        with database() as cursor:
            cursor.execute('SELECT manifest_path,manifest_sha256 FROM app.revisions WHERE revision=%s', (records[0]['revision'],))
            row = cursor.fetchone()
        assert row is not None
        from publication import revisions
        revision = revisions.load_revision(row['manifest_path'], row['manifest_sha256'])
        expected = posixpath.normpath(status['input_directory'].replace('\\','/'))
        for entry in revision['batches']:
            batch = grib_sync.source_manifest(entry['manifest_path'], entry['manifest_sha256'])
            assert batch['source']['name'] == 'new-without-extension'
            assert posixpath.normpath(batch['source']['directory'].replace('\\','/')) == expected
    result = {'state':'passed','mode':args.mode,'selections':len(records),'old_status':old_status,
              'refresh_state':status['state'],'source_directory_recorded':args.mode == 'verify'}
    (EVIDENCE/(args.mode+'.json')).write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == '__main__':
    main()
