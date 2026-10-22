import {spawn,execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const directory=resolve(process.argv[2]);await mkdir(directory,{recursive:true});
const profile=join(directory,'profile'),report={checks:[],cleanup:{}};
const delay=ms=>new Promise(r=>setTimeout(r,ms));let child,socket,call;
try{
 child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let port;for(let i=0;i<100;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{}await delay(100);}
 assert.ok(port,'Chrome endpoint');const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
 let seq=0;const pending=new Map();socket.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
 call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:'http://localhost:8140/?validation=1'});
 for(let i=0;i<300;i++){if(await evaluate('Boolean(window.captureWeatherEvidence?.().ready)'))break;await delay(100);}
 report.initial=await evaluate('window.captureWeatherEvidence?.()');assert.ok(report.initial?.ready,'Live field ready');
 await evaluate("document.getElementById('settings').click()");
 report.dom=await evaluate("({wms:document.getElementById('wmsLink')?.getAttribute('href'),api:document.getElementById('apiLink')?.getAttribute('href'),metadata:document.getElementById('metadata').textContent})");
 const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,'settings.png'),Buffer.from(shot.data,'base64'));
 assert.ok(report.dom.wms,'Settings must contain WMS URL');assert.ok(report.dom.api,'Settings must contain API URL');assert.ok(report.dom.metadata.length<2000,'Provenance must be compact, not a raw metadata document');
 report.endpoints=await evaluate(`(async()=>{const wms=await fetch(document.getElementById('wmsLink').href),xml=await wms.text(),api=await fetch(document.getElementById('apiLink').href),point=await api.json();return {wms:wms.status,wms_xml:xml.includes('WMS_Capabilities'),api:api.status,value:point.value,revision:point.revision};})()`);
 assert.equal(report.endpoints.wms,200);assert.ok(report.endpoints.wms_xml);assert.equal(report.endpoints.api,200);assert.notEqual(report.endpoints.value,null);
 report.status='passed';
}catch(e){report.status='failed';report.failure=String(e);process.exitCode=1;}
finally{
 try{if(call)await call('Browser.close');}catch{}socket?.close();await delay(600);
 if(child?.pid&&child.exitCode===null)try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});}catch{}
 try{const count=execFileSync('powershell',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:POPUP_PROBE_PROFILE) }).Count"],{encoding:'utf8',env:{...process.env,POPUP_PROBE_PROFILE:profile},windowsHide:true}).trim();assert.equal(count,'0');report.cleanup.browser_processes_remaining=0;await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});report.cleanup.profile_removed=true;}catch(e){report.cleanup.error=String(e);process.exitCode=1;}
 report.cleanup.docker_resources_created=false;report.cleanup.live_stack_retained='hmc-app-live';await writeFile(join(directory,'probe.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({directory,status:report.status,failure:report.failure,cleanup:report.cleanup}));
}
