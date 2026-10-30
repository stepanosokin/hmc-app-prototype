// Isolated frozen viewer, read-only proxy to immutable real publications.
// Does not rebuild or modify the user's running viewer, database or volumes.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,readdir,mkdir,rm} from 'node:fs/promises';
import {resolve,join,dirname,sep,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {nativePointPixel} from './viewer-fields.mjs';
import {restrictRuntimeNetwork} from './viewer-network.mjs';


const directory=resolve(process.argv[2]),browser=process.argv[3]??'chrome';
assert.ok(['chrome','edge'].includes(browser));
const focused=process.argv.includes('--focused'),started=performance.now();
let browserStarted=0,checksStarted=0,checksEnded=0;
assert.ok(directory.startsWith(resolve('data/reports/contours74')+sep));
const gateway=process.env.HMC_WIND_GATEWAY??'http://127.0.0.1:8140';
assert.match(gateway,/^http:\/\/127\.0\.0\.1:\d+$/);
const executable=browser==='edge'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'C:/Program Files/Google/Chrome/Application/chrome.exe';
await mkdir(directory,{recursive:false});
const report={scope:'Native contours #74: frozen viewer and real published APIs; emulation is not physical Android',
    browser,gateway,starting_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),checks:[],inputs:{},errors:[],screenshots:[],states:[],requests:[],cleanup:{}};
const sha=b=>createHash('sha256').update(b).digest('hex');
const freeze=async(source,target)=>{const bytes=await readFile(source);report.inputs[source]=sha(bytes);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);};
for(const entry of await readdir('viewer',{withFileTypes:true}))if(entry.isFile()&&/\.(?:ts|js|json|css|html|mjs)$/.test(entry.name))
    await freeze('viewer/'+entry.name,join(directory,'inputs/viewer',entry.name));
