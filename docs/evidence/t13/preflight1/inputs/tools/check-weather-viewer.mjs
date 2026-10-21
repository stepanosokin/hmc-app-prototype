// Drives the production viewer through visible controls against the real Compose gateway.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
const directory=resolve(process.env.T13_REPORT_DIRECTORY||'data/reports/t13/browser-'+randomUUID());
assert.ok(directory.startsWith(resolve('data/reports')+sep));
const origin=process.env.T13_VIEWER||'http://127.0.0.1:8140';assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
const executable=process.env.T13_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe';
await mkdir(directory,{recursive:false});
const profile=join(directory,'profile'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={scope:'T13 production viewer, real Compose APIs and desktop GPU; mobile viewports are emulation',
    executable,starting_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),checks:[],viewports:[],requests:[],errors:[],cleanup:{}};
let child,socket,call;
try{
    child=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',
        '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
    let launchError;child.on('error',error=>{launchError=error;});
    let port;
    for(let i=0;i<100;i++){if(launchError)throw launchError;try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{}await delay(100);}
    assert.ok(port,'Browser debugging endpoint started');
    const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    let next=0;const pending=new Map();
    socket.onmessage=event=>{const message=JSON.parse(event.data),item=pending.get(message.id);
        if(item){pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(JSON.stringify(message.error))):item.resolve(message.result);}
        else if(message.method==='Runtime.exceptionThrown')report.errors.push(message.params.exceptionDetails);
        else if(message.method==='Network.requestWillBeSent')report.requests.push({url:message.params.request.url,headers:Object.keys(message.params.request.headers)});
    };
    call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},30000);
        pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const value=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
        if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value;};
    const wait=async(expression,label)=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await delay(100);}throw Error('Timed out: '+label);};
    const click=async selector=>{
        const ancestors=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),ids=[];for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open&&e!==p.querySelector('summary'))ids.unshift(p.id);return ids;})()`);
        for(const id of ancestors)await click('#'+id+'>summary');
        const rect=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {x:r.x+r.width/2,y:r.y+r.height/2,hit:e.contains(hit),actual:hit?.outerHTML.slice(0,160)};})()`);
        assert.ok(rect.hit,'Control is visible: '+selector+' '+rect.actual);
        await call('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',clickCount:1});
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x,y:rect.y,button:'left',clickCount:1});await delay(100);
    };
    const select=async(selector,home,arrows)=>{
        await click(selector);
        for(const key of [home?'Home':'End',...Array(arrows).fill('ArrowDown'),'Enter']){
            await call('Input.dispatchKeyEvent',{type:'keyDown',key});await call('Input.dispatchKeyEvent',{type:'keyUp',key});}
        await delay(150);
    };
    const check=async(label,expression)=>{assert.equal(await evaluate(expression),true,label);report.checks.push(label);};
    const capture=(samples=false)=>evaluate(`window.captureWeatherEvidence(${samples})`);
    await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
    for(const [width,height,mobile] of [[1440,900,false],[390,844,true],[640,360,true]]){
        await call('Emulation.setDeviceMetricsOverride',{width,height,mobile,deviceScaleFactor:1});
        await call('Page.navigate',{url:origin+'/?validation=1'});
        await wait("typeof window.captureWeatherEvidence==='function' && window.captureWeatherEvidence().ready",'initial GPU field');
        const viewport={width,height,mobile_emulation:mobile,views:[],canonical_picks:[]};report.viewports.push(viewport);
        viewport.first_show_ms=(await capture()).first_complete_ms;
        await check('Opening starts in Mercator',"document.getElementById('projection').value==='mercator'");
        await check('Russian surface label and UTC',"document.querySelector('h1').textContent==='Температура поверхности'&&document.getElementById('valid').textContent.includes('UTC')");
        if(mobile)await check('Mobile groups initially collapsed',"['forecastPanel','navigationPanel','legendPanel','timelinePanel'].every(id=>!document.getElementById(id).open)");
        const originalSelection=(await capture()).selected.selection;
        if(width===1440){
            await evaluate("(()=>{const canvas=document.querySelector('.maplibregl-canvas'),extension=canvas.getContext('webgl2').getExtension('WEBGL_lose_context');window.__t13Context=extension;extension.loseContext();})()");
            await wait('window.captureWeatherEvidence().context_lost','context lost');
            await evaluate('window.__t13Context.restoreContext();delete window.__t13Context');
            await wait('window.captureWeatherEvidence().ready&&!window.captureWeatherEvidence().context_lost','restored GPU');
            assert.equal((await capture()).selected.selection,originalSelection,'Context recovery keeps selection');
            report.checks.push('Real WebGL context loss and restoration');
        }
        for(const [mode,offset] of [['mercator',0],['orthographic',1],['laea',2]]){
            if(mode!=='mercator')await select('#projection',true,offset);
            await wait(`window.captureWeatherEvidence().mode===${JSON.stringify(mode)}&&window.captureWeatherEvidence().ready`,'mode '+mode);
            if(mobile)await click('#forecastPanel>summary');
            await click('#fit');
            if(mobile)await click('#navigationPanel>summary');
            await delay(200);
            const frame=await capture(true);assert.equal(frame.selected.selection,originalSelection);
            viewport.views.push({...frame.view,synthetic_masks:frame.synthetic_masks});
            assert.ok(frame.managed_bytes<=128*1024**2);assert.ok(frame.transfer_bytes<=8*1024**2);
            const target=await evaluate("(()=>{const r=[...document.querySelectorAll('.mapLabel')].find(e=>e.textContent.includes('Москва')).getBoundingClientRect();return {x:r.x+3,y:r.y+3};})()");
            await call('Input.dispatchMouseEvent',{type:'mousePressed',...target,button:'left',clickCount:1});
            await call('Input.dispatchMouseEvent',{type:'mouseReleased',...target,button:'left',clickCount:1});
            await wait('Boolean(window.captureWeatherEvidence().point)','canonical click');
            const picked=await capture();assert.equal(picked.point.spatial_selection,'nearest-native-cell');
            viewport.canonical_picks.push({mode,point:picked.point,position:picked.position});
            if(mobile)await click('#closeDrawer');
            const shot=await call('Page.captureScreenshot',{format:'png'});
            await writeFile(join(directory,`${width}x${height}-${mode}.png`),Buffer.from(shot.data,'base64'));
        }
        const before=report.requests.filter(r=>r.url.includes('/native/')).length;
        await click('#settings');await select('#units',false,0);await select('#palette',false,0);
        await check('Kelvin conversion in legend',"document.getElementById('legendSummary').textContent.includes('K')");
        assert.equal(report.requests.filter(r=>r.url.includes('/native/')).length,before,'Palette and units reuse native blocks');
        await click('#closeDrawer');
        await select('#time',true,1);
        await check('Missing time hides stale point and field',"document.getElementById('notice').textContent.includes('срок отсутствует')&&!window.captureWeatherEvidence().point&&!window.captureWeatherEvidence().ready");
        await select('#time',true,0);
        await wait('window.captureWeatherEvidence().ready','restored available time');
        await select('#projection',true,1);
        await wait("window.captureWeatherEvidence().mode==='orthographic'&&window.captureWeatherEvidence().ready",'globe');
        if(mobile)await click('#forecastPanel>summary');
        // Real mouse drag; the renderer must keep updating before pointerup.
        const beforeDrag=await capture(true);const sx=width*.6,sy=height*.48;
        await call('Input.dispatchMouseEvent',{type:'mousePressed',x:sx,y:sy,button:'left',clickCount:1});
        for(let i=1;i<=12;i++){await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:sx-i*3,y:sy,button:'left',buttons:1});await delay(17);}
        const duringDrag=await capture(true);assert.notDeepEqual(duringDrag.view.center,beforeDrag.view.center,'Continuous globe rotation');
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:sx-36,y:sy,button:'left',clickCount:1});
        await delay(1000);viewport.views.push((await capture(true)).view);
        viewport.transfer_bytes=(await capture()).transfer_bytes;viewport.heap=await call('Runtime.getHeapUsage');
        report.checks.push(`${width}x${height}: three modes, canonical clicks, palette reuse, missing time, continuous rotation`);
    }
    assert.equal(report.errors.length,0,'No uncaught browser errors');
    assert.ok(report.requests.filter(r=>/^https?:/.test(r.url)).every(r=>r.url.startsWith(origin+'/')),'Runtime is local');
    assert.ok(report.requests.every(r=>!r.headers.some(h=>/authorization|x-api-key/i.test(h))),'No organization secrets');
    report.status='passed';
}catch(error){report.status='failed';report.failure=String(error);process.exitCode=1;
    if(call)try{report.failure_dom=(await call('Runtime.evaluate',{expression:'document.body.innerText',returnByValue:true})).result.value;
        const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,'failure.png'),Buffer.from(shot.data,'base64'));}catch{}
}finally{
    try{
        if(socket?.readyState===WebSocket.OPEN){await call('Page.navigate',{url:'about:blank'});socket.close();}
        if(child?.pid){await delay(500);if(child.exitCode===null)execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});}
        const remaining=execFileSync('powershell',['-NoProfile','-Command',
            "@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:T13_PROFILE) }).Count"],
            {encoding:'utf8',env:{...process.env,T13_PROFILE:profile},windowsHide:true}).trim();
        assert.equal(remaining,'0');
        await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
        report.cleanup={browser_processes_remaining:0,profile_removed:true};
    }catch(error){report.cleanup.error=String(error);report.status='failed';process.exitCode=1;}
    await writeFile(join(directory,'browser.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({directory,status:report.status,failure:report.failure,cleanup:report.cleanup}));
}
