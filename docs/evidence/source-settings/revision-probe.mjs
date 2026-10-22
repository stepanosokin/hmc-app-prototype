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
 await evaluate(`(()=>{const original=fetch;window.fetch=async(input,options)=>{if(String(input).endsWith('/native.json')){window.__held=true;await new Promise(resolve=>window.__release=resolve);}return original(input,options);};const run=document.getElementById('run');run.selectedIndex=run.options.length-1;run.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 for(let i=0;i<100;i++){if(await evaluate('Boolean(window.__held)'))break;await delay(50);}
 report.state=await evaluate('window.captureWeatherEvidence()');report.text=await evaluate("document.getElementById('metadata').textContent");
 assert.equal(report.state.time_state,'loading');assert.equal(report.state.selected.valid_time,report.state.displayed.valid_time);assert.notEqual(report.state.selected.revision,report.state.displayed.revision);
 assert.ok(report.text.includes('\u041f\u043e\u043a\u0430\u0437\u0430\u043d \u043f\u0440\u0435\u0436\u043d\u0438\u0439 \u043a\u0430\u0434\u0440'),'Same-time revision load must identify retained revision');
 assert.ok(report.text.includes(report.state.displayed.revision.slice(0,12)),'Retained revision must be named separately from requested revision');
 report.status='passed';
}catch(e){report.status='failed';report.failure=String(e);process.exitCode=1;}
finally{
 try{if(call)await call('Browser.close');}catch{}socket?.close();await delay(600);
 if(child?.pid&&child.exitCode===null)try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});}catch{}
 try{const count=execFileSync('powershell',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:POPUP_PROBE_PROFILE) }).Count"],{encoding:'utf8',env:{...process.env,POPUP_PROBE_PROFILE:profile},windowsHide:true}).trim();assert.equal(count,'0');report.cleanup.browser_processes_remaining=0;await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});report.cleanup.profile_removed=true;}catch(e){report.cleanup.error=String(e);process.exitCode=1;}
 report.cleanup.docker_resources_created=false;report.cleanup.live_stack_retained='hmc-app-live';await writeFile(join(directory,'probe.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({directory,status:report.status,failure:report.failure,cleanup:report.cleanup}));
}
