"""Quantity-specific value validity; source values remain unchanged."""
import hashlib

import numpy as np

VERSION = 'field-validity/3'
# Explicit GRIB2 absolute-temperature quantities. Never infer from K alone:
# temperature anomalies/deviations also use K and may legitimately be zero.
# GRIB2 table 4.2-0-0 (NCEP/WMO); difference/depression/anomaly are excluded.
ABSOLUTE_TEMPERATURES = {0, 1, 2, 3, 4, 5, 6, 12, 13, 15, 17, 18, 21, 27, 32}


def rejection_rule(metadata: dict) -> str | None:
    raw, identity = metadata['raw_identity'], metadata['identity']
    quantity = (raw['discipline'], raw['parameterCategory'], raw['parameterNumber'])
    units, surface, level = identity['units'], identity['typeOfLevel'], identity['level']
    ordinary_statistic = not metadata.get('interval') or metadata['interval']['statistical_process'] in (0, 2, 3)
    if (units == 'K' and ordinary_statistic
            and ((quantity[:2] == (0, 0) and quantity[2] in ABSOLUTE_TEMPERATURES)
                 or quantity in ((2, 0, 2), (2, 3, 18)))):
        return 'absolute-temperature-positive-kelvin'
    if quantity == (0, 3, 0) and units == 'Pa' and surface == 'surface':
        return 'surface-pressure-nonzero'
    if quantity == (0, 3, 1) and units == 'Pa' and surface == 'meanSea':
        return 'mean-sea-pressure-nonzero'
    if quantity == (0, 1, 1) and units == '%':
        return 'relative-humidity-nonzero'
    if (quantity == (0, 1, 0) and units == 'kg kg**-1'
            and (surface == 'surface' or (surface == 'heightAboveGround' and level == 2))):
        return 'specific-humidity-surface-or-2m-nonzero'
    if quantity == (0, 2, 22) and units == 'm s**-1':
        return 'wind-gust-nonzero'
    if quantity == (0, 19, 0) and units == 'm':
        return 'visibility-nonzero'
    return None


def validity(values: np.ndarray, source_missing: np.ndarray, metadata: dict) -> tuple[np.ndarray, dict]:
    source_missing = np.asarray(source_missing, dtype=bool)
    rule = rejection_rule(metadata)
    rejected = (~source_missing & ((values <= 0) if rule == 'absolute-temperature-positive-kelvin'
                                 else (values == 0))) if rule else np.zeros(values.shape, dtype=bool)
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
    return reason, {'version': VERSION, 'rule': rule,
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
