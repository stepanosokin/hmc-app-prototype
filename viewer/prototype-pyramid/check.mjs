// Observable desktop experiment, not production acceptance. Every attempt has a new report directory.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const origin=args.origin??'http://127.0.0.1:8158',browser=args.browser??'chrome';
const directory=resolve(args.report??'data/reports/pyramid79/dev01'),profile=join(directory,'profile');
assert.ok(directory.startsWith(resolve('data/reports/pyramid79')+sep));assert.ok(['chrome','edge'].includes(browser));
await mkdir(resolve('data/reports/pyramid79'),{recursive:true});await mkdir(directory);
const report={origin,browser,scope:'Prepared snapshot display experiment; full-grid point/series from original API',rows:[],errors:[],cleanup:{}};
const pause=ms=>new Promise(r=>setTimeout(r,ms));let child,socket,call;
try{
    const executable=browser==='edge'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'C:/Program Files/Google/Chrome/Application/chrome.exe';
    child=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
    let port;for(let i=0;i<100;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{}await pause(100);}assert.ok(port);
    const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((yes,no)=>{socket.onopen=yes;socket.onerror=no;});
    let id=0;const pending=new Map();
    socket.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.no(Error(JSON.stringify(m.error))):p.yes(m.result);}else if(m.method==='Runtime.exceptionThrown')report.errors.push(m.params.exceptionDetails);};
    call=(method,params={})=>new Promise((yes,no)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);no(Error('CDP timeout '+method));},20000);pending.set(n,{yes,no,timer});socket.send(JSON.stringify({id:n,method,params}));});
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const state=()=>evaluate('({state:window.captureWeatherEvidence?.(),prototype:window.pyramidApp?.metrics()})');
    async function ready(expected={}){
        let s,last='',stable=0;for(let i=0;i<1800;i++){
            s=await state();
            if(s.state?.time_state==='error'||s.state?.renderer_error||s.state?.contours?.state==='error')throw Error(JSON.stringify(s));
            if(s.state?.ready&&['ready','empty','missing'].includes(s.state.contours.state)&&
                (!expected.factor||s.prototype?.prototype?.factor===expected.factor)&&(!expected.field||s.state.displayed.field_short_name===expected.field)&&
                JSON.stringify(s.state.contours.native_grid?.shape_yx)===JSON.stringify(s.prototype.shape)&&!s.state.contours.worker_active){
                const key=JSON.stringify([s.state.displayed.selection,s.prototype.prototype.factor,s.state.view_geometry,s.state.contours.build_ms]);
                stable=key===last?stable+1:0;last=key;if(stable>=4)return s;
            }else stable=0;
            await pause(100);
        }throw Error('Карта не готова: '+JSON.stringify(s));
    }
    async function click(selector){
        const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
        for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...p});
    }
    async function select(selector,value){
        const idx=await evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});return [...s.options].findIndex(o=>o.value===${JSON.stringify(String(value))});})()`);assert.ok(idx>=0,'Select option '+value);
        await click(selector);
        for(const key of ['Home',...Array(idx).fill('ArrowDown'),'Enter'])for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:{Home:36,ArrowDown:40,Enter:13}[key]});
        await pause(300);
    }
    await call('Page.enable');await call('Runtime.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
    await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});report.viewport={width:1280,height:800,dpr:1};report.version=await call('Browser.getVersion');
    await call('Page.navigate',{url:origin+'/?validation=1&variant=1'});
    const initial=await ready();report.fields=initial.prototype.fields;
    await writeFile(join(directory,'initial.json'),JSON.stringify(initial,null,2));
    const fields=(args.fields??initial.state.displayed.field_short_name).split(',');
    for(const field of fields){
        await select('#pyramidField',field);await ready({field});
        const receipt=await evaluate(`fetch('/__pyramid/1/'+captureWeatherEvidence().displayed.selection+'/receipt.json').then(r=>r.json())`);
        if(args.baseline)assert.deepEqual(receipt,JSON.parse(await readFile(join(args.baseline,field+'-preparation.json'),'utf8')),'Fill inputs and block hashes unchanged from accepted pyramid');
        await writeFile(join(directory,field+'-preparation.json'),JSON.stringify(receipt,null,2));
        // Native values are requested by the unchanged PointSeries path; the map level is irrelevant.
        await evaluate('window.pyramidApp.pointAt(37.6173,55.7558)');
        let series;for(let i=0;i<1800;i++){series=await state();if(!series.state.series.busy)break;await pause(100);}
        assert.equal(series.state.series.busy,false);assert.ok(series.prototype.series.some(e=>e.state==='value'),'Real canonical values');
        const expectedSeries=series.prototype.series;report.series??={};report.series[field]=expectedSeries;
        const point=series.state.displayed;
        const query=new URLSearchParams({selection:point.selection,run:point.run,revision:point.revision,valid_time:point.valid_time,layer:point.field,lon:'37.6173',lat:'55.7558',crs:'http://www.opengis.net/def/crs/OGC/1.3/CRS84'});
        const directResponse=await fetch('http://127.0.0.1:8140/api/v1/point?'+query);assert.equal(directResponse.status,200);
        const direct=await directResponse.json();
        const entry=expectedSeries.find(e=>Date.parse(e.time)===Date.parse(point.valid_time));assert.ok(entry);assert.equal(entry.value,direct.value);assert.deepEqual(entry.cell,direct.cell);
        const chartShot=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,field+'-point-chart.png'),Buffer.from(chartShot.data,'base64'));
        await click('#pyramidHidePoint');
        for(const mode of (args.modes??'laea-rf').split(',')){
            await select('#projection',mode);await ready();await click('#pyramidOverview');await pause(200);const overview=await ready();
            assert.equal(overview.state.mode,mode,'Actual requested projection');
            for(const view of ['overview','zoom']){
                if(view==='zoom'){await click('#pyramidZoom');await click('#pyramidZoom');await pause(300);const zoomed=await ready();
                    assert.notDeepEqual(zoomed.state.view_geometry,overview.state.view_geometry,'Zoom must change geometry');
                    assert.ok(zoomed.state.map_zoom>overview.state.map_zoom,'Zoom increases map scale');}
                let geometry;
                for(const factor of [1,2,4,8]){
                    await select('#pyramidLevel',factor);await ready({factor,field});
                    // Warm prepared source, but new HTTP payload/decode/upload and new contour worker.
                    const start=performance.now();await click('#pyramidRepeat');await pause(100);
                    const result=await ready({factor,field});result.complete_ms=performance.now()-start;
                    assert.equal(result.state.contours.stats?.surface?.postprocess,'none; Float64 screen coordinates','Surface worker is active');
                    assert.deepEqual(result.prototype.series,expectedSeries,'Pyramid must not change/reload canonical series');
                    assert.equal(result.state.displayed.selection,point.selection);
                    assert.equal(result.state.mode,mode);
                    if(geometry)assert.deepEqual(result.state.view_geometry,geometry,'Same camera');else geometry=result.state.view_geometry;
                    const name=[field,mode,view,factor].join('-');
                    const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,name+'.png'),Buffer.from(shot.data,'base64'));
                    report.rows.push({name,field,mode,view,factor,selection:point.selection,complete_ms:result.complete_ms,
                        bytes:result.state.transfer_bytes,load_ms:result.state.load_ms,managed_bytes:result.state.managed_bytes,
                        contours:result.state.contours,upload:result.state.upload_timings,shape:result.prototype.shape,
                        geometry:result.state.view_geometry,actual_mode:result.state.mode,map_zoom:result.state.map_zoom});
                    console.log(JSON.stringify({name,bytes:result.state.transfer_bytes,load_ms:result.state.load_ms,contour_ms:result.state.contours.build_ms}));
                    await writeFile(join(directory,'progress.json'),JSON.stringify(report,null,2));
                }
            }
        }
    }
    // Delay a real block while the user immediately asks for another variant.
    const first=await evaluate('window.pyramidVariant===1?2:1');
    await evaluate(`(()=>{const fetch0=window.fetch;let once=true;window.fetch=async(...args)=>{if(once&&String(args[0]).endsWith('.f32')){once=false;await new Promise(r=>setTimeout(r,500));}return fetch0(...args);};window.restorePyramidFetch=()=>window.fetch=fetch0;const s=document.getElementById('pyramidLevel');s.value='${first}';s.dispatchEvent(new Event('change'));})()`);
    assert.equal(await evaluate('document.getElementById("pyramidLevel").disabled'),true);
    await evaluate(`(()=>{const s=document.getElementById('pyramidLevel');s.value='8';s.dispatchEvent(new Event('change'));})()`);
    await ready({factor:first});
    assert.equal(await evaluate('document.getElementById("pyramidLevel").value'),String(first));
    await evaluate('window.restorePyramidFetch()');report.rapid_selection='passed: delayed real block, disabled selector and matching displayed variant';
    // The legacy comparison is still available, but surface contours are the default.
    await select('#pyramidSurface','0');const legacy=await ready();assert.equal(legacy.state.contours.stats?.surface,undefined);
    await select('#pyramidSurface','1');const surface=await ready();assert.ok(surface.state.contours.stats.surface);
    assert.equal(surface.state.displayed.selection,legacy.state.displayed.selection);assert.equal(surface.state.transfer_bytes,legacy.state.transfer_bytes);
    assert.deepEqual(surface.prototype.series,legacy.prototype.series);report.surface_toggle='passed';
    report.runtime=await(await fetch(origin+'/__prototype/runtime.json')).json();
    assert.equal(report.errors.length,0,'No JS exceptions');report.status='passed';
}catch(e){report.status='failed';report.failure=e.message;process.exitCode=1;}
finally{
    try{
        if(call)try{await call('Page.navigate',{url:'about:blank'});await call('Browser.close');}catch{}socket?.close();
        if(child){for(let i=0;i<50&&child.exitCode===null;i++)await pause(100);if(child.exitCode===null)execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});}
        const count=execFileSync('powershell',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:HMC_PYRAMID_PROFILE) }).Count"],{encoding:'utf8',windowsHide:true,env:{...process.env,HMC_PYRAMID_PROFILE:profile}}).trim();
        assert.equal(count,'0');await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});report.cleanup={browser_processes_remaining:0,profile_removed:true,docker_resources_created:0,live_modified:false};
    }catch(e){report.cleanup={error:e.message};report.status='failed';process.exitCode=1;}
    await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,failure:report.failure?.slice(0,250),rows:report.rows.length,cleanup:report.cleanup}));
}
