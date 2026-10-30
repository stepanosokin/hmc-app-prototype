"""Normalized discovery; canonical readers still verify their immutable assets."""
import json
from collections import OrderedDict
from threading import Lock

from decoder.sampling import canonical
from publication import revisions
from publication.domain import load_manifest
from publication.native_display import profile

MAX_BYTES=4*1024**2
IDENTITY_KEYS=('model','run','field','level','valid_time','native_grid_sha256','member')
DISCOVERY_KEYS=IDENTITY_KEYS+('units','fixture','native_version','field_profile','field_label','field_short_name',
    'field_level_type','field_surfaces','display_blocks','interval','wind_axis','wind_pair','uv_relative_to_grid','derived')
_legacy_cache: OrderedDict=OrderedDict()
_lock=Lock()


def discovery(batch:dict) -> dict:
    descriptor=batch['source'].get('field_descriptor',{})
    result={**{key:batch['identity'][key] for key in IDENTITY_KEYS},
        'units':descriptor.get('units','K'),'fixture':batch.get('fixture','actual'),
        'native_version':profile(batch['source'].get('source_crs'),batch['source'].get('field_profile'))[2]}
    if descriptor:
        if batch['source'].get('derived'):
            result['derived'] = batch['source']['derived']
        result.update(field_profile=batch['source']['field_profile'],field_label=descriptor['label'],
            field_short_name=descriptor.get('short_name'),field_level_type=descriptor['level_type'],
            display_blocks=descriptor['display_blocks'],interval=descriptor['interval'])
        raw=descriptor.get('raw_identity',{})
        if 'second_surface_hex' in raw:
            def surface(kind:int,scale:int,value:int) -> dict:
                signed_scale=-(scale&127) if scale&128 else scale
                return {'type':kind,'scale_factor':scale,'scaled_value':value,
                    'value':None if scale==255 or value==0xffffffff else value*10.0**(-signed_scale)}
            second=bytes.fromhex(raw['second_surface_hex'])
            if len(second)!=6:raise ValueError('Некорректная вторая поверхность поля')
            result['field_surfaces']=[surface(raw['typeOfFirstFixedSurface'],raw['scaleFactorOfFirstFixedSurface'],raw['scaledValueOfFirstFixedSurface']),
                surface(second[0],second[1],int.from_bytes(second[2:],'big'))]
        for key in ('wind_axis','wind_pair','uv_relative_to_grid'):
            if key in descriptor:result[key]=descriptor[key]
    return result


def legacy_discovery(path:str,checksum:str) -> dict:
    # Old immutable roots have no discovery record. Keep this bounded metadata
    # cache separate from canonical readers; eligibility is checked by the API.
    key=(path,checksum)
    with _lock:
        if key in _legacy_cache:
            _legacy_cache.move_to_end(key)
            return _legacy_cache[key]
    batch=load_manifest(path,checksum)
    result={**discovery(batch),'_revision':batch['identity']['revision']}
    with _lock:
        _legacy_cache[key]=result
        while len(_legacy_cache)>4096:_legacy_cache.popitem(last=False)
    return result


def compact(revision_rows:list[dict],legacy_rows:list[dict],expired:set[str]) -> dict:
    templates:list[dict]=[];batches:list[dict]=[];roots:list[dict]=[]
    template_ids:dict[bytes,int]={};batch_ids:dict[tuple,int]={}
    def add(entry:dict,run:str,selection:str|None=None) -> int:
        reference=(entry['manifest_path'],entry['manifest_sha256'],selection)
        if reference in batch_ids:return batch_ids[reference]
        saved=entry.get('discovery') or legacy_discovery(*reference[:2])
        record={key:saved[key] for key in DISCOVERY_KEYS if key in saved}
        identity={key:record[key] for key in ('field','level','valid_time','native_grid_sha256','member')}
        if record['run']!=run or revisions.batch_key(identity)!=entry['key']:
            raise ValueError('Catalogue batch identity mismatch')
        valid_time=record.pop('valid_time');interval=record.pop('interval',None)
        encoded=canonical(record)
        if encoded not in template_ids:
            template_ids[encoded]=len(templates);templates.append(record)
        index=len(batches)
        batches.append({'template':template_ids[encoded],'key':entry['key'],'valid_time':valid_time,'interval':interval,
            **({'selection':selection} if selection else {})})
        batch_ids[reference]=index
        if len(batches)>8192:raise ValueError('Каталог превышает лимит 8192 исходных полей')
        return index
    for row in legacy_rows:
        if row['selection'] in expired:continue
        record=legacy_discovery(row['manifest_path'],row['manifest_sha256'])
        roots.append({'revision':record['_revision'],'completeness':'unknown',
            'batches':[add({**row,'key':revisions.batch_key(record)},record['run'],row['selection'])]})
    for row in revision_rows:
        if row['revision'] in expired:continue
        root=revisions.load_revision(row['manifest_path'],row['manifest_sha256'])
        roots.append({'revision':root['revision'],'completeness':root['completeness'],
            'batches':[add(entry,root['run']) for entry in root['batches']]})
    result={'version':'compact/1','templates':templates,'batches':batches,'revisions':roots}
    if len(json.dumps(result,ensure_ascii=False,separators=(',',':')).encode())>MAX_BYTES:
        raise ValueError('Каталог превышает лимит 4 МиБ')
    return result
