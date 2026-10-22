import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const adb=resolve('data/tools/t25-android/platform-tools/adb.exe');
const run=(...args)=>execFileSync(adb,['-P','5041','-s','RZGL30TZV3V',...args],{windowsHide:true,timeout:30000}).toString().trim();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const directory='docs/evidence/t25/checks/interception-probe';await mkdir(directory,{recursive:true});
const origin='http://127.0.0.1:8299',url=origin+'/?interception='+Date.now();
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>T25</title>Проверка отмены локального запроса');});
let forward,target,socket,reverse=false;const report={scope:'Synthetic local fetch cancellation through actual physical Chrome CDP; no Compose or meteorological data',events:[]};
try{
    await new Promise((r,e)=>{server.once('error',e);server.listen(8299,'127.0.0.1',r);});
    run('reverse','--no-rebind','tcp:8299','tcp:8299');reverse=true;
    forward=run('forward','tcp:0','localabstract:chrome_devtools_remote');
    run('shell','am','start','-a','android.intent.action.VIEW','-d',url,'-p','com.android.chrome');
    for(let i=0;i<100;i++){const pages=await(await fetch(`http://127.0.0.1:${forward}/json/list`)).json();target=pages.find(p=>p.url===url);if(target)break;await delay(100);}
    assert.ok(target);const endpoint=new URL(target.webSocketDebuggerUrl);endpoint.hostname='127.0.0.1';endpoint.port=forward;
    socket=new WebSocket(endpoint);await new Promise((r,e)=>{socket.onopen=r;socket.onerror=e;});
    let next=0;const pending=new Map();socket.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==='Fetch.requestPaused')report.events.push({method:m.method,request_id:m.params.requestId,network_id:m.params.networkId,url:m.params.request.url});else if(m.method==='Network.loadingFailed')report.events.push({method:m.method,...m.params});};
    const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>(await call('Runtime.evaluate',{expression,returnByValue:true})).result.value;
    report.browser=await call('Browser.getVersion');
    await call('Network.enable');await call('Fetch.enable',{patterns:[{urlPattern:origin+'/payload',requestStage:'Request'}]});
    await evaluate("window.__cancel=new AbortController();fetch('/payload',{signal:window.__cancel.signal}).catch(e=>window.__fetchError=e.name);true");
    for(let i=0;i<100&&!report.events.some(e=>e.method==='Fetch.requestPaused');i++)await delay(20);
    const paused=report.events.find(e=>e.method==='Fetch.requestPaused');assert.ok(paused);
    await evaluate('window.__cancel.abort();true');
    for(let i=0;i<100&&!report.events.some(e=>e.method==='Network.loadingFailed'&&e.requestId===paused.network_id);i++)await delay(20);
    const cancelled=report.events.find(e=>e.method==='Network.loadingFailed'&&e.requestId===paused.network_id);assert.ok(cancelled?.canceled);
    try{await call('Fetch.continueRequest',{requestId:paused.request_id});}catch(error){report.continue_error=String(error);}
    report.fetch_error=await evaluate('window.__fetchError');
    assert.match(report.continue_error??'',/Invalid InterceptionId/);assert.equal(report.fetch_error,'AbortError');report.status='passed';
}catch(error){report.status='failed';report.failure=String(error);process.exitCode=1;}
finally{
    socket?.close();const cleanup={};
    if(target){await fetch(`http://127.0.0.1:${forward}/json/close/${target.id}`);const pages=await(await fetch(`http://127.0.0.1:${forward}/json/list`)).json();assert.ok(!pages.some(p=>p.id===target.id));cleanup.tab_closed=true;}
    if(forward){run('forward','--remove','tcp:'+forward);cleanup.forward_removed=!run('forward','--list').includes('tcp:'+forward+' ');}
    if(reverse){run('reverse','--remove','tcp:8299');cleanup.reverse_removed=!run('reverse','--list').includes('tcp:8299 ');}
    await new Promise(r=>server.close(r));cleanup.server_closed=true;report.cleanup=cleanup;
    await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
