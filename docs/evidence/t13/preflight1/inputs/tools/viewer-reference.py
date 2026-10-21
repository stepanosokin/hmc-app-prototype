"""T13 raw-GRIB numerical reference; reuse the independent T23 GPU/PROJ check."""
import json
import math
import runpy
import sys
from pathlib import Path

import numpy as np

from decoder.inspect_forecast import SAMPLE_SHA256
from decoder.storage import bounded_frames, decoded_arrays


def main():
    runpy.run_path('/workspace/tools/native-display/native_reference.py', run_name='__main__')
    browser = sys.argv[2] if len(sys.argv) > 2 else 'browser'
    directory = Path('/evidence')
    report = json.loads((directory / browser / 'browser.json').read_bytes())
    source = Path('/input/ICON_EU_T_G_2026101500.grib2')
    values, missing = decoded_arrays(next(bounded_frames(source)), [657, 1377])
    results = []
    for viewport in report['viewports']:
        for pick in viewport['canonical_picks']:
            point, position = pick['point'], pick['position']
            assert point['valid_time'] == '2026-10-15T01:00:00Z'
            native = math.degrees(math.atan2((1-.0066943799901413165)*math.sin(math.radians(position['lat'])),
                                            math.cos(math.radians(position['lat']))))
            column = math.floor((position['lng']+23.53125)*16)
            row = math.floor((native-29.46875)*16)
            assert point['cell']['column'] == column and point['cell']['row'] == row
            assert not missing[row, column]
            assert abs(point['value']-float(values[row, column])) <= .0001
            assert point['source']['sha256'] == SAMPLE_SHA256
            results.append({'viewport': [viewport['width'], viewport['height']], 'mode': pick['mode'],
                            'row': row, 'column': column, 'value_K': point['value']})
    result = {'status': 'passed', 'source_sha256': SAMPLE_SHA256, 'canonical_picks': results,
              'qgis_scope': 'Same actual T_G source and nearest-native-cell baseline as immutable T12 QGIS evidence; no new QGIS CRS claim',
              'encoding_scope': 'Native f32 source values; separate accepted T23a encode/halo evidence retained',
              'finite_source_cells': int(np.count_nonzero(~missing))}
    (directory / (browser+'-canonical.json')).write_text(json.dumps(result, indent=2))
    print(json.dumps({'status': 'passed', 'canonical_picks': len(results)}))


if __name__ == '__main__':
    main()
