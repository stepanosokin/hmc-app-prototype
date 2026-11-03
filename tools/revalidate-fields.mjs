#!/usr/bin/env node
// Apply the same validity policy to old immutable publications through new revisions.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {docker,runOwned,standConfiguration} from './sync-grib.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function parseOptions(args){
    const [operation,...rest]=args,options={};
    if(!['preview','apply'].includes(operation))throw Error('Укажите preview или apply.');
    for(let i=0;i<rest.length;i+=2){
        const key=rest[i],value=rest[i+1];
        if(!['--project','--plan','--storage-budget-bytes','--expect-rebuild-batches','--expect-field'].includes(key)||!value||value.startsWith('--')||Object.hasOwn(options,key))
            throw Error('Неизвестный или повторный параметр, либо отсутствует значение.');
        options[key]=value;
    }
    if(!options['--plan'])throw Error('Укажите --plan ФАЙЛ.');
    if(options['--project']&&!/^[a-z0-9][a-z0-9-]+$/.test(options['--project']))throw Error('Некорректное имя стенда.');
    const budget=options['--storage-budget-bytes'];
    if(budget&&(!/^[1-9]\d*$/.test(budget)||!Number.isSafeInteger(Number(budget))))throw Error('Некорректный бюджет хранилища.');
    const expected=options['--expect-rebuild-batches'],field=options['--expect-field'];
    if(operation==='apply'&&(expected===undefined||!/^(0|[1-9]\d*)$/.test(expected)||!Number.isSafeInteger(Number(expected))))
        throw Error('Для apply укажите ожидаемое число партий: --expect-rebuild-batches N.');
    if(operation==='preview'&&(expected!==undefined||field!==undefined))throw Error('Ограничения объёма задаются для apply.');
    return {operation,project:options['--project']??'hmc-app-live',plan:path.resolve(options['--plan']),budget,
        expected:expected===undefined?undefined:Number(expected),field};
}
export function summarizePlan(plan){
    if(plan?.version!=='field-revalidation/1'||!Array.isArray(plan.actions))throw Error('Некорректный план пересчёта.');
    const all=new Set(),rebuilt=new Map();
    for(const action of plan.actions){
        if(!Array.isArray(action.entries)||!Array.isArray(action.rebuild_keys)||!action.rebuild_keys.length)
            throw Error('В плане отсутствует явный список rebuild_keys; создайте новый preview.');
        const entries=new Map();
        for(const entry of action.entries){
            if(!entry||['key','field','manifest_path','manifest_sha256'].some(k=>typeof entry[k]!=='string'||!entry[k])||entries.has(entry.key))
                throw Error('Некорректная или повторная партия в плане.');
            entries.set(entry.key,entry);all.add(JSON.stringify([entry.manifest_path,entry.manifest_sha256]));
        }
        const keys=new Set();
        for(const key of action.rebuild_keys){
            const entry=entries.get(key);
            if(!entry||keys.has(key))throw Error('Некорректный или повторный rebuild_keys.');
            keys.add(key);
            const reference=JSON.stringify([entry.manifest_path,entry.manifest_sha256]);
            if(rebuilt.has(reference)&&rebuilt.get(reference)!==entry.field)throw Error('Противоречивое поле одной партии.');
            rebuilt.set(reference,entry.field);
        }
    }
    const fields=new Map();for(const field of rebuilt.values())fields.set(field,(fields.get(field)??0)+1);
    return {roots:plan.actions.length,rebuild_batches:rebuilt.size,reused_batches:all.size-rebuilt.size,
        fields:[...fields].sort(([a],[b])=>a.localeCompare(b)).map(([field,batches])=>({field,batches}))};
}
export function checkScope(plan,expected,field){
    const scope=summarizePlan(plan);
    if(scope.rebuild_batches!==expected)throw Error(`План пересчитывает ${scope.rebuild_batches} партий; ожидалось ${expected}. Apply не запущен.`);
    if(field!==undefined&&scope.fields.some(item=>item.field!==field))throw Error('План затрагивает поле вне --expect-field. Apply не запущен.');
    return scope;
}
async function main(){
    const {operation,project,plan,budget,expected,field}=parseOptions(process.argv.slice(2));
    if(!fs.statSync(path.dirname(plan)).isDirectory())throw Error('Каталог плана отсутствует.');
    if(operation==='preview'&&fs.existsSync(plan))throw Error('Выберите новое имя файла плана.');
    if(operation==='apply'&&(!fs.lstatSync(plan).isFile()||fs.lstatSync(plan).isSymbolicLink()))throw Error('План недоступен.');
    // Reject excess work before discovering Docker, credentials or starting a worker.
    if(operation==='apply')console.log(JSON.stringify({revalidation_scope:checkScope(JSON.parse(fs.readFileSync(plan,'utf8')),expected,field)}));
    const ids=docker(['container','ls','--all','--quiet','--filter','label=com.docker.compose.project='+project]).split(/\r?\n/).filter(Boolean);
    if(!ids.length)throw Error('Стенд не найден. Запустите его отдельно.');
    const containers=JSON.parse(docker(['inspect',...ids])),stand=standConfiguration(containers,project);
    const environment={...process.env,DB_PASSWORD:stand.password};
    for(const [service,keys] of [['db',['MOSAIC_PASSWORD']],['geoserver',['GEOSERVER_ADMIN_USER','GEOSERVER_ADMIN_PASSWORD']]]){
        const container=containers.find(item=>item.Config.Labels['com.docker.compose.service']===service);
        for(const key of keys){
            const value=container.Config.Env.find(entry=>entry.startsWith(key+'='))?.slice(key.length+1);
            if(!value)throw Error('Не удалось определить учётные данные службы '+service+'.');
            environment[key]=value;
        }
    }
    const mounted=['decoder','publication','config','tests/fixtures/publication/tile-engine'];
    const files=mounted.flatMap(directory=>fs.readdirSync(path.join(root,directory),{recursive:true,withFileTypes:true})
        .filter(entry=>entry.isFile()&&!entry.parentPath.includes('__pycache__')&&!entry.name.endsWith('.pyc'))
        .map(entry=>path.join(entry.parentPath,entry.name)));
    files.push(fileURLToPath(import.meta.url),path.join(root,'tools/sync-grib.mjs'));
    const runtime=Object.fromEntries(files.sort().map(file=>[path.relative(root,file).replaceAll('\\','/'),
        createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
    const target=createHash('sha256').update(JSON.stringify({project,db:stand.db,assets:stand.assets,image:stand.image,budget,runtime})).digest('hex');
    const owner=randomUUID(),name='hmc-field-revalidation-'+owner;
    const args=['run','--rm','--name',name,'--label','com.docker.compose.project='+project,'--label','hmc.grib-sync.owner='+owner,
        '--read-only','--cap-drop=ALL','--network',stand.network,'--user','65532:65532',
        '--tmpfs','/tmp:rw,size=128m,mode=1777','--env','DB_USER=hmc_worker',
        ...['DB_PASSWORD','MOSAIC_PASSWORD','GEOSERVER_ADMIN_USER','GEOSERVER_ADMIN_PASSWORD'].flatMap(key=>['--env',key]),
        ...(budget?['--env','PUBLICATION_STORAGE_BYTES='+budget]:[]),
        '--mount',`type=volume,source=${stand.assets},target=/assets`,
        ...['decoder','publication','config'].flatMap(directory=>['--mount',`type=bind,source=${path.join(root,directory)},target=/app/${directory},readonly`]),
        '--mount',`type=bind,source=${path.join(root,'tests/fixtures/publication/tile-engine')},target=/evidence,readonly`,
        '--mount',`type=bind,source=${path.dirname(plan)},target=/plan`,
        '--entrypoint','python',stand.image,'-B','-m','publication.revalidate',operation,'--target',target,'--plan','/plan/'+path.basename(plan)];
    console.log(await runOwned(args,environment,name,owner,operation==='apply'?null:120000));
    if(operation==='preview')console.log(JSON.stringify({revalidation_scope:summarizePlan(JSON.parse(fs.readFileSync(plan,'utf8')))}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
    try{await main();}catch(error){console.error('Пересчёт остановлен: '+error.message);process.exitCode=1;}
}
