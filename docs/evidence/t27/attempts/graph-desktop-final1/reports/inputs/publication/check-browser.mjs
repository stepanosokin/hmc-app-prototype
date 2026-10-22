// Local comparison harness only; no application/browser UI is shipped by T4.
import {spawn} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const directory = resolve('data/reports/t4');
const executable = process.env.T4_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = resolve('.scratch/t4-chrome-cdp-'+randomUUID());
const child = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-background-networking', '--remote-debugging-address=127.0.0.1',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  {windowsHide:true, stdio:'ignore'});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let port;
  for(let attempt=0; attempt<100; attempt++) {
    try {port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break;} catch {}
    await delay(100);
  }
  if(!port)throw Error('Chrome debugging endpoint did not start');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  let next=0;const pending=new Map();
  socket.onmessage=event=>{const result=JSON.parse(event.data);if(pending.has(result.id)){
    const {resolve,reject}=pending.get(result.id);pending.delete(result.id);result.error?reject(Error(JSON.stringify(result.error))):resolve(result.result);}};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  await call('Page.navigate',{url:pathToFileURL(resolve(directory,'browser.html')).href});
  let report;
  for(let attempt=0;attempt<300;attempt++){
    const result=await call('Runtime.evaluate',{expression:"document.getElementById('result')?.textContent",returnByValue:true});
    const value=result.result?.value;
    if(value && value!=='pending'){report=JSON.parse(value);break;}
    await delay(100);
  }
  if(!report)throw Error('Browser comparison timeout');
  report.fixture_sha256=createHash('sha256').update(await readFile(resolve(directory,'browser.html'))).digest('hex');
  report.clock='2026-10-19T00:00:00Z';
  report.measurement='Headless local Chrome, real performance.now clock, SwiftShader software WebGL; decode/upload compatibility only, no hardware/mobile/frame-time readiness claim';
  await writeFile(resolve(directory,'browser.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(report.status!=='passed')process.exitCode=1;
}finally{
  socket?.close();child.kill();
}
