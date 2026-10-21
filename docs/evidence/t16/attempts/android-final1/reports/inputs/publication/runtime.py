"""Check real interpreter startup/shutdown, including both native import orders."""

import importlib.metadata
import json
import subprocess
import sys
from pathlib import Path


def main() -> None:
    probes = [
        'from publication.tiles import coordinates; coordinates(3,4,2); from publication.domain import database',
        'from publication.domain import database; from publication.tiles import coordinates; coordinates(3,4,2)',
        'from publication.api import create_app; create_app()',
    ]
    results = []
    for script in probes:
        process = subprocess.run([sys.executable, '-c', script], capture_output=True, timeout=30)
        results.append({'python':script, 'exit_code':process.returncode,
                        'stderr':process.stderr.decode(errors='replace')[:1000]})
    report = {'status':'passed' if all(item['exit_code']==0 for item in results) else 'failed',
              'postgresql_driver':'pg8000/'+importlib.metadata.version('pg8000'), 'probes':results}
    Path('/evidence/native-runtime.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))
    if report['status'] != 'passed':
        raise SystemExit(1)


if __name__=='__main__':
    main()
