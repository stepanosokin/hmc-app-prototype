// THROWAWAY #79: read-only local comparison over the existing viewer, never deployed to live.
import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileViewerModules} from '../../tools/check-viewer-runtime.mjs';
import {sha,factors,contract,contractHash,unpack,aggregate,pack,levelMetadata} from './levels.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const upstream=args.upstream??'http://127.0.0.1:8140',port=Number(args.port??8158);
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(upstream)||port<1024||port>65535)throw Error('Нужны локальные адреса');
const directory=path.join(root,'data/prototype-pyramid'),modules=compileViewerModules();
const algorithmHash=sha(await readFile(new URL('./levels.mjs',import.meta.url)));
const runtimeDirectory=path.join(root,'data/reports/pyramid79/runtime-'+Date.now()),runtime=new Map();
await mkdir(runtimeDirectory,{recursive:true});
await mkdir(directory,{recursive:true});
function patch(name,from,to){let s=modules.get(name).toString();if(!s.includes(from))throw Error('Изменился исходный модуль: '+name);modules.set(name,Buffer.from(s.replace(from,to)));}
patch('field.js',"metadata.contract === 'hmc-native-display/3'",`["hmc-native-display/3","${contract}"].includes(metadata.contract)`);
patch('field.js',"metadata.contract_sha256 !== '98c9e10367d9c4185647e22758c94913d8cc9d716561ff0b93f3b1dcd71db0eb'",`!["98c9e10367d9c4185647e22758c94913d8cc9d716561ff0b93f3b1dcd71db0eb","${contractHash}"].includes(metadata.contract_sha256)`);
patch('field.js','(?:api\\/v1\\/|ogc\\/collections\\/)','(?:api\\/v1\\/|ogc\\/collections\\/|__pyramid\\/)');
patch('contours.js','enabled = false;','enabled = true;');
patch('contours.js','field?.metadata.selection !== this.field?.metadata.selection','field !== this.field');
patch('wind-overlay.js','enabled = true;','enabled = false;');
patch('contours.js',"new URL('./contour-worker.js', import.meta.url)","new URL(window.pyramidSurface ? '/__prototype/surface-worker.js' : './contour-worker.js?variant='+window.pyramidVariant, import.meta.url)");
patch('contours.js','BUILD_RESERVATION = 13 * 1024 ** 2','BUILD_RESERVATION = 34 * 1024 ** 2');
// A read-only UI harness, scoped to this server. Original point/series code is untouched.
modules.set('main.js',Buffer.concat([modules.get('main.js'),Buffer.from(`\nwindow.pyramidApp={reload:()=>chooseTime(index),
 choose:(name)=>{const g=groups.find(g=>g.selection.field_short_name===name&&g.selection.field_level_type==='surface')??groups.find(g=>g.selection.field_short_name===name);if(!g)throw Error('Поле недоступно');setGroup(g,true);},
 overview:()=>rebuild(true),zoom:()=>map.zoomIn({duration:0}),
 pointAt:(lng,lat)=>{position={lng,lat};point=undefined;series.clear();ensureSeries();renderPoint();},
 hidePoint:()=>{pointCollapsed=true;placePoint();},
 metrics:()=>({prototype:data?.metadata.prototype,shape:data?.metadata.grid.shape_yx,blocks:data?.blocks.length,
 fields:groups.map(g=>({name:g.selection.field_short_name,level:g.selection.field_level_type,label:fieldPresentation(g.selection).label})),
 point:point?.value,series:series.entries.map(e=>({time:e.time,state:e.state,value:e.result?.value,cell:e.result?.cell}))})};\n`)]));
