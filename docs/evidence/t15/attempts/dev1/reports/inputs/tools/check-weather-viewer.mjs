// Drives the production viewer through visible controls against the real Compose gateway.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {checkNavigation} from './viewer-navigation.mjs';
import {checkUpdates} from './viewer-updates.mjs';
const directory=resolve(process.env.T13_REPORT_DIRECTORY||'data/reports/t13/browser-'+randomUUID());
assert.ok(directory.startsWith(resolve('data/reports')+sep));
const origin=process.env.T13_VIEWER||'http://127.0.0.1:8140';assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
const executable=process.env.T13_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const disabled=process.env.T13_DISABLE_GPU==='1',focused=process.env.T13_FOCUSED==='1';
const androidSerial=process.env.T13_ANDROID_SERIAL,android=Boolean(androidSerial),adb=process.env.T13_ADB;
if(android)assert.ok(adb&&!disabled,'Physical Android requires explicit ADB and enabled GPU');
const adbCall=(...args)=>execFileSync(adb,['-P','5041','-s',androidSerial,...args],{windowsHide:true,timeout:30000,maxBuffer:32*1024**2});
await mkdir(directory,{recursive:false});
const profile=join(directory,'profile'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={scope:'T13 production viewer, real Compose APIs and desktop GPU; mobile viewports are emulation',
    executable,starting_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),checks:[],viewports:[],requests:[],errors:[],cleanup:{}};
