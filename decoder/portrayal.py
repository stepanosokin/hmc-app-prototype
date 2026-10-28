"""Colour eligibility is independent of numerical validity and statistics."""
import numpy as np


def zero_transparent(metadata: dict) -> bool:
    identity, raw = metadata['identity'], metadata['raw_identity']
    short = identity.get('shortName')
    # Preserve the temperature group and ordinary wind, including raw identities
    # whose ecCodes short names vary with centre/level.
    temperature = short in {'T_G', 't', '2t', 'min_2t', 'max_2t', 'sot', '2d'}
    wind = ((raw['discipline'], raw['parameterCategory']) == (0, 2)
            and raw['parameterNumber'] in (0, 1, 2, 3))
    return not temperature and not wind


def describe(metadata: dict, values: np.ndarray, missing: np.ndarray) -> dict:
    transparent = zero_transparent(metadata)
    visible = values[~missing & ((values != 0) if transparent else True)]
    return {'version': 'field-portrayal/2', 'zero_transparent': transparent,
            'visible_count': int(visible.size),
            'display_range': [float(visible.min()), float(visible.max())] if visible.size else None}


def policy(metadata: dict) -> dict:
    """Legacy immutable publications keep their original portrayal until rebuilt."""
    return metadata.get('portrayal', {
        'zero_transparent': metadata.get('value_validity', {}).get('rule') != 'absolute-temperature-positive-kelvin',
        'visible_count': metadata['values']['finite_count'],
        'display_range': [metadata['values']['min'], metadata['values']['max']]
                         if metadata['values']['finite_count'] else None})
