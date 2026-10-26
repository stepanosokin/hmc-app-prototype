"""T19 local Compose workloads; measurements never imply a production SLA."""
import argparse
import concurrent.futures
import hashlib
import json
import math
import os
import stat
import time
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path
from itertools import zip_longest
from urllib.parse import urlencode

import requests
import pg8000.dbapi

from decoder.grib_crs import configuration
from decoder.sampling import file_hash
from publication import recovery
from publication.domain import ROOT, database


def write(path:Path,value:dict) -> None:
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2,default=str)+'\n',encoding='utf8')


def prepare(inventory:Path,output:Path,clock:str,limit:int) -> None:
    source=json.loads(inventory.read_bytes())
    if source['state']!='completed' or any(m.get('decoded') is None for f in source['files'] for m in f['messages']):
        raise ValueError('Требуется завершённая проверка всех числовых сообщений')
    files=[f for f in source['files'] if f['name']!='ICON_EU_T_G_2026101500.grib2']
    if limit:files=files[:limit]
    report:dict={'scope':'локальная подготовка реальных многополевых обновлений','clock':clock,
                 'inventory_sha256':file_hash(inventory),'jobs':[],'state':'preparing'}
    started=time.monotonic()
    for ordinal,entry in enumerate(files,1):
        path=Path('/input')/entry['name']
        if path.name!=entry['name'] or path.stat().st_size!=entry['bytes'] or file_hash(path)!=entry['sha256']:
            raise ValueError('Вход изменился после проверки: '+entry['name'])
        request={'hours':list(range(1,len(entry['messages'])+1)),'fixture':'actual','recoverable':True,
                 'source_profile':'grib2-fields','crs_configuration':configuration()}
        begin=datetime.now(timezone.utc).isoformat();timer=time.monotonic()
        delivery_clock=(datetime.fromisoformat(clock.replace('Z','+00:00'))+timedelta(seconds=ordinal)).isoformat().replace('+00:00','Z')
        job=recovery.submit(delivery_clock,request,entry['name'],entry['sha256'],0)
        report['jobs'].append({'job':job,'source':entry['name'],'bytes':entry['bytes'],
                               'messages':len(entry['messages']),'delivery_clock':delivery_clock,'capture_started_at':begin,
                               'capture_seconds':time.monotonic()-timer})
        write(output,report)
    report.update(state='prepared',capture_seconds=time.monotonic()-started)
    write(output,report)


def corpus(base:str,output:Path) -> None:
    response=requests.get(base+'/api/v1/catalogue',timeout=30);response.raise_for_status()
    selections=response.json()['selections']
    controls=[s for s in selections if s['field']=='T_G:surface:0']
    if not controls:raise ValueError('Validated ICON control selection is required')
    representatives:list[dict]=[]
    for code in ('0.3.1','0.0.0','0.1.52'):
        match=next((s for s in reversed(selections) if s.get('field_label')=='Поле GRIB '+code and len(s['valid_times'])>=2),None)
        if match and match['field'] not in {s['field'] for s in representatives}:representatives.append(match)
    if len(representatives)!=3:raise ValueError('Published ENA pressure, temperature and precipitation scalars are required')
    buckets:list[list[dict]]=[]
    for selected in controls[:1]+representatives:
        bucket:list[dict]=[]
        add_operations(base,selected,bucket)
        for operation in bucket:operation.update(model=selected['model'],field=selected['field'],selection=selected['selection'])
        buckets.append(bucket)
    operations=[operation for row in zip_longest(*buckets) for operation in row if operation is not None]
    body={'scope':'Публичный gateway; контроль ICON и реальные скалярные поля ENA на закреплённых выборках',
          'selections':controls[:1]+representatives,'operations':operations,
          'wind_selection':next(s for s in selections if s.get('wind_axis')=='u' and s['revision']==representatives[0]['revision']),
          'percentile':'nearest rank: ceil(p*n)-1; successes only',
          'point_reference':'validated source cell from published metadata; independent actual-sample gate remains required'}
    body['corpus_sha256']=hashlib.sha256(json.dumps(operations,sort_keys=True).encode()).hexdigest()
    write(output,body)