let child,socket,call,androidForward,androidTarget,androidReverse,uiDump,cleanupMode=false;
try{
    let port,pages;
    if(android){
        report.scope='T13 production viewer on physical Android/Chrome/GPU, real Compose APIs; no viewport emulation';
        const viewerPort=new URL(origin).port;
        adbCall('reverse','--no-rebind','tcp:'+viewerPort,'tcp:'+viewerPort);androidReverse=viewerPort;
        androidForward=adbCall('forward','tcp:0','localabstract:chrome_devtools_remote').toString().trim();port=androidForward;
        const start=origin+'/__start?session='+randomUUID();
        uiDump='/data/local/tmp/hmc-t13-'+randomUUID()+'.xml';
        adbCall('shell','input','keyevent','KEYCODE_WAKEUP');
        adbCall('shell','am','start','-a','android.intent.action.VIEW','-d',start,'-p','com.android.chrome');
        for(let i=0;i<100;i++){try{pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();androidTarget=pages.find(page=>page.type==='page'&&page.url===start);if(androidTarget)break;}catch{}await delay(100);}
        assert.ok(androidTarget,'Task Chrome tab started on Android');
        report.android={model:adbCall('shell','getprop','ro.product.model').toString().trim(),
            release:adbCall('shell','getprop','ro.build.version.release').toString().trim(),
            devpath:adbCall('get-devpath').toString().trim(),connection:process.env.T13_ANDROID_CONNECTION??'owner-provided device',adb_server_port:5041};
    }else{
    child=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',
        ...(disabled?['--disable-webgl']:[]),
        '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
    let launchError;child.on('error',error=>{launchError=error;});
    for(let i=0;i<100;i++){if(launchError)throw launchError;try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{}await delay(100);}
    assert.ok(port,'Browser debugging endpoint started');
    pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    }
    const endpoint=new URL((androidTarget??pages.find(page=>page.type==='page')).webSocketDebuggerUrl);
    endpoint.hostname='127.0.0.1';endpoint.port=String(port);socket=new WebSocket(endpoint);
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    let next=0;const pending=new Map();
    socket.onmessage=event=>{const message=JSON.parse(event.data),item=pending.get(message.id);
        if(item){pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(JSON.stringify(message.error))):item.resolve(message.result);}
        else if(message.method==='Runtime.exceptionThrown')report.errors.push(message.params.exceptionDetails);
        else if(message.method==='Network.requestWillBeSent')report.requests.push({url:message.params.request.url,headers:Object.keys(message.params.request.headers)});
    };
    call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},cleanupMode?5000:android?120000:30000);
        pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const value=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
        if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value;};
    const wait=async(expression,label)=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await delay(100);}throw Error('Timed out: '+label);};
    const click=async selector=>{
        const ancestors=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),ids=[];for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open&&e!==p.querySelector('summary'))ids.unshift(p.id);return ids;})()`);
        for(const id of ancestors)await click('#'+id+'>summary');
        const rect=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {x:r.x+r.width/2,y:r.y+r.height/2,hit:e.contains(hit),actual:hit?.outerHTML.slice(0,160)};})()`);
        assert.ok(rect.hit,'Control is visible: '+selector+' '+rect.actual);
        (report.control_inputs??=[]).push({selector,requested:{x:rect.x,y:rect.y}});
        const clickToken=randomUUID();
        if(android)await evaluate(`document.querySelector(${JSON.stringify(selector)}).addEventListener('click',()=>{window.__t13Clicked=${JSON.stringify(clickToken)};},{once:true})`);
        if(android){await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:Math.floor(rect.x)+.5,y:Math.floor(rect.y)+.5,id:1}]});
            await delay(50);
            await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
            await wait(`window.__t13Clicked===${JSON.stringify(clickToken)}`,'trusted Android click: '+selector);
        }
        else{await call('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',clickCount:1});
            await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x,y:rect.y,button:'left',clickCount:1});}await delay(100);
    };
    const select=async(selector,home,arrows)=>{
        const labels=android?await evaluate(`[...document.querySelector(${JSON.stringify(selector)}).options].map(option=>option.textContent)`):null;
        await click(selector);
        if(android){
            adbCall('shell','uiautomator','dump',uiDump);
            const xml=adbCall('shell','cat',uiDump).toString('utf8'),wanted=labels[home?arrows:labels.length-1];
            const nodes=[...xml.matchAll(/<node\b[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)];
            const match=nodes.find(node=>node[1].replaceAll('&amp;','&').replaceAll('&quot;','"')===wanted);
            assert.ok(match,'Native Android option visible: '+wanted);
            adbCall('shell','input','tap',String(Math.round((Number(match[2])+Number(match[4]))/2)),String(Math.round((Number(match[3])+Number(match[5]))/2)));
            await delay(150);return;
        }
        for(const key of [home?'Home':'End',...Array(arrows).fill('ArrowDown'),'Enter']){
            await call('Input.dispatchKeyEvent',{type:'keyDown',key});await call('Input.dispatchKeyEvent',{type:'keyUp',key});}
        await delay(150);
    };
    const check=async(label,expression)=>{assert.equal(await evaluate(expression),true,label);report.checks.push(label);};
    const capture=(samples=false)=>evaluate(`window.captureWeatherEvidence(${samples})`);
    await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
    report.browser=await call('Browser.getVersion');
    if(android){await call('Page.bringToFront');report.user_agent=await evaluate('navigator.userAgent');report.device_pixel_ratio=await evaluate('devicePixelRatio');}
    report.configuration={gpu_disabled:disabled,focused};
    const sizes=android?[await evaluate('[innerWidth,innerHeight,true]')]:focused||disabled?[[1440,900,false]]:[[1440,900,false],[390,844,true],[360,740,true],[640,360,true]];
    for(const [width,height,mobile] of sizes){
        if(!android)await call('Emulation.setDeviceMetricsOverride',{width,height,mobile,deviceScaleFactor:1});
        await call('Page.navigate',{url:origin+'/?validation=1'});
        if(disabled){
            await wait("document.getElementById('projectionStatus').textContent.includes('Режим недоступен')",'GPU unavailable reason');
            await check('Russian unavailable renderer with explicit Mercator',"!document.getElementById('useMercator').hidden&&document.getElementById('projection').value==='mercator'");
            const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,'unavailable.png'),Buffer.from(shot.data,'base64'));
            continue;
        }
        await wait("typeof window.captureWeatherEvidence==='function' && window.captureWeatherEvidence().ready&&window.captureWeatherEvidence().first_complete_ms!=null",'initial complete GPU field');
        report.gpu=await evaluate("(()=>{const gl=document.querySelector('.maplibregl-canvas').getContext('webgl2'),debug=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER),version:gl.getParameter(gl.VERSION),highp_precision:gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT).precision,max_texture_size:gl.getParameter(gl.MAX_TEXTURE_SIZE),max_array_layers:gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)};})()");
        if(android){
            await wait("document.visibilityState==='visible'",'unlocked visible Galaxy tab');
            await evaluate("window.__t13Inputs=[];for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,event=>{window.__t13Inputs.push({type,id:event.target.id,tag:event.target.tagName,x:event.clientX,y:event.clientY});if(window.__t13Inputs.length>80)window.__t13Inputs.shift();},true)");
        }
        const viewport={width,height,mobile_emulation:mobile&&!android,physical_mobile:android,views:[],canonical_picks:[]};report.viewports.push(viewport);
        if(process.env.T15_UPDATES_ONLY==='1'){
            await checkUpdates({call,evaluate,wait,select,click,capture,origin,report});break;
        }
        if(process.env.T14_NAVIGATION_ONLY==='1'){
            assert.equal(process.env.T14_NAVIGATION,'1');
            await checkNavigation({call,evaluate,wait,select,click,capture,origin,report});
            const shot=await call('Page.captureScreenshot',{format:'png'});
            await writeFile(join(directory,'navigation.png'),Buffer.from(shot.data,'base64'));
            continue;
        }
        viewport.first_show_ms=(await capture()).first_complete_ms;
        await check('Opening starts in Mercator',"document.getElementById('projection').value==='mercator'");
        await check('Russian surface label and UTC',"document.querySelector('h1').textContent==='Температура поверхности'&&document.getElementById('valid').textContent.includes('UTC')");
        await check('Russian accessible map label',"document.querySelector('.maplibregl-canvas').getAttribute('aria-label').startsWith('Карта прогноза')");
        if(mobile)await check('Mobile groups initially collapsed',"['forecastPanel','navigationPanel','legendPanel','timelinePanel'].every(id=>!document.getElementById(id).open)");
        const originalSelection=(await capture()).selected.selection;
        if(width===1440){
            await evaluate("(()=>{const canvas=document.querySelector('.maplibregl-canvas'),extension=canvas.getContext('webgl2').getExtension('WEBGL_lose_context');window.__t13Context=extension;extension.loseContext();})()");
            await wait('window.captureWeatherEvidence().context_lost','context lost');
            await select('#projection',true,1);
            await evaluate('window.__t13Context.restoreContext();delete window.__t13Context');
            await wait('window.captureWeatherEvidence().ready&&!window.captureWeatherEvidence().context_lost','restored GPU');
            assert.equal((await capture()).selected.selection,originalSelection,'Context recovery keeps selection');
            await select('#projection',true,0);
            await wait("window.captureWeatherEvidence().ready&&window.captureWeatherEvidence().mode==='mercator'",'Mercator after recovery');
            report.checks.push('Real WebGL context loss, projection change and restoration');
        }
        for(const [mode,offset] of [['mercator',0],['orthographic',1],['laea',2]]){
            if(mode!=='mercator')await select('#projection',true,offset);
            await wait(`window.captureWeatherEvidence().mode===${JSON.stringify(mode)}&&window.captureWeatherEvidence().ready`,'mode '+mode);
            await check('One local basemap canvas after '+mode,"document.querySelectorAll('canvas[data-role=local-basemap]').length<2");
            if(mobile)await click('#forecastPanel>summary');
            await click('#fit');
            if(mobile)await click('#navigationPanel>summary');
            await delay(200);
            const frame=await capture(true);assert.equal(frame.selected.selection,originalSelection);
            viewport.views.push({...frame.view,synthetic_masks:frame.synthetic_masks});
            (viewport.measurements??=[]).push({mode,transfer_bytes:frame.transfer_bytes,managed_bytes:frame.managed_bytes,
                load_ms:frame.load_ms,warm_switch_ms:frame.warm_switch_ms,upload_timings:frame.upload_timings});
            assert.ok(frame.managed_bytes<=128*1024**2);assert.ok(frame.transfer_bytes<=8*1024**2);
            const target=await evaluate("(()=>{const r=[...document.querySelectorAll('.mapLabel')].find(e=>e.textContent.includes('Москва')).getBoundingClientRect();return {x:r.x+3,y:r.y+3};})()");
            const pointRequests=report.requests.filter(item=>item.url.includes('/api/v1/point?')).length;
            if(android){await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:Math.floor(target.x)+.5,y:Math.floor(target.y)+.5,id:1}]});
                await delay(50);await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
            else{await call('Input.dispatchMouseEvent',{type:'mousePressed',...target,button:'left',clickCount:1});
                await call('Input.dispatchMouseEvent',{type:'mouseReleased',...target,button:'left',clickCount:1});}
            for(let i=0;i<100&&report.requests.filter(item=>item.url.includes('/api/v1/point?')).length===pointRequests;i++)await delay(50);
            assert.ok(report.requests.filter(item=>item.url.includes('/api/v1/point?')).length>pointRequests,'Visible click starts a canonical API request');
            await wait('Boolean(window.captureWeatherEvidence().point)','canonical click');
            const picked=await capture();assert.equal(picked.point.spatial_selection,'nearest-native-cell');
            viewport.canonical_picks.push({mode,point:picked.point,position:picked.position,view:picked.screen_pick});
            if(mobile){const cardShot=await call('Page.captureScreenshot',{format:'png'});
                await writeFile(join(directory,`${width}x${height}-${mode}-point.png`),Buffer.from(cardShot.data,'base64'));}
            if(mobile)await click('#closeDrawer');
            const shot=await call('Page.captureScreenshot',{format:'png'});
            await writeFile(join(directory,`${width}x${height}-${mode}.png`),Buffer.from(shot.data,'base64'));
            if(android)await writeFile(join(directory,`physical-${mode}.png`),adbCall('exec-out','screencap','-p'));
            if(width===1440||width===360){
                for(const font of [0,1])for(const basemap of [0,1]){
                    await select('#font',true,font);await select('#basemap',true,basemap);
                    const variant=await call('Page.captureScreenshot',{format:'png'});
                    await writeFile(join(directory,`${width}x${height}-${mode}-font${font}-basemap${basemap}.png`),Buffer.from(variant.data,'base64'));
                }
                await select('#font',true,0);await select('#basemap',true,0);
            }
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
        const dragStart=await evaluate('performance.now()');
        if(android)await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:sx,y:sy,id:1}]});
        else await call('Input.dispatchMouseEvent',{type:'mousePressed',x:sx,y:sy,button:'left',clickCount:1});
        for(let i=1;i<=20;i++){
            if(android)await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:sx-i*3,y:sy,id:1}]});
            else await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:sx-i*3,y:sy,button:'left',buttons:1});await delay(8);}
        const duringDrag=await capture(true);assert.notDeepEqual(duringDrag.view.center,beforeDrag.view.center,'Continuous globe rotation');
        const times=duringDrag.render_times_ms.filter(t=>t>=dragStart),intervals=times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b);
        assert.ok(intervals.length>=5,'Multiple actual render events during trusted drag');
        viewport.trusted_drag_frame_p95_ms=intervals[Math.floor(intervals.length*.95)];
        viewport.frame_scope=android?'Map render intervals during trusted touch on physical Android':'Map render intervals during trusted desktop mouse input; emulated mobile uses desktop GPU';
        if(android)await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        else await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:sx-60,y:sy,button:'left',clickCount:1});
        await delay(1000);viewport.views.push((await capture(true)).view);
        if(android){
            const beforePinch=(await capture(true)).view,x=width*.5,y=height*.45;
            await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-25,y,id:1},{x:x+25,y,id:2}]});
            for(let i=1;i<=12;i++){
                await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-25-i*2,y,id:1},{x:x+25+i*2,y,id:2}]});await delay(8);
            }
            await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(250);
            const afterPinch=(await capture(true)).view;
            assert.ok(afterPinch.scale>beforePinch.scale*1.1,'Physical pinch zooms the globe');
            assert.deepEqual(afterPinch.center,beforePinch.center,'Pinch keeps orthographic centre');
            viewport.views.push(afterPinch);viewport.pinch={scale_before:beforePinch.scale,scale_after:afterPinch.scale,centre_preserved:true};
        }
        viewport.transfer_bytes=(await capture()).transfer_bytes;viewport.heap=await call('Runtime.getHeapUsage');
        report.checks.push(`${width}x${height}: three modes, canonical clicks, palette reuse, missing time, continuous rotation`);
        if(process.env.T14_NAVIGATION==='1'&&width===1440&&!android){
            await checkNavigation({call,evaluate,wait,select,click,capture,origin,report});
            const shot=await call('Page.captureScreenshot',{format:'png'});
            await writeFile(join(directory,'navigation.png'),Buffer.from(shot.data,'base64'));
        }
    }
    assert.equal(report.errors.length,0,'No uncaught browser errors');
    assert.ok(report.requests.filter(r=>/^https?:/.test(r.url)).every(r=>r.url.startsWith(origin+'/')),'Runtime is local');
    assert.ok(report.requests.every(r=>!r.headers.some(h=>/authorization|x-api-key/i.test(h))),'No organization secrets');
    report.status='passed';
}catch(error){report.status='failed';report.failure=String(error);process.exitCode=1;
    if(call)try{report.failure_inputs=(await call('Runtime.evaluate',{expression:'({events:window.__t13Inputs,viewport:{width:innerWidth,height:innerHeight,scale:visualViewport.scale,offsetTop:visualViewport.offsetTop},visibility:document.visibilityState})',returnByValue:true})).result.value;
        report.failure_dom=(await call('Runtime.evaluate',{expression:'document.body.innerText',returnByValue:true})).result.value;
        const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,'failure.png'),Buffer.from(shot.data,'base64'));}catch{}
}finally{
    cleanupMode=true;const errors=[],steps={};
    const clean=async(name,operation)=>{try{await operation();steps[name]=true;}catch(error){steps[name]=false;errors.push(name+': '+String(error));}};
    await clean('page_released',async()=>{
        try{if(socket?.readyState===WebSocket.OPEN)await call('Page.navigate',{url:'about:blank'});}finally{socket?.close();}
    });
    if(android){
        await clean('test_tab_closed',async()=>{
            if(!androidTarget)return;
            const response=await fetch(`http://127.0.0.1:${androidForward}/json/close/${encodeURIComponent(androidTarget.id)}`,{signal:AbortSignal.timeout(5000)});
            assert.ok(response.ok);
            let pages;
            for(let i=0;i<30;i++){
                pages=await(await fetch(`http://127.0.0.1:${androidForward}/json/list`,{signal:AbortSignal.timeout(5000)})).json();
                if(!pages.some(page=>page.id===androidTarget.id))break;await delay(100);
            }
            assert.ok(!pages.some(page=>page.id===androidTarget.id));
        });
        await clean('adb_forward_removed',async()=>{if(androidForward){adbCall('forward','--remove','tcp:'+androidForward);
            assert.ok(!adbCall('forward','--list').toString().includes('tcp:'+androidForward+' '));}});
        await clean('adb_reverse_removed',async()=>{if(androidReverse){adbCall('reverse','--remove','tcp:'+androidReverse);
            assert.ok(!adbCall('reverse','--list').toString().includes('tcp:'+androidReverse+' '));}});
        await clean('ui_dump_removed',async()=>{if(uiDump){adbCall('shell','rm','-f',uiDump);adbCall('shell','test','!','-e',uiDump);}});
        report.cleanup={...steps,user_chrome_retained:true};
    }else{
        await clean('browser_stopped',async()=>{
        if(child?.pid){await delay(500);if(child.exitCode===null)execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});}
        const remaining=execFileSync('powershell',['-NoProfile','-Command',
            "@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:T13_PROFILE) }).Count"],
            {encoding:'utf8',env:{...process.env,T13_PROFILE:profile},windowsHide:true}).trim();
        assert.equal(remaining,'0');
        });
        await clean('profile_removed',()=>rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200}));
        report.cleanup={...steps,browser_processes_remaining:steps.browser_stopped?0:null};
    }
    if(errors.length){report.cleanup.errors=errors;report.status='failed';process.exitCode=1;}
    await writeFile(join(directory,'browser.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({directory,status:report.status,failure:report.failure,cleanup:report.cleanup}));
}
