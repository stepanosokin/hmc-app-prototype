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
 const pixel=await evaluate(`(()=>{const g=window.captureWeatherEvidence(true).view,p=proj4('EPSG:4326','EPSG:3857').forward([37.6,55.7]),dpr=g.width/document.querySelector('.maplibregl-canvas').getBoundingClientRect().width;return {x:(g.origin[0]+p[0]*g.scale)/dpr,y:(g.origin[1]-p[1]*g.scale)/dpr};})()`);
 for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,...pixel,button:'left',clickCount:1});
 for(let i=0;i<300;i++){if(await evaluate('Boolean(window.captureWeatherEvidence().point?.value!=null&&!window.captureWeatherEvidence().series.busy)'))break;await delay(100);}
 report.state=await evaluate('window.captureWeatherEvidence()');
 report.dom=await evaluate(`['pointContent','mobilePoint'].map(id=>{const c=document.getElementById(id),s=c.querySelector('svg'),r=s?.getBoundingClientRect();return {id,text:c.innerText,svg:s?.outerHTML,rect:r&&{x:r.x,y:r.y,width:r.width,height:r.height},styles:s&&{display:getComputedStyle(s).display,visibility:getComputedStyle(s).visibility},values:[...c.querySelectorAll('.seriesValue,.selectedValue')].map(n=>({cx:n.getAttribute('cx'),cy:n.getAttribute('cy'),fill:getComputedStyle(n).fill}))};})`);
 const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,'popup.png'),Buffer.from(shot.data,'base64'));
 assert.ok(report.state.point?.value!=null,'Numeric point shown');
 const chart=report.dom[0];assert.ok(chart.values.length>0,'Chart has actual points');assert.ok(chart.rect.width>0&&chart.rect.height>0,'Popup SVG has visible area');
 assert.equal(report.state.series.entries.filter(e=>e.state==='value').length,24,'Live actual sample must publish all 24 source times');
 assert.equal((chart.svg.match(/<path /g)||[]).length,23,'Popup must draw all 23 adjacent forecast segments');
 report.status='passed';
}catch(e){report.status='failed';report.failure=String(e);process.exitCode=1;}
finally{
 try{if(call)await call('Browser.close');}catch{}socket?.close();await delay(600);
 if(child?.pid&&child.exitCode===null)try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});}catch{}
 try{const count=execFileSync('powershell',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:POPUP_PROBE_PROFILE) }).Count"],{encoding:'utf8',env:{...process.env,POPUP_PROBE_PROFILE:profile},windowsHide:true}).trim();assert.equal(count,'0');report.cleanup.browser_processes_remaining=0;await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});report.cleanup.profile_removed=true;}catch(e){report.cleanup.error=String(e);process.exitCode=1;}
 report.cleanup.docker_resources_created=false;report.cleanup.live_stack_retained='hmc-app-live';await writeFile(join(directory,'probe.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({directory,status:report.status,failure:report.failure,cleanup:report.cleanup}));
}
