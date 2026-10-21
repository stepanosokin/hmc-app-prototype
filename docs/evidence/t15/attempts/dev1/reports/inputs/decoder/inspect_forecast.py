"""Operator entry point for the supplied forecast (issue #13)."""

import argparse
import hashlib
import json
import importlib.metadata
import platform
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import eccodes as ec
import eccodeslib
import numpy as np

SAMPLE_SHA256 = 'dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a'


class ValidationError(Exception):
    """Input cannot satisfy the supplied-sample compatibility gate."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def frames(data: bytes) -> list[bytes]:
    """Check every envelope before any values can escape the command."""
    result = []
    offset = 0
    while offset < len(data):
        require(len(data) - offset >= 16, f'truncated GRIB header at byte {offset}')
        require(data[offset:offset + 4] == b'GRIB', f'not GRIB at byte {offset}')
        require(data[offset + 7] == 2, f'unsupported GRIB edition at byte {offset}')
        length = int.from_bytes(data[offset + 8:offset + 16], 'big')
        require(length >= 20, f'invalid GRIB message length at byte {offset}')
        require(offset + length <= len(data), f'truncated GRIB message at byte {offset}: expected {length} bytes')
        frame = data[offset:offset + length]
        require(frame[-4:] == b'7777', f'missing GRIB end marker at byte {offset}')
        result.append(frame)
        offset += length
    require(bool(result), 'empty input: no GRIB messages')
    return result


def uint(section: bytes, start: int, end: int) -> int:
    return int.from_bytes(section[start:end], 'big')


def signed_angle(section: bytes, start: int) -> float:
    # GRIB uses sign-magnitude, not two's complement. Grid angles use microdegrees.
    encoded = uint(section, start, start + 4)
    return (-1 if encoded & 0x80000000 else 1) * (encoded & 0x7fffffff) / 1_000_000


def sections(frame: bytes) -> dict[int, bytes]:
    result = {}
    offset = 16
    order = []
    while offset < len(frame) - 4:
        require(offset + 5 <= len(frame) - 4, 'truncated section header')
        length = uint(frame, offset, offset + 4)
        require(length >= 5 and offset + length <= len(frame) - 4, 'invalid or truncated section')
        number = frame[offset + 4]
        require(number not in result, f'unsupported repeated section {number}')
        result[number] = frame[offset:offset + length]
        order.append(number)
        offset += length
    require(order in ([1, 2, 3, 4, 5, 6, 7], [1, 3, 4, 5, 6, 7]), f'unsupported section sequence {order}')
    require(offset == len(frame) - 4, 'section framing mismatch')
    for number, minimum in {1: 21, 3: 72, 4: 34, 5: 25, 6: 6}.items():
        require(len(result[number]) >= minimum, f'truncated section {number}')
    return result


def tool_versions() -> dict[str, Any]:
    library = Path(eccodeslib.__file__).parent / 'lib64'
    binaries = {
        name: hashlib.sha256((library / name).read_bytes()).hexdigest()
        for name in ['libeccodes.so', 'libeccodes_memfs.so', 'libaec.so']
    }
    definition_path = ec.codes_definition_path()
    require(definition_path == '/MEMFS/definitions', 'unsupported external ecCodes definitions; use the pinned embedded definitions')
    return {
        'python': platform.python_version(), 'platform': platform.platform(),
        'packages': {name: importlib.metadata.version(name) for name in ['eccodes', 'eccodeslib', 'eckitlib', 'fckitlib', 'numpy']},
        'eccodes_api': ec.codes_get_api_version(), 'features': ec.codes_get_features().split(),
        'definitions': {'path': definition_path, 'release': ec.codes_get_api_version(), 'sha256_binary': binaries['libeccodes_memfs.so']},
        'binary_sha256': binaries,
    }


def decode_message(frame: bytes, hour: int) -> dict[str, Any]:
    raw = sections(frame)
    identification, grid, product, packing = raw[1], raw[3], raw[4], raw[5]
    require(uint(packing, 9, 11) == 42, 'unsupported packing template: expected CCSDS 5.42')
    require(uint(grid, 12, 14) == 0, 'unsupported grid template: expected 3.0')
    require(uint(product, 7, 9) == 0, 'unsupported product template: expected 4.0')
    raw_identity = {
        'discipline': frame[6], 'centre': uint(identification, 5, 7),
        'subCentre': uint(identification, 7, 9), 'tablesVersion': identification[9],
        'localTablesVersion': identification[10], 'parameterCategory': product[9],
        'parameterNumber': product[10], 'typeOfFirstFixedSurface': product[22],
        'scaleFactorOfFirstFixedSurface': product[23], 'scaledValueOfFirstFixedSurface': uint(product, 24, 28),
    }
    require(raw_identity == {
        'discipline': 0, 'centre': 78, 'subCentre': 255, 'tablesVersion': 19,
        'localTablesVersion': 1, 'parameterCategory': 0, 'parameterNumber': 0,
        'typeOfFirstFixedSurface': 1, 'scaleFactorOfFirstFixedSurface': 0,
        'scaledValueOfFirstFixedSurface': 0,
    }, f'parameter/table/surface identity differs from sample: {raw_identity}')
    reference = datetime(uint(identification, 12, 14), identification[14], identification[15],
                         identification[16], identification[17], identification[18], tzinfo=timezone.utc)
    require(reference == datetime(2026, 10, 15, tzinfo=timezone.utc), 'reference time differs from inventory')
    require(product[17] == 0 and uint(product, 18, 22) == hour * 60, f'expected hourly lead +{hour}, encoded in minutes')
    valid = reference + timedelta(hours=hour)
    ni, nj = uint(grid, 30, 34), uint(grid, 34, 38)
    lat0, lon0 = signed_angle(grid, 46), signed_angle(grid, 50)
    lat1, lon1 = signed_angle(grid, 55), signed_angle(grid, 59)
    dx, dy = uint(grid, 63, 67) / 1e6, uint(grid, 67, 71) / 1e6
    require((ni, nj, uint(grid, 6, 10)) == (1377, 657, 904689), 'grid shape differs from inventory')
    require(uint(grid, 38, 42) == 0 and uint(grid, 42, 46) == 0xffffffff, 'unsupported angular units')
    require((lat0, lon0, lat1, lon1, dx, dy, grid[71]) == (29.5, 336.5, 70.5, 62.5, 0.0625, 0.0625, 64), 'grid extent/spacing/scanning differs from inventory')
    require(raw[6][5] in (0, 255), 'unsupported bitmap reuse')
    handle = ec.codes_new_from_message(frame)
    try:
        for key, expected in raw_identity.items():
            require(ec.codes_get_long(handle, key) == expected, f'decoder/raw header mismatch: {key}')
        identity = {key: ec.codes_get(handle, key) for key in ['paramId', 'shortName', 'name', 'units', 'typeOfLevel', 'level', 'packingType', 'gridType']}
        require((identity['shortName'], identity['paramId'], identity['units'], identity['typeOfLevel'], identity['level']) == ('T_G', 500010, 'K', 'surface', 0), f'decoder did not establish surface-temperature identity: {identity}')
        require(identity['packingType'] == 'grid_ccsds' and identity['gridType'] == 'regular_ll', 'decoder packing/grid mismatch')
        for key, expected in {'Ni': ni, 'Nj': nj, 'scanningMode': 64, 'dataDate': 20261015, 'dataTime': 0, 'validityDate': int(valid.strftime('%Y%m%d')), 'validityTime': int(valid.strftime('%H%M')), 'startStep': hour, 'endStep': hour, 'stepUnits': 1}.items():
            require(ec.codes_get_long(handle, key) == expected, f'decoder/header mismatch: {key}')
        values = ec.codes_get_values(handle)
        count = ni * nj
        require(len(values) == count, 'decoded value count differs from grid')
        bitmap_present = ec.codes_get_long(handle, 'bitmapPresent')
        require(bitmap_present == int(raw[6][5] == 0), 'decoder/raw bitmap mismatch')
        mask = ec.codes_get_array(handle, 'bitmap') == 0 if bitmap_present else np.zeros(count, dtype=bool)
        missing = int(np.count_nonzero(mask))
        require(ec.codes_get_long(handle, 'numberOfMissing') == missing, 'decoder missing count differs from bitmap')
        finite = values[~mask]
        require(finite.size > 0 and bool(np.all(np.isfinite(finite))), 'non-finite or absent unmasked values')
        latitudes = ec.codes_get_array(handle, 'latitudes')
        longitudes = (ec.codes_get_array(handle, 'longitudes') + 180) % 360 - 180
        # Independently derive every centre from raw template 3.0. i varies fastest,
        # j increases northward (scanning mode 64). No reshape/reorder is applied.
        indices = np.arange(count)
        expected_lat = lat0 + (indices // ni) * dy
        expected_lon = (lon0 + (indices % ni) * dx + 180) % 360 - 180
        require(bool(np.allclose(latitudes, expected_lat, rtol=0, atol=1e-9)), 'latitude cell placement mismatch')
        require(bool(np.allclose(longitudes, expected_lon, rtol=0, atol=1e-9)), 'longitude cell placement mismatch')
        positions = [0, ni - 1, ni, (nj // 2) * ni + ni // 2, count - ni, count - 1]
        centres = [{'index': index, 'row': index // ni, 'column': index % ni,
                    'lon': float(longitudes[index]), 'lat': float(latitudes[index]),
                    'value': None if mask[index] else float(values[index])} for index in positions]
        return {
            'message': hour, 'identity': identity, 'raw_identity': raw_identity,
            'reference_time': reference.isoformat().replace('+00:00', 'Z'),
            'lead_hours': hour, 'raw_lead': {'unit_code': product[17], 'value': uint(product, 18, 22)},
            'valid_time': valid.isoformat().replace('+00:00', 'Z'),
            'grid': {'shape_yx': [nj, ni], 'template': 0, 'earth_shape_code': grid[14],
                     'scanning_mode': 64, 'i_scans_negatively': False, 'j_scans_positively': True,
                     'j_points_consecutive': False, 'alternative_row_scanning': False,
                     'longitude_normalization': '[-180, 180)', 'raw_first_lon': lon0,
                     'spacing_degrees_xy': [dx, dy], 'coordinate_check': 'all centres against raw section 3',
                     'cell_centres': centres, 'outer_cell_edges_wsen': [-23.53125, 29.46875, 62.53125, 70.53125]},
            'values': {'count': count, 'finite_count': int(finite.size), 'missing_count': missing,
                       'bitmap_present': bool(bitmap_present), 'min': float(finite.min()), 'max': float(finite.max()),
                       'decoded_float64_le_sha256': hashlib.sha256(np.asarray(values, dtype='<f8').tobytes()).hexdigest(),
                       'missing_mask_uint8_sha256': hashlib.sha256(mask.astype('uint8').tobytes()).hexdigest()},
        }
    finally:
        ec.codes_release(handle)


def validate(data: bytes) -> list[dict[str, Any]]:
    messages = frames(data)
    require(len(messages) == 24, f'expected 24 messages, received {len(messages)}')
    result = [decode_message(frame, hour) for hour, frame in enumerate(messages, 1)]
    require(hashlib.sha256(data).hexdigest() == SAMPLE_SHA256, 'checksum differs from supplied sample; this command validates only the T1 inventory')
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--clock', required=True, help='Explicit report timestamp, ISO 8601 UTC; no retention is applied')
    parser.add_argument('--report', type=Path, help='Atomically replace this JSON report; default is stdout')
    args = parser.parse_args()
    report: dict[str, Any] = {
        'schema_version': 1, 'pipeline_version': 't1.1', 'gate': 'A1',
        'status': 'failed', 'clock': args.clock, 'messages': [],
        'input': {'name': args.input.name},
    }
    try:
        report['tools'] = tool_versions()
        require('AEC' in report['tools']['features'], 'unsupported decoder: AEC is required for CCSDS 5.42')
        require(args.clock.endswith('Z'), 'clock must be explicit UTC ending in Z')
        datetime.fromisoformat(args.clock.replace('Z', '+00:00'))
        data = args.input.read_bytes()
        report['input'].update(size_bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        report['messages'] = validate(data)
        report['status'] = 'passed'
    except Exception as error:
        report['messages'] = []
        report['error'] = {'type': type(error).__name__, 'message': str(error)}
        report['decision'] = 'Block A1; retain source and diagnostics. If decoder compatibility failed, reopen storage decision #3 before proceeding.'
    payload = json.dumps(report, indent=2, allow_nan=False) + '\n'
    if args.report:
        temporary = args.report.with_suffix(args.report.suffix + '.tmp')
        temporary.write_text(payload, encoding='utf-8')
        temporary.replace(args.report)
    else:
        sys.stdout.write(payload)
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
