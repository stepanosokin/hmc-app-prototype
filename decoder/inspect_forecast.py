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

if not __package__:  # retained direct-file operator CLI
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

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
    for number, minimum in {1: 21, 3: 14, 4: 34, 5: 11, 6: 6}.items():
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


def decode_message(frame: bytes, hour: int, crs_config: dict | None = None,
                   sample_inventory: bool = True, all_fields: bool = False) -> dict[str, Any]:
    raw = sections(frame)
    identification, grid, product, packing = raw[1], raw[3], raw[4], raw[5]
    if sample_inventory:
        require(uint(packing, 9, 11) == 42, 'unsupported packing template: expected CCSDS 5.42')
        require(len(packing) >= 25, 'truncated section 5')
    from decoder.grib_crs import resolve
    geometry = resolve(grid, crs_config)
    product_template = uint(product, 7, 9)
    require(product_template in (0, 8) if all_fields else product_template == 0,
            'unsupported product template: expected 4.0 or explicit field-profile 4.8')
    raw_identity = {
        'discipline': frame[6], 'centre': uint(identification, 5, 7),
        'subCentre': uint(identification, 7, 9), 'tablesVersion': identification[9],
        'localTablesVersion': identification[10], 'parameterCategory': product[9],
        'parameterNumber': product[10], 'typeOfFirstFixedSurface': product[22],
        'scaleFactorOfFirstFixedSurface': product[23], 'scaledValueOfFirstFixedSurface': uint(product, 24, 28),
    }
    expected_identity = {
        'discipline': 0, 'centre': 78, 'subCentre': 255, 'tablesVersion': 19,
        'localTablesVersion': 1, 'parameterCategory': 0, 'parameterNumber': 0,
        'typeOfFirstFixedSurface': 1, 'scaleFactorOfFirstFixedSurface': 0,
        'scaledValueOfFirstFixedSurface': 0,
    }
    if sample_inventory:
        require(raw_identity == expected_identity, f'parameter/table/surface identity differs from sample: {raw_identity}')
    elif not all_fields:
        require(all(raw_identity[key] == expected_identity[key] for key in
            ('discipline','parameterCategory','parameterNumber','typeOfFirstFixedSurface')),
            'Поддерживается только мгновенная температура поверхности GRIB2')
    reference = datetime(uint(identification, 12, 14), identification[14], identification[15],
                         identification[16], identification[17], identification[18], tzinfo=timezone.utc)
    if sample_inventory:
        require(reference == datetime(2026, 10, 15, tzinfo=timezone.utc), 'reference time differs from inventory')
        require(product[17] == 0 and uint(product, 18, 22) == hour * 60, f'expected hourly lead +{hour}, encoded in minutes')
    unit_seconds = {0:60,1:3600,2:86400,10:10800,11:21600,12:43200,13:1}
    require(product[17] in unit_seconds,'Не поддерживается единица прогнозного срока GRIB2')
    lead_seconds = unit_seconds[product[17]]*uint(product,18,22)
    valid = reference + timedelta(seconds=lead_seconds)
    interval = None
    if product_template == 8:
        require(len(product) >= 58 and product[41] == 1, 'Поддерживается один статистический интервал GRIB2 4.8')
        require(product[46] in (0, 1, 2, 3) and product[48] in unit_seconds,
                'Не поддерживается статистическая операция или единица интервала')
        end = datetime(uint(product,34,36),product[36],product[37],product[38],product[39],product[40],tzinfo=timezone.utc)
        duration = uint(product,49,53)*unit_seconds[product[48]]
        require(end >= valid and (end-valid).total_seconds() == duration,
                'Границы и длительность статистического интервала не согласованы')
        interval = {'start':valid.isoformat().replace('+00:00','Z'),
                    'end':end.isoformat().replace('+00:00','Z'), 'statistical_process':product[46],
                    'duration_seconds':duration, 'time_increment_type':product[47],
                    'time_increment_unit':product[53], 'time_increment':uint(product,54,58)}
        valid = end
    nj, ni = geometry['grid']['shape_yx']
    dx, dy = geometry['grid']['spacing_xy']
    west, south, east, north = geometry['grid']['outer_edges_wsen']
    lat0, lon0 = south+dy/2, west+dx/2
    require(raw[6][5] in (0, 255), 'unsupported bitmap reuse')
    handle = ec.codes_new_from_message(frame)
    try:
        for key, expected in raw_identity.items():
            raw_missing = (key == 'scaleFactorOfFirstFixedSurface' and expected == 255
                       or key == 'scaledValueOfFirstFixedSurface' and expected == 0xffffffff)
            require(bool(ec.codes_is_missing(handle, key)) if all_fields and raw_missing
                    else ec.codes_get_long(handle, key) == expected, f'decoder/raw header mismatch: {key}')
        identity = {key: ec.codes_get(handle, key) for key in ['paramId', 'shortName', 'name', 'units', 'typeOfLevel', 'level', 'packingType', 'gridType']}
        if all_fields and raw_identity['discipline']==0 and raw_identity['parameterCategory']==2 and raw_identity['parameterNumber'] in (2,3):
            require(ec.codes_is_defined(handle,'uvRelativeToGrid') and not ec.codes_is_missing(handle,'uvRelativeToGrid'),
                    'Не задана ориентация компонент ветра')
            identity['uv_relative_to_grid']=bool(ec.codes_get_long(handle,'uvRelativeToGrid'))
        if sample_inventory:
            require((identity['shortName'], identity['paramId'], identity['units'], identity['typeOfLevel'], identity['level']) == ('T_G', 500010, 'K', 'surface', 0), f'decoder did not establish surface-temperature identity: {identity}')
            require(identity['packingType'] == 'grid_ccsds', 'decoder packing mismatch')
        if not all_fields:
            require((identity['units'],identity['typeOfLevel'],identity['level'])==('K','surface',0),
                    'Декодер не подтвердил температуру поверхности в K')
        checks = {'Ni': ni, 'Nj': nj, 'scanningMode': geometry['grid']['scanning_mode'],
                  'dataDate':int(reference.strftime('%Y%m%d')),'dataTime':int(reference.strftime('%H%M')),
                  'validityDate':int(valid.strftime('%Y%m%d')),'validityTime':int(valid.strftime('%H%M'))}
        if sample_inventory:
            checks.update(startStep=hour,endStep=hour,stepUnits=1)
        for key, expected in checks.items():
            require(ec.codes_get_long(handle, key) == expected, f'decoder/header mismatch: {key}')
        values = ec.codes_get_values(handle)
        count = ni * nj
        require(len(values) == count, 'decoded value count differs from grid')
        bitmap_present = ec.codes_get_long(handle, 'bitmapPresent')
        require(bitmap_present == int(raw[6][5] == 0), 'decoder/raw bitmap mismatch')
        mask = ec.codes_get_array(handle, 'bitmap') == 0 if bitmap_present else np.zeros(count, dtype=bool)
        values = values.reshape(nj, ni)
        mask = mask.reshape(nj, ni)
        if not geometry['grid']['scanning_mode'] & 64:
            values, mask = values[::-1], mask[::-1]
        if geometry['grid']['scanning_mode'] & 128:
            values, mask = values[:, ::-1], mask[:, ::-1]
        values, mask = values.ravel(), mask.ravel()
        missing = int(np.count_nonzero(mask))
        require(ec.codes_get_long(handle, 'numberOfMissing') == missing, 'decoder missing count differs from bitmap')
        finite = values[~mask]
        require(finite.size > 0 and bool(np.all(np.isfinite(finite))), 'non-finite or absent unmasked values')
        # Independently derive every centre from raw template 3.0. i varies fastest,
        # j increases northward (scanning mode 64). No reshape/reorder is applied.
        indices = np.arange(count)
        expected_lat = lat0 + (indices // ni) * dy
        expected_lon = lon0 + (indices % ni) * dx
        latitudes, longitudes = expected_lat, expected_lon
        if geometry['template'] == 0:
            decoded_lat = ec.codes_get_array(handle, 'latitudes').reshape(nj, ni)
            decoded_lon = ((ec.codes_get_array(handle, 'longitudes')+180)%360-180).reshape(nj, ni)
            if not geometry['grid']['scanning_mode'] & 64:
                decoded_lat, decoded_lon = decoded_lat[::-1], decoded_lon[::-1]
            if geometry['grid']['scanning_mode'] & 128:
                decoded_lat, decoded_lon = decoded_lat[:, ::-1], decoded_lon[:, ::-1]
            require(bool(np.allclose(decoded_lat.ravel(), expected_lat, rtol=0, atol=1e-9)), 'latitude cell placement mismatch')
            require(bool(np.allclose(decoded_lon.ravel(), expected_lon, rtol=0, atol=1e-9)), 'longitude cell placement mismatch')
        positions = [0, ni - 1, ni, (nj // 2) * ni + ni // 2, count - ni, count - 1]
        centres = [{'index': index, 'row': index // ni, 'column': index % ni,
                    'lon': float(longitudes[index]), 'lat': float(latitudes[index]),
                    'value': None if mask[index] else float(values[index])} for index in positions]
        return {
            'message': hour, 'identity': identity, 'raw_identity': raw_identity, 'source_crs': geometry,
            **({'product_template':product_template,'interval':interval} if all_fields else {}),
            'reference_time': reference.isoformat().replace('+00:00', 'Z'),
            'lead_hours': lead_seconds/3600, 'raw_lead': {'unit_code': product[17], 'value': uint(product, 18, 22)},
            'model': 'ICON-EU' if sample_inventory else f'GRIB-{raw_identity["centre"]}-{product[13]}',
            'valid_time': valid.isoformat().replace('+00:00', 'Z'),
            'grid': {'shape_yx': [nj, ni], 'template': geometry['template'], 'earth_shape_code': grid[14],
                     'scanning_mode': geometry['grid']['scanning_mode'], 'i_scans_negatively': bool(geometry['grid']['scanning_mode'] & 128), 'j_scans_positively': bool(geometry['grid']['scanning_mode'] & 64),
                     'j_points_consecutive': False, 'alternative_row_scanning': False,
                     'longitude_normalization': '[-180, 180)' if geometry['template'] in (0, 1) else 'projected metres', 'raw_first_lon': lon0,
                     'spacing_degrees_xy': [dx, dy], 'coordinate_check': 'all centres against raw section 3',
                     'spacing_xy': [dx, dy], 'coordinate_units': geometry['grid']['units'],
                     'axis_names': ['grid_longitude', 'grid_latitude'] if geometry['template'] in (0, 1) else ['x', 'y'],
                     'cell_centres': centres, 'outer_cell_edges_wsen': [west, south, east, north]},
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
