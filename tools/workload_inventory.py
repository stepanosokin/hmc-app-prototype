"""Read-only GRIB workload inventory; metadata is not correctness or sizing evidence."""

import argparse
import hashlib
import importlib.metadata
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import eccodes as ec

from decoder.storage import bounded_frames, field_metadata
from decoder.inspect_forecast import ValidationError


def main() -> None:
    parser = argparse.ArgumentParser(description='Инвентаризация GRIB без публикации и изменения источников')
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--file', action='append', help='Имя выбранного файла непосредственно в input; по умолчанию все')
    parser.add_argument('--validate-fields', action='store_true', help='Проверить декодирование каждого сообщения новым профилем полей')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Используйте новый путь отчёта')
    started = time.monotonic()
    report: dict = {
        'scope': 'Декодирование полей; не измерение ingestion' if args.validate_fields else 'Инвентаризация метаданных; не проверка числовой корректности и не измерение ingestion',
        'observed_at': datetime.now(timezone.utc).isoformat(),
        'eccodes': importlib.metadata.version('eccodes'), 'files': [],
        'runner_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'state': 'running',
    }
    keys = ('edition', 'centre', 'subCentre', 'generatingProcessIdentifier',
            'dataDate', 'dataTime', 'validityDate', 'validityTime', 'stepRange',
            'discipline', 'parameterCategory', 'parameterNumber', 'shortName',
            'name', 'units', 'typeOfLevel', 'level', 'stepType', 'gridType',
            'gridDefinitionTemplateNumber', 'Ni', 'Nj', 'numberOfDataPoints', 'packingType')
    for path in sorted(args.input.iterdir()):
        if not path.is_file() or path.is_symlink():
            continue
        if args.file and path.name not in args.file:
            continue
        with path.open('rb') as stream:
            if stream.read(4) != b'GRIB':
                continue
        entry: dict = {'name': path.name, 'bytes': path.stat().st_size, 'messages': []}
        report['files'].append(entry)
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
        entry['sha256'] = digest.hexdigest()
        try:
            for index, frame in enumerate(bounded_frames(path), 1):
                handle = ec.codes_new_from_message(frame)
                try:
                    metadata = {}
                    for key in keys:
                        metadata[key] = ec.codes_get(handle, key) if ec.codes_is_defined(handle, key) else None
                    metadata.update(message=index, bytes=len(frame), sha256=hashlib.sha256(frame).hexdigest())
                    entry['messages'].append(metadata)
                finally:
                    ec.codes_release(handle)
                if args.validate_fields:
                    parsed = field_metadata(frame, index, sample_inventory=False, all_fields=True)
                    metadata.update(field=parsed['field'], units=parsed['identity']['units'],
                                    interval=parsed['interval'], decoded=parsed['values'])
                # Exercise the existing public field contract once per source.
                # Later messages remain metadata-only, never implicitly accepted.
                if index == 1:
                    try:
                        field_metadata(frame, index, sample_inventory=False)
                        entry['first_message_profile'] = 'accepted'
                    except ValidationError as error:
                        entry['first_message_profile'] = 'rejected'
                        entry['first_message_error'] = str(error)
        except Exception as error:
            entry['inventory_error'] = str(error)
        report['elapsed_seconds'] = time.monotonic() - started
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
        print(json.dumps({'file': path.name, 'messages': len(entry['messages']),
                          'first_message_profile': entry.get('first_message_profile'),
                          'inventory_error': entry.get('inventory_error')}, ensure_ascii=False), flush=True)
    if not report['files']:
        parser.error('В папке нет исходных GRIB')
    report['state'] = 'failed' if any('inventory_error' in entry for entry in report['files']) else 'completed'
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    if report['state'] == 'failed':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
