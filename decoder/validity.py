"""Quantity-specific value validity; source values remain unchanged."""
import hashlib

import numpy as np

VERSION = 'field-validity/2'
# Explicit GRIB2 absolute-temperature quantities. Never infer from K alone:
# temperature anomalies/deviations also use K and may legitimately be zero.
# GRIB2 table 4.2-0-0 (NCEP/WMO); difference/depression/anomaly are excluded.
ABSOLUTE_TEMPERATURES = {0, 1, 2, 3, 4, 5, 6, 12, 13, 15, 17, 18, 21, 27, 32}


def validity(values: np.ndarray, source_missing: np.ndarray, metadata: dict) -> tuple[np.ndarray, dict]:
    source_missing = np.asarray(source_missing, dtype=bool)
    raw, identity = metadata['raw_identity'], metadata['identity']
    absolute = (((raw['discipline'] == 0 and raw['parameterCategory'] == 0
                  and raw['parameterNumber'] in ABSOLUTE_TEMPERATURES)
                 or (raw['discipline'], raw['parameterCategory'], raw['parameterNumber']) == (2, 0, 2))
                and identity['units'] == 'K'
                and (not metadata.get('interval') or metadata['interval']['statistical_process'] in (0, 2, 3)))
    rejected = (~source_missing & (values <= 0)) if absolute else np.zeros(values.shape, dtype=bool)
    reason = np.where(source_missing, 1, np.where(rejected, 2, 0)).astype('uint8')
    missing = reason != 0
    valid = values[~missing]
    if not np.all(np.isfinite(valid)):
        raise ValueError('Недопустимые нечисловые значения вне маски NoData')
    statistics = {'count': int(values.size), 'finite_count': int(valid.size),
                  'missing_count': int(missing.sum()), 'source_missing_count': int(source_missing.sum()),
                  'rejected_count': int(rejected.sum()),
                  'min': float(valid.min()) if valid.size else None,
                  'max': float(valid.max()) if valid.size else None,
                  'decoded_float64_le_sha256': hashlib.sha256(np.asarray(values, dtype='<f8').tobytes()).hexdigest(),
                  'missing_mask_uint8_sha256': hashlib.sha256(missing.astype('uint8').tobytes()).hexdigest()}
    return reason, {'version': VERSION, 'rule': 'absolute-temperature-positive-kelvin' if absolute else None,
                    'statistics': statistics}


def refresh(metadata: dict, values: np.ndarray, source_missing: np.ndarray) -> np.ndarray:
    """Recompute one authoritative mask/statistics after decoding or migration."""
    reason, report = validity(values, source_missing, metadata)
    metadata['values'] = {**metadata.get('values', {}), **report.pop('statistics')}
    metadata['value_validity'] = report
    from decoder.portrayal import describe
    metadata['portrayal'] = describe(metadata, values, reason != 0)
    for cell in metadata['grid']['cell_centres']:
        row, col = cell['row'], cell['column']
        cell['value'] = None if reason[row, col] else float(values[row, col])
    return reason
