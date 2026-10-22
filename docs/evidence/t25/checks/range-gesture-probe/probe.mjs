import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const adb=resolve('data/tools/t25-android/platform-tools/adb.exe');
const run=(...args)=>execFileSync(adb,['-P','5041','-s','RZGL30TZV3V',...args],{windowsHide:true,timeout:30000}).toString().trim();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const directory='docs/evidence/t25/checks/range-gesture-probe';await mkdir(directory,{recursive:true});
const origin='http://127.0.0.1:8299',url=origin+'/?probe='+Date.now();
const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Проверка ползунка T25</title><style>input,#button{position:absolute;left:20px;width:320px;height:50px}input{top:100px}#button{top:220px}</style><input id="range" type="range" min="0" max="2" value="0"><details><summary id="button">Проверка панели</summary><p>Содержимое</p></details><script>window.events=[];for(const type of ['pointerdown','pointerup','touchstart','touchend','input','change','click'])document.addEventListener(type,e=>events.push({type,id:e.target.id,value:e.target.value,x:e.clientX,y:e.clientY}),true);</script>`;
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);});
let forward,target,socket,reverse=false;const report={scope:'Native range event probe, physical Chrome/Android; no meteorological data or Compose'};
try{
    await new Promise((r,e)=>{server.once('error',e);server.listen(8299,'127.0.0.1',r);});
    run('reverse','--no-rebind','tcp:8299','tcp:8299');reverse=true;
    forward=run('forward','tcp:0','localabstract:chrome_devtools_remote');
    run('shell','am','start','-a','android.intent.action.VIEW','-d',url,'-p','com.android.chrome');
    for(let i=0;i<100;i++){const pages=await(await fetch(`http://127.0.0.1:${forward}/json/list`)).json();target=pages.find(p=>p.url===url);if(target)break;await delay(100);}
    assert.ok(target);const endpoint=new URL(target.webSocketDebuggerUrl);endpoint.hostname='127.0.0.1';endpoint.port=forward;
    socket=new WebSocket(endpoint);await new Promise((r,e)=>{socket.onopen=r;socket.onerror=e;});
    let next=0;const pending=new Map();socket.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
    const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>(await call('Runtime.evaluate',{expression,returnByValue:true})).result.value;
    await call('Page.bringToFront');await delay(300);
    report.browser=await call('Browser.getVersion');
    for(const id of ['range','button']){
        const p=await evaluate(`(()=>{const r=document.getElementById('${id}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
        await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});await delay(50);
        await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(300);
    }
    report.events=await evaluate('window.events');report.range_value=await evaluate("document.getElementById('range').value");
    assert.equal(report.range_value,'1');assert.ok(report.events.some(e=>e.type==='input'&&e.id==='range'));
    assert.ok(report.events.some(e=>e.type==='click'&&e.id==='button'));report.status='passed';
    report.followup=[];
    for(let index=0;index<8;index++){
        const targetValue=index%2===0?2:0;
        const r=await evaluate("(()=>{const e=document.getElementById('range'),r=e.getBoundingClientRect();return {left:r.left+8,width:r.width-16,y:r.top+r.height/2,value:Number(e.value)};})()");
        const start=r.left+r.width*r.value/2,end=r.left+r.width*targetValue/2;
        await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y:r.y,id:1}]});
        for(let step=1;step<=4;step++)await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start+(end-start)*step/4,y:r.y,id:1}]});
        await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        const before=await evaluate("events.filter(e=>e.id==='button'&&e.type==='click').length");
        await call('Input.synthesizeTapGesture',{x:180,y:245,duration:50,gestureSourceType:'touch'});await delay(500);
        const after=await evaluate("events.filter(e=>e.id==='button'&&e.type==='click').length");
        report.followup.push({targetValue,click_observed:after===before+1});
    }
    report.followup_events=await evaluate('events');
    assert.ok(report.followup.every(r=>r.click_observed),'Every summary tap after rapid native drag clicks');
}catch(error){report.status='failed';report.failure=String(error);process.exitCode=1;}
finally{
    socket?.close();const cleanup={};
    if(target){await fetch(`http://127.0.0.1:${forward}/json/close/${target.id}`);const pages=await(await fetch(`http://127.0.0.1:${forward}/json/list`)).json();assert.ok(!pages.some(p=>p.id===target.id));cleanup.tab_closed=true;}
    if(forward){run('forward','--remove','tcp:'+forward);cleanup.forward_removed=!run('forward','--list').includes('tcp:'+forward+' ');}
    if(reverse){run('reverse','--remove','tcp:8299');cleanup.reverse_removed=!run('reverse','--list').includes('tcp:8299 ');}
    await new Promise(r=>server.close(r));cleanup.server_closed=true;report.cleanup=cleanup;
    await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
