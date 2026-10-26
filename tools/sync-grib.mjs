#!/usr/bin/env node
// Resolve the actual running stand; no Compose defaults or implicit service startup.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function fail(message){throw Error(message);}
function docker(args,environment=process.env){
    const result=spawnSync('docker',args,{cwd:root,env:environment,encoding:'utf8',timeout:600000,maxBuffer:16*1024**2});
    if(result.error||result.status!==0)fail('Операция Docker не выполнена. '+(args[0]==='run'?(result.stderr??'').slice(-1600):'Проверьте доступность Docker и служб стенда.'));
    return result.stdout.trim();
}
export function standConfiguration(containers,project){
    const service=name=>{
        const matches=containers.filter(item=>item.Config.Labels['com.docker.compose.project']===project&&item.Config.Labels['com.docker.compose.service']===name);
        if(matches.length!==1||!matches[0].State.Running)fail('Служба '+name+' остановлена или не определена однозначно. Запустите стенд отдельно.');
        return matches[0];
    };
    const db=service('db'),api=service('api');service('gateway');service('geoserver');
    const assets=api.Mounts.find(item=>item.Destination==='/assets'&&item.Type==='volume');
    const networks=Object.keys(api.NetworkSettings.Networks).filter(name=>db.NetworkSettings.Networks[name]?.Aliases?.includes('db'));
    if(!assets?.Name||networks.length!==1)fail('Не удалось однозначно определить том данных и сеть стенда.');
    const password=db.Config.Env.find(item=>item.startsWith('WORKER_PASSWORD='))?.slice('WORKER_PASSWORD='.length);
    if(!password)fail('В конфигурации стенда нет учётных данных оператора.');
    return {assets:assets.Name,network:networks[0],image:api.Image,db:db.Id,password};
}
async function runOwned(args,environment,name,owner,timeoutMs){
    let child,timer,cancel;
    try{
        return await new Promise((resolve,reject)=>{
            child=spawn('docker',args,{cwd:root,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
            let stdout='',stderr='',timedOut=false;
            child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>16*1024**2)child.kill();});
            child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-1600);});
            cancel=()=>{timedOut=true;child.kill();};
            process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
            timer=setTimeout(cancel,timeoutMs);
            child.once('error',reject);
            child.once('close',code=>code===0&&!timedOut?resolve(stdout.trim()):reject(Error(
                timedOut?'Операция прервана; проверьте каталог перед повторным просмотром.':'Операция не выполнена. '+stderr)));
        });
    }finally{
        clearTimeout(timer);
        if(cancel){process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
        const ids=docker(['container','ls','--all','--quiet','--filter',`name=^/${name}$`]);
        if(ids){
            const container=JSON.parse(docker(['inspect',ids]))[0];
            if(container.Config.Labels['hmc.grib-sync.owner']!==owner)fail('Не удалось подтвердить владельца контейнера операции.');
            docker(['stop','--time','20',ids]);
            // --rm normally removes it; retain no stopped remnants after errors.
            if(docker(['container','ls','--all','--quiet','--filter',`name=^/${name}$`]))docker(['rm','--force',ids]);
        }
        if(docker(['container','ls','--all','--quiet','--filter',`name=^/${name}$`]))fail('Не удалось удалить контейнер операции.');
    }
}
export function parseOptions(args){
    const options={};
    for(let i=0;i<args.length;i++){
        const key=args[i];
        if(Object.hasOwn(options,key))fail('Повторный параметр.');
        if(key==='--include-unlocated'){options[key]=true;continue;}
        if(!['--plan','--project','--input-directory','--storage-budget-bytes'].includes(key)||i+1>=args.length||args[i+1].startsWith('--'))fail('Неизвестный параметр или отсутствует значение.');
        options[key]=args[++i];
    }
    if(!options['--plan'])fail('Укажите --plan ФАЙЛ.');
    const budget=options['--storage-budget-bytes'];
    if(budget!==undefined&&(!/^[1-9]\d*$/.test(budget)||!Number.isSafeInteger(Number(budget))))fail('Бюджет хранилища должен быть положительным целым числом байтов.');
    return options;
}
async function main(){
    const [operation,...args]=process.argv.slice(2);
    if(!['preview','apply'].includes(operation))fail('Использование: node tools/sync-grib.mjs preview|apply --plan ФАЙЛ [--project ИМЯ] [--input-directory ПАПКА] [--include-unlocated] [--storage-budget-bytes ЧИСЛО]');
    const options=parseOptions(args),includeUnlocated=options['--include-unlocated']===true;
    const storageBudgetBytes=options['--storage-budget-bytes']??null;
    const project=options['--project']??'hmc-app-live';
    if(!/^[a-z0-9][a-z0-9-]+$/.test(project))fail('Некорректное имя стенда.');
    const input=path.resolve(root,options['--input-directory']??'data/grib'),plan=path.resolve(options['--plan']);
    if(!fs.lstatSync(input).isDirectory()||fs.lstatSync(input).isSymbolicLink())fail('Исходная папка отсутствует или недоступна.');
    if(operation==='preview'&&fs.existsSync(plan))fail('Файл плана уже существует: выберите новое имя.');
    if(operation==='apply'&&(!fs.lstatSync(plan).isFile()||fs.lstatSync(plan).isSymbolicLink()))fail('План отсутствует или недоступен.');
    if(!fs.statSync(path.dirname(plan)).isDirectory())fail('Каталог плана отсутствует.');
    const ids=docker(['container','ls','--all','--quiet','--filter','label=com.docker.compose.project='+project]).split(/\r?\n/).filter(Boolean);
    if(!ids.length)fail('Стенд остановлен или не найден. Запустите его отдельно.');
    // Full inspect stays in process memory; environments must never be printed.
    const stand=standConfiguration(JSON.parse(docker(['inspect',...ids])),project);
    const runtime=Object.fromEntries(['publication/grib_sync.py','publication/revisions.py','publication/domain.py','publication/retention.py','tools/sync-grib.mjs'].map(name=>
        [name,createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')]));
    const target=createHash('sha256').update(JSON.stringify({project,input,db:stand.db,assets:stand.assets,image:stand.image,runtime,includeUnlocated,storageBudgetBytes})).digest('hex');
    const owner=randomUUID(),name='hmc-grib-sync-'+owner;
    const command=['run','--rm','--name',name,'--label','com.docker.compose.project='+project,
        '--label','hmc.grib-sync.owner='+owner,'--read-only','--cap-drop=ALL','--network',stand.network,'--user','65532:65532',
        '--tmpfs','/tmp:rw,size=64m,mode=1777','--env','DB_USER=hmc_worker','--env','DB_PASSWORD',
        ...(storageBudgetBytes===null?[]:['--env',`PUBLICATION_STORAGE_BYTES=${storageBudgetBytes}`]),
        '--mount',`type=volume,source=${stand.assets},target=/assets`,
        '--mount',`type=bind,source=${input},target=/input,readonly`,
        '--mount',`type=bind,source=${path.join(root,'publication')},target=/app/publication,readonly`,
        '--mount',`type=bind,source=${path.dirname(plan)},target=/plan`,
        '--entrypoint','python',stand.image,'-m','publication.grib_sync',operation,'--target',target,'--plan','/plan/'+path.basename(plan),
        '--source-directory',input.replaceAll('\\','/'),'--source-directory',path.relative(root,input).replaceAll('\\','/')];
    if(includeUnlocated)command.push('--include-unlocated');
    console.log(await runOwned(command,{...process.env,DB_PASSWORD:stand.password},name,owner,operation==='apply'?1800000:120000));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
    try{await main();}catch(error){console.error('Синхронизация остановлена: '+error.message);process.exitCode=1;}
}
