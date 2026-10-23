"""Create isolated, actual-sample trial data and explicitly labelled supplements."""

import hashlib
import json
import secrets
from pathlib import Path

from decoder.sampling import ManifestSampler, canonical
from decoder.storage import build, verify

ROOT = Path('/fixtures')
CLOCK = '2026-10-19T00:00:00Z'
SOURCE = Path('/input/ICON_EU_T_G_2026101500.grib2')


def atomic_json(path: Path, value: object) -> None:
    temporary = path.with_suffix('.pending')
    temporary.write_bytes(canonical(value))
    temporary.replace(path)


def main() -> None:
    ROOT.mkdir(exist_ok=True)
    ROOT.chmod(0o777)  # Isolated test control directory; readers mount it read-only.
    for name, synthetic in [('actual', False), ('masked', True)]:
        target = ROOT / name
        if not target.exists():
            report = build(SOURCE, target, CLOCK, synthetic)
            atomic_json(ROOT / f'{name}-a2.json', report)
    atomic_json(ROOT / 'actual-recheck.json', verify(SOURCE, ROOT / 'actual/manifest.json'))
    actual = ManifestSampler(ROOT / 'actual/manifest.json')
    masked = ManifestSampler(ROOT / 'masked/manifest.json')
    # A trial-only revision reuses immutable assets and changes availability.
    # This does not purport to be a correction delivered by the producer.
    body = {key: value for key, value in actual.manifest.items() if key != 'revision'}
    body['fields'] = body['fields'][:12]
    body['trial_scenario'] = 'synthetic partial revision; unchanged real values/assets'
    revised = {**body, 'revision': hashlib.sha256(canonical(body)).hexdigest()}
    atomic_json(ROOT / 'actual/revised.json', revised)
    atomic_json(ROOT / 'index.json', {
        'actual': {'run': actual.manifest['run'], 'revision': actual.revision},
        'masked': {'run': masked.manifest['run'], 'revision': masked.revision},
        'revised': {'run': revised['run'], 'revision': revised['revision']}})
    atomic_json(ROOT / 'catalog.json', ['actual/manifest.json', 'masked/manifest.json'])
    if not (ROOT / 'secrets.json').exists():
        atomic_json(ROOT / 'secrets.json', {name: secrets.token_urlsafe(32)
                                           for name in ['main', 'limited', 'revocable', 'control']})
    tokens = json.loads((ROOT / 'secrets.json').read_text())
    atomic_json(ROOT / 'policy.json', {
        'keys': {hashlib.sha256(tokens[name].encode()).hexdigest():
                 {'organization': name, 'enabled': True, 'limit_per_minute': 1 if name == 'limited' else 100000}
                 for name in ['main', 'limited', 'revocable']}})
    print(json.dumps({'status': 'ready', 'clock': CLOCK, 'source': actual.manifest['source'],
                      'fixtures': json.loads((ROOT / 'index.json').read_text())}))


if __name__ == '__main__':
    main()
