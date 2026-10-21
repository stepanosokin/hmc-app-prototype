import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const adb='data/tools/t16-android/sdk/platform-tools/adb.exe',serial='192.168.2.191:44091';
const run=(...args)=>execFileSync(adb,['-P','5041','-s',serial,...args],{encoding:'utf8',windowsHide:true,timeout:15000});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const html='<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#234;color:white;font:16px sans-serif}details{position:absolute;left:10px;top:70px;width:250px}#nav{top:550px;width:80px}summary{padding:12px;border:1px solid white}p{padding:10px}</style><details id="forecast"><summary>Расчёт / глобус</summary><p>Проекция</p></details><details id="nav"><summary>Карта</summary><p>К области данных</p></details><script>window.events=[];for(const t of ["pointerdown","pointerup","touchstart","touchend","touchcancel","click"])document.addEventListener(t,e=>events.push({type:t,time:performance.now(),target:e.target.parentElement.id,prevented:e.defaultPrevented}),true)</script>';
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);});
await new Promise(r=>server.listen(8160,'127.0.0.1',r));
let port,target,socket,call;const report={rounds:[],cleanup:{}};
try{
 run('reverse','--no-rebind','tcp:8160','tcp:8160');
 port=run('forward','tcp:0','localabstract:chrome_devtools_remote').trim();
 const url='http://127.0.0.1:8160/?t16-touch-diagnostic';
 run('shell','am','start','-a','android.intent.action.VIEW','-d',url,'-p','com.android.chrome');
 for(let i=0;i<60;i++){const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();target=pages.find(p=>p.url===url);if(target)break;await delay(100);}
 assert.ok(target);socket=new WebSocket(target.webSocketDebuggerUrl.replace(/localhost|127\.0\.0\.1/, '127.0.0.1'));
 await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
 let id=0;const pending=new Map();socket.onmessage=e=>{const v=JSON.parse(e.data),p=pending.get(v.id);if(p){pending.delete(v.id);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result);}};
 call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
 const evaluate=async expression=>(await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
 await call('Page.bringToFront');
 for(const method of ['manual','gesture']){
  let missed=0;
  for(let i=0;i<12;i++)for(const selector of ['#forecast>summary','#nav>summary']){
   const p=await evaluate(`(()=>{const e=document.querySelector('${selector}'),r=e.getBoundingClientRect();window.token=false;e.addEventListener('click',()=>window.token=true,{once:true});return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
   if(method==='manual'){
    await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:Math.floor(p.x)+.5,y:Math.floor(p.y)+.5,id:1}]});await delay(50);await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   }else await call('Input.synthesizeTapGesture',{...p,duration:50,tapCount:1,gestureSourceType:'touch'});
   let clicked=false;for(let t=0;t<10;t++){if(await evaluate('window.token')){clicked=true;break;}await delay(100);}
   if(!clicked)missed++;
   report.rounds.push({method,selector,clicked});await delay(100);
  }
  report[method]={missed};
 }
 report.events=await evaluate('window.events');report.status='completed';
}catch(e){report.failure=String(e);process.exitCode=1;}finally{
 if(target)try{await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);report.cleanup.tab_closed=true;}catch{}
 socket?.close();if(port){run('forward','--remove','tcp:'+port);report.cleanup.forward_removed=true;}run('reverse','--remove','tcp:8160');report.cleanup.reverse_removed=true;
 await new Promise(r=>server.close(r));report.cleanup.server_closed=true;
 fs.writeFileSync('docs/evidence/t16/checks/touch-diagnostic.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,manual:report.manual,gesture:report.gesture,cleanup:report.cleanup}));
}