for(const path of ['tools/check-contours.mjs','tools/viewer-fields.mjs','tools/viewer-network.mjs','tools/check-contour-reference.py','tools/check-contour-reference.mjs'])await freeze(path,join(directory,'inputs',path));
await freeze('tests/fixtures/wind/rotated-reference.json',join(directory,'inputs/tests/fixtures/wind/rotated-reference.json'));
const build=join(directory,'site/build');
const profile=join(directory,'profile'),pause=ms=>new Promise(r=>setTimeout(r,ms));
let child,socket,call,server;
try{
    const result=execFileSync(process.execPath,['viewer/node_modules/typescript/bin/tsc','-p',join(directory,'inputs/viewer/tsconfig.json'),'--outDir',build],{encoding:'utf8',windowsHide:true});
    await writeFile(join(directory,'compile.log'),result);
    const catalogueBytes=Buffer.from(await(await fetch(gateway+'/api/v1/catalogue?view=compact')).arrayBuffer());
    const catalogue=JSON.parse(catalogueBytes);await writeFile(join(directory,'catalogue.json'),catalogueBytes);
    const targetModel=catalogue.templates.find(t=>t.field_short_name==='sp')?.model;assert.ok(targetModel,'Actual publication includes pressure');
    const served=new Map(),apiCache=new Map(),apiPending=new Map();let nextRead=0,upstream=Promise.resolve();
    report.test_cache={scope:'Immutable successful GET responses, per attempt; no production cache or policy changes',minimum_upstream_interval_ms:150,maximum_upstream_concurrency:1};
    server=createServer(async(req,res)=>{try{
        if(req.method!=='GET'){res.writeHead(405);res.end();return;}
        const url=new URL(req.url,'http://127.0.0.1');
        if(url.pathname==='/api/v1/catalogue'){res.setHeader('Content-Type','application/json');res.end(catalogueBytes);return;}
        if(/^\/(?:api\/v1|ogc)\//.test(url.pathname)){
            let value=apiCache.get(req.url),cacheHit=Boolean(value);
            if(!value){
                let pending=apiPending.get(req.url);
                if(pending)cacheHit=true;
                else{
                    pending=upstream.then(async()=>{
                        const delay=Math.max(0,nextRead-performance.now());if(delay)await pause(delay);nextRead=performance.now()+150;
                        const response=await fetch(gateway+req.url,{signal:AbortSignal.timeout(20000)}),bytes=Buffer.from(await response.arrayBuffer());
                        const item={status:response.status,type:response.headers.get('Content-Type')??'application/octet-stream',bytes};
                        if(response.status===200)apiCache.set(req.url,item);return item;
                    });
                    upstream=pending.then(()=>{},()=>{});apiPending.set(req.url,pending);
                }
                try{value=await pending;}finally{apiPending.delete(req.url);}
            }
            report.requests.push({path:req.url,status:value.status,bytes:value.bytes.length,sha256:sha(value.bytes),cache_hit:cacheHit,...(value.status!==200?{error:value.bytes.toString('utf8').slice(0,512)}:{})});
            res.writeHead(value.status,{'Content-Type':value.type});res.end(value.bytes);return;
        }
        let path=url.pathname==='/wind-reference.json'?join(directory,'inputs/tests/fixtures/wind/rotated-reference.json'):
            url.pathname==='/'?join(directory,'inputs/viewer/index.html'):url.pathname==='/style.css'?join(directory,'inputs/viewer/style.css'):
            /^\/[a-z-]+\.mjs$/.test(url.pathname)?join(directory,'inputs/viewer',url.pathname.slice(1)):
            url.pathname==='/land.js'?resolve('docs/prototypes/assets/land.js'):url.pathname.startsWith('/build/')?resolve(build,'.'+url.pathname.slice(6)):
            url.pathname.startsWith('/vendor/')?resolve('data/viewer','.'+url.pathname):undefined;
        if(!path||![directory+sep,resolve('data/viewer')+sep,resolve('docs/prototypes/assets')+sep].some(root=>path.startsWith(root))){res.writeHead(404);res.end();return;}
        let bytes=served.get(path);
        if(!bytes){bytes=await readFile(path);served.set(path,bytes);if(!path.startsWith(directory+sep))await freeze(path,join(directory,'served-inputs',path.slice(resolve('.').length+1)));}
        res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.json':'application/json'})[extname(path)]??'application/octet-stream');res.end(bytes);
    }catch(error){res.writeHead(502);res.end('Ошибка тестового прокси');report.errors.push(String(error));}});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
    report.test_origin=origin;
    browserStarted=performance.now();
    child=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
    let port;for(let i=0;i<100;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{}await pause(100);}assert.ok(port,'CDP started');
    const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
    await new Promise((res,rej)=>{socket.onopen=res;socket.onerror=rej;});let id=0;const pending=new Map();
    let network;
    socket.onmessage=e=>{const m=JSON.parse(e.data);network?.event(m);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')report.errors.push(m.params.exceptionDetails);};
    call=(method,params={})=>new Promise((res,rej)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);rej(Error('CDP timeout '+method));},20000);pending.set(n,{resolve:res,reject:rej,timer});socket.send(JSON.stringify({id:n,method,params}));});
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const wait=async(expression,name)=>{console.log(JSON.stringify({phase:name}));for(let i=0;i<450;i++){if(await evaluate(expression))return;await pause(100);}throw Error('Timeout: '+name);};
    const check=async(name,expression)=>{assert.equal(await evaluate(expression),true,name);report.checks.push(name);};
    const click=async selector=>{const b=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...b});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...b});};
    const select=async(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const snapshot=()=>evaluate('captureWeatherEvidence()');
    const capture=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,name+'.png'),Buffer.from(r.data,'base64'));report.screenshots.push(name+'.png');
        const state=await snapshot(),metrics=await call('Performance.getMetrics');
        report.states.push({name,...state,performance:Object.fromEntries(metrics.metrics.filter(m=>['JSHeapUsedSize','JSHeapTotalSize','TaskDuration'].includes(m.name)).map(m=>[m.name,m.value])),
            ui:await evaluate("({legend:document.getElementById('legendPanel').innerText,points:[...document.querySelectorAll('.pointValue,.realPointChart output')].map(e=>e.textContent),probe:window.__contourProbe})")});};
    await call('Page.enable');await call('Runtime.enable');report.version=await call('Browser.getVersion');
    network=await restrictRuntimeNetwork(call,origin,report);await network.start();
    report.network.probes=await evaluate(`(async()=>{
        const page=await fetch('https://hmc-runtime-check.invalid/page').then(()=>false,()=>true);
        const worker=await new Promise((resolve,reject)=>{
            const url=URL.createObjectURL(new Blob([\`(async()=>{
                const direct=await fetch('https://hmc-runtime-check.invalid/worker').then(()=>false,()=>true);
                const url=URL.createObjectURL(new Blob(["fetch('https://hmc-runtime-check.invalid/nested-worker').then(()=>postMessage(false),()=>postMessage(true))"],{type:'text/javascript'}));
                const nested=new Worker(url);nested.onmessage=e=>{nested.terminate();URL.revokeObjectURL(url);postMessage(direct&&e.data);};
            })()\`],{type:'text/javascript'}));
            const worker=new Worker(url);worker.onmessage=e=>{worker.terminate();URL.revokeObjectURL(url);resolve(e.data);};worker.onerror=reject;
        });return {page,worker};})()`);
    assert.deepEqual(report.network.probes,{page:true,worker:true});
    checksStarted=performance.now();
    await call('Performance.enable');
    await call('Page.addScriptToEvaluateOnNewDocument',{source:`{
        window.__contourProbe={gap:0,peak_managed_bytes:0,worker_frames:0};let last,sampled=0;
        function frame(t){if(last!==undefined)window.__contourProbe.gap=Math.max(window.__contourProbe.gap,t-last);last=t;
            if(t-sampled>100){sampled=t;const s=window.captureWeatherEvidence?.();if(s){window.__contourProbe.peak_managed_bytes=Math.max(window.__contourProbe.peak_managed_bytes,s.managed_bytes||0);if(s.contours.worker_active)window.__contourProbe.worker_frames++;}}
            requestAnimationFrame(frame);}requestAnimationFrame(frame);
        const Original=window.Worker;window.Worker=class extends Original{constructor(url,options){if(window.__contourFail&&String(url).includes('contour-worker'))throw Error('Test worker allocation fault');super(url,options);}};
    }`});

    const settled=async(name)=>{
        await wait("(()=>{const s=captureWeatherEvidence(),c=s.contours,mode={mercator:'mercator',orthographic:'hmc:orthographic',laea:'EPSG:3576','laea-rf':'hmc:laea-rf'}[s.mode];return c.view?.mode===mode&&(c.state==='error'||['ready','empty'].includes(c.state)&&!c.worker_active&&c.curves!==undefined);})()",name);
        const s=await snapshot();assert.ok(['ready','empty'].includes(s.contours.state),JSON.stringify({state:s.contours.state,message:s.contours.message,selection:s.contours.selection}));
    };
    const choose=async(short,group)=>{
        const source=catalogue.templates.find(t=>t.model===targetModel&&t.field_short_name===short);assert.ok(source,short);
        await click('#field-group-'+group);await wait("!document.getElementById('fieldMenu').hidden",'field menu');
        const selector='#fieldMenu .fieldOption[data-field='+JSON.stringify(source.field)+']';await click(selector);
        await wait('captureWeatherEvidence().ready&&captureWeatherEvidence().displayed.field==='+JSON.stringify(source.field),'selected '+short);
        await settled('contours '+short);return source;
    };
    for(const [width,height] of focused?[[1440,900]]:[[1440,900],[360,740],[640,360]]){
        await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        await call('Page.navigate',{url:origin+'/?validation=1'});await wait('window.captureWeatherEvidence?.().ready','initial field');
        await settled('initial contours');
        if(!await evaluate("document.getElementById('legendPanel').open"))await click('#legendPanel>summary');
        await check('default enabled '+width,"document.getElementById('contourToggle').getAttribute('aria-pressed')==='true'");
        await capture(width+'-initial');
        const before=await snapshot();await click('#contourToggle');
        await check('toggle retains field '+width,'(()=>{const s=captureWeatherEvidence();return !s.contours.enabled&&s.contours.labels.length===0&&s.displayed.selection==='+JSON.stringify(before.displayed.selection)+';})()');
        await click('#contourToggle');await settled('toggle on');
        if((await snapshot()).selected.model!==targetModel){await select('#model',targetModel);await wait('captureWeatherEvidence().ready&&captureWeatherEvidence().selected.model==='+JSON.stringify(targetModel),'actual multiple fields');}
        await choose('sp','pressure');
        await check('pressure hPa '+width,"document.querySelector('.unit').textContent==='гПа'");
        await capture(width+'-surface-pressure');
        if(width===1440&&!process.argv.includes('--skip-tour')){
            // Enumerate the actual field controls, including all cloud layers and both diagnostics.
            for(const model of [...new Set(catalogue.templates.map(t=>t.model))]){
                if((await snapshot()).selected.model!==model){await select('#model',model);await wait('captureWeatherEvidence().ready&&captureWeatherEvidence().selected.model==='+JSON.stringify(model),'tour model '+model);}
                const buttons=await evaluate("[...document.querySelectorAll('[id^=field-group-]')].filter(e=>!e.hidden).map(e=>e.id)");
                for(const button of buttons){
                    await click('#'+button);await wait("!document.getElementById('fieldMenu').hidden",'tour menu');
                    const fields=await evaluate("[...document.querySelectorAll('#fieldMenu .fieldOption')].map(e=>({field:e.dataset.field,label:e.textContent}))");
                    await click('#'+button);
                    for(const entry of fields){
                        const source=catalogue.templates.find(t=>t.model===model&&t.field===entry.field);
                        if(!source||['10u','10v'].includes(source.field_short_name))continue;
                        if(process.argv.includes('--diagnostics')&&!['unknown','lsrr','crr'].includes(source.field_short_name))continue;
                        await click('#'+button);await click('#fieldMenu .fieldOption[data-field='+JSON.stringify(entry.field)+']');
                        await wait('captureWeatherEvidence().ready&&captureWeatherEvidence().displayed.field==='+JSON.stringify(entry.field),'tour '+entry.label);
                        await wait("['ready','empty'].includes(captureWeatherEvidence().contours.state)",'tour contours');
                        const state=await snapshot();assert.ok(state.contours.profile?.step||state.contours.state==='empty');
                        assert.ok(state.managed_bytes<=128*1024**2);await capture('tour-'+model.replace(/[^a-z0-9-]/gi,'_')+'-'+report.states.length);
                    }
                }
            }
            if((await snapshot()).selected.model!==targetModel){await select('#model',targetModel);await wait('captureWeatherEvidence().ready&&captureWeatherEvidence().selected.model==='+JSON.stringify(targetModel),'restore model');}
            await choose('sp','pressure');
        }
        if(focused){
            await select('#projection','mercator');await pause(200);
            for(let i=0;i<5;i++){await click('#zoomIn');await pause(500);await settled('pressure scale '+i);await capture('pressure-scale-'+i);}
            break;
        }
        if(width===1440){
            const p=await nativePointPixel(evaluate);
            await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});
            await wait('captureWeatherEvidence().point?.value!==undefined','pressure point');
            await check('pressure point is hPa',"[...document.querySelectorAll('.pointValue')].some(e=>e.textContent.includes('гПа'))");await capture('pressure-point');
            if(await evaluate("!document.getElementById('drawer').hidden"))await click('#closeDrawer');
            await evaluate('window.__contourFail=true');await click('#zoomIn');
            await wait("captureWeatherEvidence().contours.state==='error'",'worker allocation fault');
            await check('error keeps raster and hides stale labels',"(()=>{const s=captureWeatherEvidence();return s.ready&&s.contours.labels.length===0&&!document.getElementById('contourRetry').hidden;})()");await capture('worker-error');
            await evaluate('window.__contourFail=false');await click('#contourRetry');await wait("captureWeatherEvidence().contours.state==='ready'",'worker retry');await capture('worker-recovered');
            await click('#zoomOut');await pause(500);await settled('restore scale');
        }
        for(const mode of ['mercator','orthographic','laea','laea-rf']){
            await select('#projection',mode);await wait('captureWeatherEvidence().ready&&captureWeatherEvidence().mode==='+JSON.stringify(mode),'projection '+mode);await settled('contours '+mode);
            const built=await snapshot();
            for(const theme of ['dark','light']){
                await select('#basemap',theme);await pause(200);
                for(const font of ['system','courier']){
                    await select('#font',font);await pause(100);
                    const s=await snapshot();assert.equal(s.contours.color,theme==='light'?'#707070':'#000000');
                    assert.ok(s.contours.curves>0,'Actual pressure contours visible in '+mode);
                    assert.equal(s.contours.build_ms,built.contours.build_ms,'Theme/font reuse geometry');assert.equal(s.contours.worker_active,false);
                    assert.ok(s.contours.labels.length<=7);assert.ok(s.managed_bytes<=128*1024**2,JSON.stringify({bytes:s.managed_bytes,contours:s.contours}));
                    await capture(width+'-'+mode+'-'+theme+'-'+font);
                }
            }
            if(width===1440){
                const scales=new Set([built.contours.profile.scale]);
                for(let i=0;i<8;i++){
                    await click('#zoomIn');await pause(500);await settled('scale '+mode+' '+i);
                    scales.add((await snapshot()).contours.profile.scale);await capture('scale-'+mode+'-'+i);
                    if(scales.size===3)break;
                }
                assert.deepEqual([...scales].sort(),[0,1,2],'All scale classes in '+mode);
                await click('#fit');await pause(500);await settled('fit '+mode);
            }
        }
        const beforePalette=await snapshot();await select('#palette','contrast');await pause(100);
        const afterPalette=await snapshot();assert.equal(afterPalette.contours.build_ms,beforePalette.contours.build_ms);assert.equal(afterPalette.contours.curves,beforePalette.contours.curves);
        await select('#palette','temperature');
        await select('#font','courier');await capture(width+'-courier');
        await choose('2sh','humidity');await check('specific humidity display '+width,"document.querySelector('.unit').textContent==='г/кг'");await capture(width+'-humidity');
        await choose('2t','temperature');await settled('temperature');await capture(width+'-temperature');
        const beforeUnits=await snapshot();await select('#units','K');await pause(100);
        assert.equal((await snapshot()).contours.build_ms,beforeUnits.contours.build_ms);await capture(width+'-kelvin');await select('#units','C');
        const p=nativePointPixel?await nativePointPixel(evaluate):undefined;
        if(p){await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});await wait('captureWeatherEvidence().point?.value!==undefined','point value');await capture(width+'-point');}
        if(await evaluate("!document.getElementById('drawer').hidden"))await click('#closeDrawer');
        for(let i=0;i<2;i++)await click('#zoomIn');await pause(500);await settled('scale change');await capture(width+'-zoom');
        if(!await evaluate("document.getElementById('timelinePanel').open"))await click('#timelinePanel>summary');
        const previousTime=(await snapshot()).displayed.valid_time;
        await click('#next');await wait('captureWeatherEvidence().ready&&captureWeatherEvidence().displayed.valid_time!=='+JSON.stringify(previousTime),'next time');await settled('next-time contour');
        const s=await snapshot();assert.equal(s.contours.selection,s.displayed.selection);await capture(width+'-next');
        assert.ok(await evaluate('window.__contourProbe.peak_managed_bytes<=128*1024**2'));
    }
    await network.finish();assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;
    if(call)try{report.failure_state=(await call('Runtime.evaluate',{expression:'window.captureWeatherEvidence?.()',returnByValue:true})).result.value;report.failure_dom=(await call('Runtime.evaluate',{expression:'document.body.innerText',returnByValue:true})).result.value;const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,'failure.png'),Buffer.from(r.data,'base64'));}catch{}
}finally{
    checksEnded=performance.now();
    try{
        if(call)try{await call('Page.navigate',{url:'about:blank'});await call('Browser.close');}catch{}socket?.close();
        if(child){for(let i=0;i<50&&child.exitCode===null;i++)await pause(100);if(child.exitCode===null)execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});}
        const remaining=execFileSync('powershell',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:HMC_WIND_PROFILE) }).Count"],{encoding:'utf8',windowsHide:true,env:{...process.env,HMC_WIND_PROFILE:profile}}).trim();
        assert.equal(remaining,'0');assert.ok(profile.startsWith(directory+sep));await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
        if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
        report.cleanup={browser_processes_remaining:0,profile_removed:true,test_proxy_closed:true,compose_resources_created:0,live_services_modified:false,live_data_modified:false};
    }catch(error){report.status='failed';report.cleanup={error:String(error)};process.exitCode=1;}
    report.timing_ms={preparation:browserStarted-started,browser_startup:checksStarted-browserStarted,checks:checksEnded-checksStarted,cleanup:performance.now()-checksEnded,total:performance.now()-started};
    await writeFile(join(directory,'validation.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({directory,status:report.status,checks:report.checks.length,screenshots:report.screenshots.length,cleanup:report.cleanup,failure:report.failure}));
}
