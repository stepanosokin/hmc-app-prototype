"""Independent raw GRIB nearest-native-cell comparison for all 24 point-series times."""
import hashlib
import json
import math
import sys
from pathlib import Path

from decoder.inspect_forecast import SAMPLE_SHA256
from decoder.storage import bounded_frames, decoded_arrays


def main():
    directory = Path('/evidence')
    browser = sys.argv[1]
    reports = json.loads((directory / browser / 'browser.json').read_bytes())['point_series']
    source = Path('/input/ICON_EU_T_G_2026101500.grib2')
    assert hashlib.sha256(source.read_bytes()).hexdigest() == SAMPLE_SHA256
    maximum, count = 0.0, 0
    for index, frame in enumerate(bounded_frames(source)):
        values, missing = decoded_arrays(frame, [657, 1377])
        for report in reports:
            point = report['position']
            native = math.degrees(math.atan2((1-.0066943799901413165)*math.sin(math.radians(point['lat'])), math.cos(math.radians(point['lat']))))
            column, row = math.floor((point['lng']+23.53125)*16), math.floor((native-29.46875)*16)
            entry = report['entries'][index]
            actual, selection = entry['result'], entry['selection']
            assert actual['cell']['column'] == column and actual['cell']['row'] == row
            assert actual['selection'] == selection['selection']
            assert actual['valid_time'] == selection['valid_time']
            assert actual['revision'] == selection['revision']
            assert actual['source']['sha256'] == SAMPLE_SHA256
            assert not missing[row, column]
            maximum = max(maximum, abs(actual['value']-float(values[row, column])))
            count += 1
        if index == 23:
            break
    assert count == 24*len(reports) and maximum <= .0001
    result = {'status':'passed','source_sha256':SAMPLE_SHA256,'comparisons':count,'max_abs_error_K':maximum,'point_tolerance_K':.0001}
    (directory / (browser+'-series-comparison.json')).write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
