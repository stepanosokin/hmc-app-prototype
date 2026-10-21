"""Verify issue #38 evidence using the existing browser archive boundary."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path, PurePosixPath

root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(root / 'tools'))
from check_evidence import check_browser_report, verify  # noqa: E402

prefix = 'docs/evidence/fast-validation/'
index = json.loads((root / prefix / 'artifact-index.json').read_bytes())
artifacts = {item['path']: item for item in index['artifacts']}
assert len(artifacts) == len(index['artifacts']), 'Duplicate artifact'
for name, item in artifacts.items():
    path = PurePosixPath(name)
    assert not path.is_absolute() and '..' not in path.parts and '\\' not in name and ':' not in name
    if name.startswith(prefix):
        verify(root / name, item['sha256'], item['bytes'])
        payload = (root / name).read_bytes()
        assert hashlib.sha1(b'blob '+str(len(payload)).encode()+b'\0'+payload).hexdigest() == item['git_object']
actual = {p.relative_to(root).as_posix() for p in (root / prefix).rglob('*') if p.is_file() and p.name != 'artifact-index.json'}
assert actual == {name for name in artifacts if name.startswith(prefix)}, 'Archive coverage'
assert len(index['selected_reports']) == 2 and {item['browser'] for item in index['selected_reports']} == {'chrome', 'edge'}, 'Chrome/Edge matrix'
selected_inputs = []
for selection in index['selected_reports']:
    check_browser_report(root, prefix, selection, artifacts, 't24')
    report = json.loads((root / selection['report']).read_bytes())
    assert report['selection']['acceptance'] is True
    selected_inputs.append(report['inputs'])
assert selected_inputs[0] == selected_inputs[1], 'Frozen inputs differ between browsers'
for path in (root / prefix / 'attempts').rglob('validation.json'):
    report = json.loads(path.read_bytes())
    assert report['cleanup'] == {'browser_processes_remaining': 0, 'profile_removed': True,
                                 'compose_projects_created': 0, 'servers_created': 0}
    for name, checksum in report['inputs'].items():
        verify(path.parent / 'inputs' / name, checksum)
    if not report['selection']['acceptance']:
        assert 'not full acceptance' in report['scope']
        if report['status'] == 'failed':
            assert (path.parent / 'failure.png').is_file()
if len(sys.argv) > 1:
    # One Git inventory, not one process per archived file.
    assert sys.argv[1] in ('HEAD', '--staged')
    staged = sys.argv[1] == '--staged'
    args = ['git', 'ls-files', '--stage', '-z'] if staged else ['git', 'ls-tree', '-rz', 'HEAD']
    records = subprocess.check_output(args, cwd=root).decode('utf-8').split('\0')
    objects = {record.split('\t', 1)[1]: record.split('\t', 1)[0].split()[1 if staged else 2]
               for record in records if record}
    for name, item in artifacts.items():
        assert objects.get(name) == item['git_object'], f'Git identity: {name}'
print(f'Issue #38 archive passed: {len(artifacts)} artifacts, full Chrome/Edge + PROJ, all attempts cleaned.')