const pending=new Map(),assets=new Map();
async function get(source){
    const u=new URL(source,upstream);if(u.origin!==upstream)throw Error('Внешний источник запрещён');
    const r=await fetch(u,{signal:AbortSignal.timeout(90000),redirect:'error'});
    if(!r.ok)throw Object.assign(Error('Источник вернул HTTP '+r.status),{status:r.status});
    return {bytes:Buffer.from(await r.arrayBuffer()),type:r.headers.get('content-type')??'application/octet-stream'};
}
async function prepare(selection){
    if(pending.has(selection))return pending.get(selection);
    const job=(async()=>{
        const target=path.join(directory,sha(upstream+'/'+selection+'/'+algorithmHash));
        let receipt;
        try{receipt=JSON.parse(await readFile(path.join(target,'receipt.json'),'utf8'));}catch{}
        if(receipt){
            if(receipt.algorithm_sha256!==algorithmHash)throw Error('Изменился алгоритм сохранённой пирамиды');
            for(const level of receipt.levels){
                const base=path.join(target,String(level.factor));
                if(sha(await readFile(path.join(base,'native.json')))!==level.metadata_sha256)throw Error('Повреждены метаданные снимка');
                for(const file of level.files){
                    if(!/^\d+-\d+\.f32$/.test(file.name))throw Error('Некорректный файл снимка');
                    const data=await readFile(path.join(base,file.name));
                    if(data.length!==file.bytes||sha(data)!==file.sha256)throw Error('Повреждён блок снимка');
                }
            }
            return {target,receipt};
        }
        const started=performance.now(),meta=await get('/api/v1/selections/'+selection+'/display/3/native.json');
        const original=JSON.parse(meta.bytes),blocks=[];
        if(original.contract!=='hmc-native-display/3')throw Error('Эксперимент поддерживает native-display/3');
        for(let row=0;row<=original.rows[1];row++)for(let col=0;col<=original.columns[1];col++){
            blocks.push((await get(original.url.replace('{column}',col).replace('{row}',row))).bytes);
        }
        const fetched=performance.now(),native=unpack(original,blocks),levels=[];
        await mkdir(target,{recursive:true});await writeFile(path.join(target,'source.json'),meta.bytes);
        for(const factor of factors){
            const begin=performance.now(),grid=aggregate(native,factor),packed=factor===1?blocks:pack(grid);
            const base='/__pyramid/'+factor+'/'+selection,metadata=levelMetadata(original,grid,factor,base);
            await mkdir(path.join(target,String(factor)),{recursive:true});
            const files=[];
            for(let i=0;i<packed.length;i++){
                const name=(i%(metadata.columns[1]+1))+'-'+Math.floor(i/(metadata.columns[1]+1))+'.f32';
                await writeFile(path.join(target,String(factor),name),packed[i]);files.push({name,sha256:sha(packed[i]),bytes:packed[i].length});
            }
            let missing=0;for(const v of grid.valid)if(!v)missing++;
            const metadataBytes=Buffer.from(JSON.stringify(metadata));
            await writeFile(path.join(target,String(factor),'native.json'),metadataBytes);
            levels.push({factor,shape:[grid.height,grid.width],blocks:packed.length,bytes:packed.reduce((n,b)=>n+b.length,0),
                preparation_ms:performance.now()-begin,missing_cells:missing,metadata_sha256:sha(metadataBytes),files});
        }
        receipt={selection,upstream,algorithm_sha256:algorithmHash,observed_at:new Date().toISOString(),source_metadata_sha256:sha(meta.bytes),
            source_blocks_sha256:blocks.map(sha),fetch_ms:fetched-started,total_preparation_ms:performance.now()-started,levels,
            scope:'Prepared snapshot HTTP comparison; not live publication or operational end-to-end latency'};
        await writeFile(path.join(target,'receipt.json'),JSON.stringify(receipt,null,2));
        return {target,receipt};
    })();pending.set(selection,job);try{return await job;}catch(e){pending.delete(selection);throw e;}
}
const server=http.createServer(async(req,res)=>{
    try{
        if(req.method!=='GET'){res.writeHead(405);res.end();return;}
        const u=new URL(req.url,'http://127.0.0.1:'+port);let bytes,type='application/javascript';
        if(u.pathname==='/__prototype/runtime.json'){
            res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
            res.end(JSON.stringify({directory:path.relative(root,runtimeDirectory),files:[...runtime.values()]}));return;
        }
        const match=u.pathname.match(/^\/__pyramid\/(1|2|4|8)\/([a-f0-9]{64}\.[a-f0-9]{64})\/(native\.json|receipt\.json|\d+\/\d+\.f32)$/);
        if(match){
            const [,factor,selection,file]=match,{target,receipt}=await prepare(selection);
            if(file==='receipt.json'){bytes=Buffer.from(JSON.stringify(receipt));type='application/json';}
            else{bytes=await readFile(path.join(target,factor,file.replace('/','-')));type=file.endsWith('.json')?'application/json':'application/vnd.hmc.native-display-f32';}
        }else if(['/__prototype/ui.js','/__prototype/surface.js','/__prototype/surface-worker.js'].includes(u.pathname))bytes=await readFile(new URL('./'+u.pathname.split('/').at(-1),import.meta.url));
        else if(u.pathname.startsWith('/build/')&&modules.has(u.pathname.slice(7))){
            bytes=modules.get(u.pathname.slice(7));
            if(u.pathname==='/build/contour-worker.js'){
                const f=Number(u.searchParams.get('variant')??1);if(!factors.includes(f))throw Error('Неизвестный уровень');
                const from='smoothLine(simplifyLine(original))';
                if(!bytes.toString().includes(from))throw Error('Изменился вызов сглаживания worker');
                bytes=Buffer.from(bytes.toString().replace(from,`smoothLine(simplifyLine(original), ${f===1?.6:f})`));
            }
        }else{
            // Public GET only; no credentials, mutation or arbitrary upstream origin.
            const key=u.pathname+u.search,cacheable=!u.pathname.startsWith('/api/')&&!u.pathname.startsWith('/ogc/');
            let result=cacheable?assets.get(key):undefined;
            if(!result){result=await get(key);if(cacheable)assets.set(key,result);}
            ({bytes,type}=result);
            if(u.pathname==='/')bytes=Buffer.from(bytes.toString().replace('<title>','<title>Прототип пирамиды · ').replace('<body>','<body><script src="/__prototype/ui.js"></script>'));
        }
        if(!u.pathname.startsWith('/api/')&&!u.pathname.startsWith('/ogc/')&&!u.pathname.startsWith('/__pyramid/')){
            const key=u.pathname+(u.pathname.endsWith('contour-worker.js')?u.search:''),hash=sha(bytes);
            if(runtime.has(key)&&runtime.get(key).sha256!==hash)throw Error('Runtime изменился во время сравнения: '+key);
            if(!runtime.has(key)){
                const file=sha(key)+'.bin';await writeFile(path.join(runtimeDirectory,file),bytes);
                runtime.set(key,{url:key,file,sha256:hash,bytes:bytes.length});
                await writeFile(path.join(runtimeDirectory,'manifest.json'),JSON.stringify([...runtime.values()],null,2));
            }
        }
        res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);
    }catch(e){res.writeHead(e.status??500,{'Content-Type':'text/plain; charset=utf-8'});res.end('Прототип: '+e.message);}
});
server.listen(port,'127.0.0.1',()=>console.log('Прототип: http://127.0.0.1:'+port+'/?validation=1&variant=1'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit()));