def add_operations(base:str,selected:dict,operations:list[dict]) -> None:
    response=requests.get(base+selected['collection'],timeout=30);response.raise_for_status()
    description=response.json()
    cell=next(c for c in description['grid']['cell_centres'] if c['value'] is not None)
    query={key:selected[key] for key in ('selection','run','revision','valid_time')}
    query.update(layer=selected['field'],lon=cell['lon'],lat=cell['lat'],crs=description['storageCrs'])
    response=requests.get(base+selected['native_display'],timeout=30);response.raise_for_status()
    native=response.json()
    operations.extend([{'operation':'point','path':selected['point']+'?'+urlencode(query),
                 'expected':{'value':cell['value'],'units':selected['units'],'identity':selected['selection']}},
                {'operation':'metadata','path':selected['native_display']}])
    for row in range(native['rows'][1]+1):
        for col in range(native['columns'][1]+1):
            path=native['url'].replace('{column}',str(col)).replace('{row}',str(row))
            operations.extend([{'operation':'numeric','path':path},
                               {'operation':'image','path':path.removesuffix('.f32')+'.png'}])


def warm(base:str,source:Path,output:Path,representation:str='all') -> None:
    saved=json.loads(source.read_bytes());records=[]
    with requests.Session() as session:
        for operation in saved['operations']:
            if operation['operation'] in ('numeric','image') and representation not in ('all',operation['operation']):continue
            timer=time.monotonic();response=session.get(base+operation['path'],timeout=30)
            records.append({'operation':operation['operation'],'status':response.status_code,
                'cache':response.headers.get('X-HMC-Cache'),'elapsed_ms':(time.monotonic()-timer)*1000})
    write(output,{'scope':'One corpus priming pass; bounded LRU may evict entries; browser profile remains fresh',
                  'corpus_sha256':saved['corpus_sha256'],'requests':records})


def load(base:str,source:Path,output:Path,clients:int,seconds:int,phase:str,key:Path|None,stop:Path|None=None,representation:str='all') -> None:
    from trials.metrics import snapshot as telemetry
    resource_start=telemetry()
    saved=json.loads(source.read_bytes());operations=[operation for operation in saved['operations']
        if operation['operation'] not in ('numeric','image') or representation in ('all',operation['operation'])]
    if not operations:raise ValueError('Empty workload corpus')
    observed_start=datetime.now(timezone.utc).isoformat()
    started=time.monotonic();end=started+(1800 if stop else seconds)
    def client(number:int):
        session=requests.Session();records=[];index=number
        if key:session.headers['X-API-Key']=key.read_text().strip()
        time.sleep(number/clients)
        try:
            while time.monotonic()<end:
                if stop and time.monotonic()-started>=seconds and stop.exists():break
                operation=operations[index%len(operations)];index+=1;timer=time.monotonic()
                record:dict={'observed_at':datetime.now(timezone.utc).isoformat(),'operation':operation['operation'],
                    'model':operation['model'],'field':operation['field'],'selection':operation['selection'],
                    'status':None,'bytes':0,'cache':None,'request_id':None,'correct':False}
                try:
                    response=session.get(base+('/org' if key else '')+operation['path'],timeout=30)
                    record.update(status=response.status_code,bytes=len(response.content),request_id=response.headers.get('X-Request-ID'))
                    correct=response.status_code==200
                    if correct and operation['operation']=='point':
                        body=response.json();expected=operation['expected']
                        correct=(body['selection']==expected['identity'] and body['units']==expected['units'] and body['value']==expected['value'])
                    elif correct and operation['operation']=='numeric':correct=len(response.content)==332820
                    elif correct and operation['operation']=='image':correct=response.content.startswith(b'\x89PNG')
                    record['correct']=correct
                except (requests.RequestException,ValueError,KeyError) as error:
                    record['error_type']=type(error).__name__
                record['elapsed_ms']=(time.monotonic()-timer)*1000;records.append(record)
                time.sleep(min(1,max(0,end-time.monotonic())))
        finally:session.close()
        return records
    with concurrent.futures.ThreadPoolExecutor(max_workers=clients) as pool:
        records=[record for group in pool.map(client,range(clients)) for record in group]
    wall=time.monotonic()-started;observed_end=datetime.now(timezone.utc).isoformat();groups={}
    # Gateway keeps backend cache observations in its durable ledger rather
    # than forwarding that header. Resolve IDs after the measured traffic.
    observation_started=time.monotonic();observed_cache={};observation_error=None
    identifiers=list({record['request_id'] for record in records if record['request_id']})
    try:
        with database() as cursor:
            for offset in range(0,len(identifiers),1000):
                cursor.execute('SELECT request_id,cache FROM access.usage WHERE request_id=ANY(%s::uuid[])',
                    (identifiers[offset:offset+1000],))
                observed_cache.update({str(row['request_id']):row['cache'] for row in cursor.fetchall()})
    except (pg8000.dbapi.Error,OSError) as error:
        observation_error=type(error).__name__
    for record in records:record['cache']=observed_cache.get(record['request_id'],'unrecorded')
    cache_observation={'source':'access.usage correlated by gateway X-Request-ID; SELECT batches <=1000 after the HTTP interval',
        'requests':len(records),'requests_with_id':sum(bool(record['request_id']) for record in records),
        'unique_ids':len(identifiers),'matched_ids':len(observed_cache),'error_type':observation_error,
        'seconds':time.monotonic()-observation_started,'status':'complete' if observation_error is None and len(records)==len(identifiers)==len(observed_cache) else 'incomplete'}
    for operation in sorted({r['operation'] for r in records}):
        selected=[r for r in records if r['operation']==operation];ok=[r for r in selected if r['correct']]
        values=sorted(r['elapsed_ms'] for r in ok)
        groups[operation]={'requests':len(selected),'successful':len(ok),'successful_per_second':len(ok)/wall,
            'latency_ms':{str(p):values[math.ceil(p*len(values))-1] if values else None for p in (.5,.95,.99)},
            'bytes':sum(r['bytes'] for r in selected),'status_counts':dict(Counter(str(r['status']) for r in selected)),
            'cache_counts':dict(Counter(str(r['cache']) for r in selected)),
            'cold_tail_warning':len(values)<100,'errors':len(selected)-len(ok)}
    write(output,{'scope':'HTTP через gateway; не стоимость отрисовки браузера','clients':clients,'requested_seconds':seconds,
        'observed_start':observed_start,'observed_end':observed_end,'cache_observation':cache_observation,
        'wall_seconds':wall,'phase':phase,'representation':representation,'cache_scope':'process-local cache; classify actual X-HMC-Cache; OS cache uncontrolled',
        'corpus_sha256':saved['corpus_sha256'],'groups':groups,'requests':records,
        'load_generator_resources':{'start':resource_start,'end':telemetry()}})


