// Direct live-site regression: no proxy and no replacement build or field data.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';

const directory=resolve(process.argv[2]),origin=process.env.HMC_CONTOUR_LIVE_ORIGIN??'http://127.0.0.1:8140';
const browser=process.argv[3]??'chrome',size=process.argv[4]??'1440x900';
assert.ok(['chrome','edge'].includes(browser));assert.match(size,/^\d+x\d+$/);
const [width,height]=size.split('x').map(Number);
assert.ok(directory.startsWith(resolve('data/reports/contour-live')+sep));
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
await mkdir(resolve('data/reports/contour-live'),{recursive:true});await mkdir(directory,{recursive:false});
const profile=join(directory,'profile'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const report={origin,scope:'Actual running viewer; no fixture proxy, build, publication or service changes',errors:[],responses:[],cleanup:{}};
let child,socket,call;
try{
 const executable=browser==='edge'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'C:/Program Files/Google/Chrome/Application/chrome.exe';
 child=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let port;for(let i=0;i<100;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{}await pause(100);}assert.ok(port,'Owned browser started');
 const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((res,rej)=>{socket.onopen=res;socket.onerror=rej;});
 let id=0;const pending=new Map();
 socket.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}
  else if(m.method==='Runtime.exceptionThrown')report.errors.push(m.params.exceptionDetails.text);
  else if(m.method==='Network.responseReceived'){const r=m.params.response,u=new URL(r.url);if(u.origin===origin&&(r.status>=400||/\.(?:js|mjs)$/.test(u.pathname)||u.pathname==='/'))report.responses.push({path:u.pathname,status:r.status,mime:r.mimeType});}
 };
 call=(method,params={})=>new Promise((res,rej)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);rej(Error('CDP timeout '+method));},15000);pending.set(n,{resolve:res,reject:rej,timer});socket.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
 await call('Page.enable');await call('Runtime.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});report.viewport={width,height,scope:'Desktop browser with responsive viewport; not physical Android'};
 report.browser=await call('Browser.getVersion');
 const start=performance.now();await call('Page.navigate',{url:origin+'/?validation=1'});
 let state;
 for(let i=0;i<600;i++){
  state=await evaluate("(()=>{const s=window.captureWeatherEvidence?.(),c=s?.contours;return {ready:s?.ready??false,field:s?.displayed?.field_short_name,mode:s?.mode,button:Boolean(document.getElementById('contourToggle')),canvas:Boolean(document.querySelector('.fieldContours')),contours:c?{state:c.state,message:c.message,enabled:c.enabled,worker_active:c.worker_active,curves:c.curves}:null};})()");
  if(state.ready&&(!state.button||!state.contours||['ready','empty','error'].includes(state.contours.state)))break;
  await pause(100);
 }
 report.elapsed_ms=performance.now()-start;report.state=state;
 const screenshot=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,'live.png'),Buffer.from(screenshot.data,'base64'));
 assert.equal(state.ready,true,'Underlying live raster must be ready');
 assert.equal(state.button,true,'Live viewer has no isoline control');
 assert.ok(state.contours,'Live viewer has no isoline runtime');
 assert.equal(state.contours.state,'ready','Live isolines did not become ready');
 assert.ok(state.canvas&&state.contours.curves>0,'Live field has no rendered isolines');
 await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 report.contour_ink_pixels=await evaluate("(()=>{const c=document.querySelector('.fieldContours'),a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<a.length;i+=4)if(a[i])n++;return n;})()");
 assert.ok(report.contour_ink_pixels>0,'Isoline canvas has no painted pixels');
 if(process.argv.includes('--interaction')){
  const click=async selector=>{const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...p});};
  if(!await evaluate("document.getElementById('legendPanel').open"))await click('#legendPanel>summary');
  const selection=await evaluate('captureWeatherEvidence().displayed.selection');await click('#contourToggle');
  assert.equal(await evaluate('captureWeatherEvidence().contours.enabled'),false);assert.equal(await evaluate('captureWeatherEvidence().contours.worker_active'),false);
  assert.equal(await evaluate('captureWeatherEvidence().displayed.selection'),selection);
  await click('#contourToggle');await pause(200);
  assert.equal(await evaluate('captureWeatherEvidence().contours.enabled'),true);report.toggle='off/on passed; raster selection retained';
 }
 report.status='passed';
}catch(error){report.status='failed';report.failure=String(error.message??error);process.exitCode=1;}
finally{
 try{
  if(call)try{await call('Page.navigate',{url:'about:blank'});await call('Browser.close');}catch{}socket?.close();
  if(child){for(let i=0;i<50&&child.exitCode===null;i++)await pause(100);if(child.exitCode===null)execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});}
  const count=execFileSync('powershell',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:HMC_CONTOUR_PROFILE) }).Count"],{encoding:'utf8',windowsHide:true,env:{...process.env,HMC_CONTOUR_PROFILE:profile}}).trim();
  assert.equal(count,'0');assert.ok(profile.startsWith(directory+sep));await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  report.cleanup={browser_processes_remaining:0,profile_removed:true,services_modified:false};
 }catch(error){report.status='failed';report.cleanup={error:String(error)};process.exitCode=1;}
 await writeFile(join(directory,'validation.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,state:report.state,failure:report.failure,elapsed_ms:report.elapsed_ms,cleanup:report.cleanup}));
}
