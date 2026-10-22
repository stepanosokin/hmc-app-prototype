"""Validate an explicitly agreed measurement envelope; never manufacture agreement."""

import argparse
import json
import math
from datetime import datetime
from pathlib import Path


def agreement(path: Path) -> dict:
    record = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(record, dict) or record.get('status') != 'agreed':
        raise ValueError('explicit agreed status required; pending proposals cannot authorize measurements')
    for key in ('host', 'approved_by', 'approved_at', 'approval_reference'):
        if not isinstance(record.get(key), str) or not record[key].strip():
            raise ValueError(f'agreement requires {key}')
    if not record['approved_at'].endswith('Z'):
        raise ValueError('approved_at requires an explicit UTC timestamp ending in Z')
    datetime.fromisoformat(record['approved_at'].replace('Z', '+00:00'))
    for key in ('cpus', 'memory_mib', 'point_p95_ms', 'point_p99_ms',
                'metadata_p95_ms', 'metadata_p99_ms', 'min_success_rps'):
        value = record.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ValueError(f'agreement requires positive finite {key}')
    rate = record.get('max_error_rate')
    if isinstance(rate, bool) or not isinstance(rate, (int, float)) or not math.isfinite(rate) or not 0 <= rate <= 1:
        raise ValueError('agreement requires max_error_rate between 0 and 1')
    for operation in ('point', 'metadata'):
        if record[f'{operation}_p95_ms'] > record[f'{operation}_p99_ms']:
            raise ValueError(f'{operation} p95 cannot exceed p99')
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('agreement', type=Path)
    args = parser.parse_args()
    try:
        record = agreement(args.agreement)
        print(json.dumps({'status': 'ready-for-correctness-gates', 'agreement': record,
                          'selection': None, 'note': 'Agreement is necessary, not proof of correctness or performance.'}))
        return 0
    except (OSError, ValueError, TypeError) as error:
        print(json.dumps({'status': 'blocked', 'selection': None, 'reason': str(error)}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