def snapshot(output:Path) -> None:
    classes:Counter[str]=Counter();allocated:Counter[str]=Counter();seen=set();races=0
    owners:dict[str,Counter]= {}
    for parent,_,names in os.walk(ROOT):
        for name in names:
            path=Path(parent)/name
            try:value=path.stat(follow_symlinks=False)
            except FileNotFoundError:races+=1;continue
            if not stat.S_ISREG(value.st_mode) or (value.st_dev,value.st_ino) in seen:continue
            seen.add((value.st_dev,value.st_ino))
            kind=('zarr' if any(p.endswith('.zarr') for p in path.parts) else
                  'staging' if '.working.' in name or name.startswith('capture-') else
                  'managed_originals' if name.endswith(('.grib2','.grb')) else
                  ('native_cog_overviews' if value.st_nlink>1 or 'mosaic' not in path.parts else 'gis_derivatives') if name.endswith('.tif') else
                  'numeric_readiness_tiles' if name.endswith('.f32') else 'metadata_and_indexes')
            classes[kind]+=value.st_size;allocated[kind]+=getattr(value,'st_blocks',0)*512
            owner=path.relative_to(ROOT).parts[0]
            owners.setdefault(owner,Counter())[kind]+=value.st_size
    with database() as cursor:
        cursor.execute('SELECT state,count(*) AS count FROM app.jobs GROUP BY state');jobs=cursor.fetchall()
        complete_history=output.name in ('final-storage.json','failure-storage.json')
        column='history' if complete_history else "jsonb_build_array(history->-1) AS history"
        cursor.execute('SELECT id,source_name,state,selection,'+column+' FROM app.jobs ORDER BY submitted_at,id');history=cursor.fetchall()
        cursor.execute('SELECT usename,count(*) AS connections FROM pg_stat_activity GROUP BY usename');connections=cursor.fetchall()
        cursor.execute('SELECT pg_database_size(current_database()) AS bytes');database_bytes=cursor.fetchone()['bytes']
        cursor.execute("SELECT bucket,count(*) AS requests,COALESCE(sum(bytes),0) AS bytes, "
            "count(*) FILTER (WHERE admitted AND (expires_at>clock_timestamp() OR (backend_started AND NOT backend_done))) AS active, "
            "count(*) FILTER (WHERE status=429) AS rejected_429,count(*) FILTER (WHERE status=504) AS timed_out_504 "
            "FROM access.usage WHERE observed_at>clock_timestamp()-interval '60 seconds' OR "
            "(admitted AND (expires_at>clock_timestamp() OR (backend_started AND NOT backend_done))) GROUP BY bucket")
        budget_usage=cursor.fetchall()
    from publication.retention import snapshot as retention_snapshot
    policy,clock,roots=retention_snapshot()
    try:
        response=requests.get('http://api:8000/ops/diagnostics',timeout=10);response.raise_for_status()
        api=response.json()
    except (requests.RequestException,ValueError) as error:api={'unavailable':type(error).__name__}
    visibility_path=output.parent/'visibility.json'
    visibility=json.loads(visibility_path.read_bytes()) if visibility_path.exists() else {}
    for job in history:
        identifier=str(job['id'])
        if job['state']!='published' or visibility.get(identifier,{}).get('status') in (200,410):continue
        version=1 if job['source_name']=='ICON_EU_T_G_2026101500.grib2' else 3
        try:
            response=requests.get(f'http://gateway:8000/api/v1/selections/{job["selection"]}/display/{version}/native.json',timeout=30)
            status=response.status_code
            if status==200 and response.json().get('selection')!=job['selection']:raise ValueError('Gateway selection mismatch')
        except (requests.RequestException,ValueError):status=None
        visibility[identifier]={'selection':job['selection'],'status':status,'observed_at':datetime.now(timezone.utc).isoformat()}
    write(visibility_path,visibility)
    catalogue_evidence=None
    if output.name=='final-storage.json':
        timer=time.monotonic()
        response=requests.get('http://gateway:8000/api/v1/catalogue?view=compact',timeout=30)
        response.raise_for_status();body=response.json()
        catalogue_evidence={'status':response.status_code,'bytes':len(response.content),'elapsed_ms':(time.monotonic()-timer)*1000,
            'templates':len(body['templates']),'unique_batches':len(body['batches']),'retained_revisions':len(body['revisions']),
            'revision_references':sum(len(root['batches']) for root in body['revisions'])}
    write(output,{'observed_at':datetime.now(timezone.utc).isoformat(),'scope':'managed filesystem; hardlinks counted once; in-memory caches are separate',
                  'logical_bytes':dict(classes),'allocated_bytes':dict(allocated),'transient_stat_races':races,
                  'job_storage':[{'job':str(job['id']),'state':job['state'],'logical_bytes':dict(owners.get(str(job['id']),{})),
                      'working_bytes_excluding_originals':sum(value for kind,value in owners.get(str(job['id']),{}).items() if kind!='managed_originals')}
                      for job in history],
                  'temporary_scope':'Per-job working bytes are an overlapping breakdown of total classes, not extra copies. Non-published job observations include in-flight work; five-second polling may miss transients; job state and file walks are not atomic.',
                  'job_history_scope':'complete' if complete_history else 'last event only; complete history captured in final/failure snapshot',
                  'job_counts':jobs,'jobs':history,'database_connections':connections,'database_bytes':database_bytes,'retention_roots':roots,'retention_policy':policy,'policy_clock':clock,
                  'budget_usage_last_60_seconds_and_active':budget_usage,
                  'api_diagnostics':api,'gateway_visibility':visibility,'catalogue':catalogue_evidence,
                  'observer_scope':'Polling adds filesystem walks and one native metadata request for each newly published job; no OS cache flush'})


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['prepare','corpus','load','snapshot','warm'])
    parser.add_argument('--input',type=Path);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--base',default='http://gateway:8000');parser.add_argument('--clock',default='2026-10-21T07:00:00Z')
    parser.add_argument('--limit',type=int,default=0);parser.add_argument('--clients',type=int,choices=[1,10,50,100],default=1)
    parser.add_argument('--seconds',type=int,default=60);parser.add_argument('--phase',choices=['cold','warm'],default='warm')
    parser.add_argument('--key',type=Path,help='Одноразовый ключ выделенной нагрузочной организации; никогда не включается в отчёт')
    parser.add_argument('--representation',choices=['all','numeric','image'],default='all')
    parser.add_argument('--stop',type=Path,help='Stop after minimum duration AND browser completion; bounded by 1800 seconds')
    args=parser.parse_args()
    if args.output.exists():parser.error('Требуется новый файл отчёта')
    if not 1<=args.seconds<=3600 or args.limit<0:parser.error('Неверные границы нагрузки')
    if args.command=='snapshot':snapshot(args.output)
    elif args.command=='corpus':corpus(args.base,args.output)
    elif args.input is None:parser.error('--input required')
    elif args.command=='warm':warm(args.base,args.input,args.output,args.representation)
    elif args.command=='prepare':prepare(args.input,args.output,args.clock,args.limit)
    else:load(args.base,args.input,args.output,args.clients,args.seconds,args.phase,args.key,args.stop,args.representation)


if __name__=='__main__':main()
