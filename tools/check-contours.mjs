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
import {selectViewerOption} from './viewer-select-option.mjs';


const directory=resolve(process.argv[2]),browser=process.argv[3]??'chrome';
assert.ok(['chrome','edge'].includes(browser));
const focused=process.argv.includes('--focused'),started=performance.now();
const independentLayers=process.argv.includes('--independent-layers');
const pointComparison=process.argv.includes('--point-comparison');
assert.ok(!pointComparison||independentLayers,'Point comparison requires the independent layers fixture');
let browserStarted=0,checksStarted=0,checksEnded=0;
assert.ok(directory.startsWith(resolve('data/reports/contours74')+sep));
const gateway=process.env.HMC_WIND_GATEWAY??'http://127.0.0.1:8140';
assert.match(gateway,/^http:\/\/127\.0\.0\.1:\d+$/);
const executable=browser==='edge'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'C:/Program Files/Google/Chrome/Application/chrome.exe';
await mkdir(directory,{recursive:false});
const report={scope:(pointComparison?'Point comparison and isoline scale #116':independentLayers?'Independent forecast layers':'Native contours #74')+': frozen viewer and real published APIs; emulation is not physical Android',
    browser,gateway,starting_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),checks:[],inputs:{},errors:[],screenshots:[],states:[],requests:[],cleanup:{}};
const sha=b=>createHash('sha256').update(b).digest('hex');
const freeze=async(source,target)=>{const bytes=await readFile(source);report.inputs[source]=sha(bytes);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);};
for(const entry of await readdir('viewer',{withFileTypes:true}))if(entry.isFile()&&/\.(?:ts|js|json|css|html|mjs)$/.test(entry.name))
    await freeze('viewer/'+entry.name,join(directory,'inputs/viewer',entry.name));
for(const path of ['tools/check-contours.mjs','tools/viewer-fields.mjs','tools/viewer-network.mjs','tools/viewer-select-option.mjs','tools/check-contour-reference.py','tools/check-contour-reference.mjs'])await freeze(path,join(directory,'inputs',path));
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
    const select=(selector,value)=>selectViewerOption(evaluate,selector,value);
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
        const Original=window.Worker;window.Worker=class extends Original{constructor(url,options){if(window.__contourFail&&/contour-(surface-)?worker/.test(String(url)))throw Error('Test worker allocation fault');super(url,options);}};
    }`});

    const settled=async(name)=>{
        await wait("(()=>{const s=captureWeatherEvidence(),c=s.contours,mode={mercator:'mercator',orthographic:'hmc:orthographic',laea:'EPSG:3576','laea-rf':'hmc:laea-rf'}[s.mode];return c.view?.mode===mode&&(c.state==='error'||['ready','empty'].includes(c.state)&&!c.worker_active&&c.curves!==undefined);})()",name);
        const s=await snapshot();assert.ok(['ready','empty'].includes(s.contours.state),JSON.stringify({state:s.contours.state,message:s.contours.message,selection:s.contours.selection}));
    };
    const chooseColumn=async(short,group,kind)=>{
        const source=catalogue.templates.find(t=>t.model===targetModel&&t.field_short_name===short);assert.ok(source,short);
        await click('#'+kind+'-group-'+group);await wait(`!document.getElementById('${kind}Menu').hidden`,'field menu');
        await click('#'+kind+'Menu .fieldOption[data-field='+JSON.stringify(source.field)+']');
        return source;
    };
    const choose=async(short,group)=>{
        const source=await chooseColumn(short,group,'field');
        await wait('captureWeatherEvidence().ready&&captureWeatherEvidence().displayed.field==='+JSON.stringify(source.field),'selected '+short);
        await chooseColumn(short,group,'contour');
        await settled('contours '+short);return source;
    };
    const pickPoint=async()=>{
        const pixel=await nativePointPixel(evaluate);assert.ok(pixel);
        for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...pixel});
    };
    const pointReading=(host,layer,unit)=>`document.querySelector('${host} [data-point-layer="${layer}"] .pointValue')?.textContent.includes(${JSON.stringify(unit)})`;
    const bothReadings=host=>`${pointReading(host,'background','°C')}&&${pointReading(host,'isolines','гПа')}`;
    for(const [width,height] of focused?[[1440,900]]:[[1440,900],[360,740],[640,360]]){
        await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        await call('Page.navigate',{url:origin+'/?validation=1'+(independentLayers?'&fixtures=1':'')});await wait('window.captureWeatherEvidence?.().ready','initial field');
        await settled('initial contours');
        if(independentLayers){
            await check('map has matching field columns with background on the left',`(()=>{
                const a=document.querySelector('#contourButtons'),b=document.querySelector('#fieldButtons');
                return Boolean(a&&b&&b.getBoundingClientRect().left<a.getBoundingClientRect().left&&a.innerText===b.innerText);
            })()`);
            await check('initial temperature selected for both layers',"['contour','field'].every(kind=>document.getElementById(kind+'-group-temperature').ariaPressed==='true')");
            await check('separate legend without the old switch',"!document.getElementById('contourToggle')&&!document.getElementById('contourPanel').hidden");
            if((await snapshot()).selected.model!==targetModel){
                await select('#model',targetModel);
                await wait('captureWeatherEvidence().ready&&captureWeatherEvidence().selected.model==='+JSON.stringify(targetModel),'pressure model');
            }
            const before=await snapshot();
            const source=await chooseColumn('sp','pressure','contour');
            await wait("document.querySelector('#contourLegend').textContent.includes('Изобары проведены через')&&!document.querySelector('#contourScale').hidden",'pressure lines beside original background');
            assert.equal((await snapshot()).displayed.selection,before.displayed.selection,'Choosing isolines preserves the background selection and time');
            await check('isoline legend has field name, visible levels and pressure interval',`(()=>{
                const title=document.querySelector('#contourTitle').textContent;
                const ticks=[...document.querySelectorAll('#contourTicks .contourTick')];
                const values=ticks.map(tick=>Number(tick.dataset.level));
                const positions=ticks.map(tick=>parseFloat(tick.style.left));
                const levels=captureWeatherEvidence().contours.visible_levels;
                const min=values[0],max=values.at(-1);
                const labels=ticks.map(tick=>tick.firstElementChild).filter(label=>getComputedStyle(label).visibility==='visible');
                const bounds=labels.map(label=>label.getBoundingClientRect());
                return title.includes('Давление')&&title.includes('гПа')&&values.length>1&&
                    JSON.stringify(values)===JSON.stringify(levels)&&positions.every((p,i)=>Math.abs(p-(values[i]-min)/(max-min)*100)<.001)&&
                    ticks.every(tick=>tick.getBoundingClientRect().height>=3)&&bounds.length>0&&bounds.every((box,i)=>!i||box.left>=bounds[i-1].right);
            })()`);
            await capture(width+'-independent-layers');
            if(width===1440){
                const elevated=await chooseColumn('2t','temperature','field');
                await wait('captureWeatherEvidence().ready&&captureWeatherEvidence().displayed.field==='+JSON.stringify(elevated.field),'background vertical level');
                await check('background level changes without replacing the pressure isolines',"document.getElementById('contour-group-pressure').ariaPressed==='true'&&!document.getElementById('contourScale').hidden");
                await chooseColumn('t','temperature','field');await wait('captureWeatherEvidence().ready&&captureWeatherEvidence().displayed.field==='+JSON.stringify(before.displayed.field),'surface background');
                await pickPoint();
                const apiField=field=>`(()=>{const link=document.querySelector('#apiLink');return link.href&&new URL(link.href).searchParams.get('layer')===${JSON.stringify(field)};})()`;
                await wait(apiField(before.displayed.field),'point API uses background');
                const pointAndSeries=(field,unit)=>`(()=>{
                    const s=captureWeatherEvidence(),card=document.querySelector('#pointContent');
                    return s.point?.field===${JSON.stringify(field)}&&Number.isFinite(s.point.value)&&
                        card.querySelector('.pointValue').textContent.includes(${JSON.stringify(unit)})&&
                        Boolean(card.querySelector('.realPointChart .selectedValue'));
                })()`;
                const temperaturePoint=pointAndSeries(before.displayed.field,'°C');
                const pressurePoint=pointAndSeries(source.field,'гПа');
                await wait(temperaturePoint,'temperature point and chart');
                if(pointComparison){
                    const row=(layer,unit)=>pointReading('#pointContent',layer,unit);
                    const bothRows=bothReadings('#pointContent');
                    await wait(bothRows,'both point values and units');
                    await check('point shows background then isolines with separate colours and scales',`(()=>{
                        const card=document.querySelector('#pointContent');
                        const [background,isolines]=card.querySelectorAll('.pointReading');
                        const b=card.querySelector('g[data-point-layer="background"]'),c=card.querySelector('g[data-point-layer="isolines"]');
                        const spread=group=>{const y=[...group.querySelectorAll('circle')].map(node=>Number(node.getAttribute('cy')));return Math.max(...y)-Math.min(...y);};
                        return background.dataset.pointLayer==='background'&&isolines.dataset.pointLayer==='isolines'&&
                            background.getBoundingClientRect().left<isolines.getBoundingClientRect().left&&
                            background.innerText.includes('Температур')&&isolines.innerText.includes('Давление')&&
                            getComputedStyle(b.querySelector('.forecastLine')).stroke!==getComputedStyle(c.querySelector('.forecastLine')).stroke&&
                            Math.abs(spread(b)-68)<.01&&Math.abs(spread(c)-68)<.01&&
                            card.querySelectorAll('.pointProvenance').length===2;
                    })()`);
                    await check('both readings match canonical native samples for the same point',`(async()=>{
                        const state=captureWeatherEvidence(),base=new URL(document.querySelector('#apiLink').href),pressure=new URL(base);
                        pressure.searchParams.set('layer',${JSON.stringify(source.field)});
                        pressure.searchParams.set('selection',state.contours.selection);
                        const results=await Promise.all([base,pressure].map(async url=>{
                            const response=await fetch(url);if(!response.ok)throw Error('Point reference: '+response.status);return response.json();
                        }));
                        const value=layer=>parseFloat(document.querySelector('#pointContent [data-point-layer="'+layer+'"] .pointValue').textContent.replace(',','.'));
                        return results.every(result=>result.spatial_selection==='nearest-native-cell'&&result.temporal_selection==='exact'&&
                            result.revision===state.selected.revision&&result.valid_time===state.selected.valid_time)&&
                            Math.abs(value('background')-(results[0].value-273.15))<=.0051&&
                            Math.abs(value('isolines')-results[1].value/100)<=.0051;
                    })()`);
                    await wait("document.querySelectorAll('#pointContent .windBarb').length===2",'published wind symbols on both sides of the gap');
                    await check('one wind strip shares the time axis',`(()=>{
                        const chart=document.querySelector('#pointContent .realPointChart');
                        return [...chart.querySelectorAll('.windBarb')].every(node=>!node.closest('g[data-point-layer]'))&&
                            chart.querySelector('text:last-child').textContent.endsWith('UTC')&&chart.querySelectorAll('small').length===1;
                    })()`);
                    await capture(width+'-two-point-series');
                    await chooseColumn('t','temperature','contour');
                    await wait("document.querySelectorAll('#pointContent .pointReading').length===1",'identical fields are combined');
                    await check('same field shows one background graph',`(()=>{const svg=document.querySelector('#pointContent svg');
                        return svg.querySelector('g[data-point-layer="background"]')&&!svg.querySelector('g[data-point-layer="isolines"]');
                    })()`);
                    await chooseColumn('2t','temperature','contour');
                    await wait(`${row('isolines','°C')}&&document.querySelector('#pointContent .pointReading[data-point-layer="isolines"]').innerText.includes('2 м')`,'different levels remain separate');
                    await chooseColumn('sp','pressure','contour');
                    await wait(bothRows,'restore pressure for shared chart');
                    await wait("document.querySelectorAll('#pointContent svg g[data-point-layer=\"isolines\"] circle').length===3",'pressure values on either side of the gap');
                    const plot=await evaluate(`(()=>{const svg=document.querySelector('#pointContent svg'),rect=svg.getBoundingClientRect();
                        const second=svg.querySelectorAll('g[data-point-layer="background"] circle')[1];
                        return {x:rect.left+rect.width*Number(second.getAttribute('cx'))/svg.viewBox.baseVal.width,y:rect.top+rect.height*.6};
                    })()`);
                    await call('Input.dispatchMouseEvent',{type:'mouseMoved',...plot});
                    await wait("document.querySelector('#pointContent output').textContent.includes('Нет данных')",'hover shows the isoline gap');
                    await check('hover describes UTC and both fields without changing time',`(()=>{
                        const output=document.querySelector('#pointContent output').textContent;
                        return output.includes('UTC')&&output.includes('°C')&&output.includes('Давление')&&
                            document.querySelector('#pointContent .pointReading[data-point-layer="isolines"] .pointValue').textContent.includes('гПа');
                    })()`);
                    for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...plot});
                    await wait(row('isolines','Нет данных'),'explicit chart click selects the published middle slot');
                    await check('gap preserves the other row and both distant pressure values',`(()=>{
                        const path=document.querySelector('#pointContent svg g[data-point-layer="isolines"]');
                        const circles=path.querySelectorAll('circle'),segments=path.querySelectorAll('.forecastLine');
                        return ${row('background','°C')}&&circles.length===3&&segments.length===1&&
                            segments[0].getAttribute('d').startsWith('M'+circles[1].getAttribute('cx')+',');
                    })()`);
                    await click('#previous');await wait(bothRows,'return to the first published slot');
                    await click('#contour-group-wind');
                    await check('wind at 100 m remains visible and disabled in the isoline column',`
                        [...document.querySelectorAll('#contourMenu .fieldOption')].some(button=>button.disabled&&button.innerText.includes('100 м')&&
                            button.innerText.includes('Изолинии для этого показателя не настроены'))`);
                    await click('#contourMenu .fieldMenuClose');
                }
                await click('#field-empty');
                await wait(apiField(source.field),'point API switches to isolines');
                await wait(pressurePoint,'pressure point and chart');
                await wait("!document.getElementById('contourScale').hidden",'pressure legend settles after turning off the background');
                await check('isolines supply point value and graph after disabling the background',pressurePoint);
                await check('isolines remain visible with no background',"document.getElementById('legendPanel').hidden&&!document.getElementById('contourScale').hidden");
                await capture(width+'-isolines-only');
                await click('#contour-empty');
                await check('both empty leaves no forecast legend, point or API link',`['legendPanel','contourPanel','pointCard','apiLink'].every(id=>document.getElementById(id).hidden)`);
                await check('empty selections preserve the model and wind controls',"document.getElementById('model').value!==''&&!document.getElementById('windPanel').hidden");
                await chooseColumn('t','temperature','field');
                await wait('captureWeatherEvidence().ready','restore background');
                await chooseColumn('sp','pressure','contour');
                await settled('restore pressure lines');
                const nextDisabled=await evaluate("document.getElementById('next').disabled");
                if(!focused)assert.equal(nextDisabled,false,'Acceptance fixture must publish a second forecast time');
                if(!nextDisabled){
                    await click('#next');
                    await wait('captureWeatherEvidence().ready&&captureWeatherEvidence().displayed.valid_time!=='+JSON.stringify(before.displayed.valid_time),'next published time');
                    await check('missing isolines preserve the background',"!document.getElementById('legendPanel').hidden&&document.getElementById('contourLegend').textContent.includes('Нет данных на выбранный срок')");
                    await chooseColumn('t','temperature','contour');await settled('temperature lines at the next time');
                    await chooseColumn('sp','pressure','field');
                    await check('missing background preserves the time and isolines',"document.getElementById('legendSource').textContent.includes('Нет данных на выбранный срок')&&!document.getElementById('contourScale').hidden");
                    await chooseColumn('sp','pressure','contour');
                    await check('current missing time is retained and offered times require data',`(()=>{
                        const time=document.getElementById('time');return time.selectedOptions[0].disabled&&[...time.options].some(option=>!option.disabled);
                    })()`);
                    await click('#field-empty');await click('#contour-empty');
                    await check('empty choices offer all published times',"[...document.getElementById('time').options].filter(option=>!option.disabled).length>=2");
                }
                const secondModel=catalogue.templates.find(t=>t.model!==targetModel&&t.field==='T_G:surface:0')?.model;
                if(!focused)assert.ok(secondModel,'Acceptance fixture must publish a second model');
                if(secondModel){
                    await chooseColumn('t','temperature','field');await wait('captureWeatherEvidence().ready','restore temperature');
                    await chooseColumn('sp','pressure','contour');
                    await select('#model',secondModel);
                    await wait('captureWeatherEvidence().ready&&captureWeatherEvidence().displayed.model==='+JSON.stringify(secondModel),'temperature retained across models');
                    await check('model change clears unmatched pressure only',"document.getElementById('contourPanel').hidden&&document.getElementById('contour-empty').ariaPressed==='true'&&!document.getElementById('legendPanel').hidden");
                    const anotherRun=await evaluate(`(()=>{const run=document.getElementById('run');
                        return [...run.options].map(option=>option.value).find(value=>JSON.parse(value)[1]!==JSON.parse(run.value)[1]);})()`);
                    if(!focused)assert.ok(anotherRun,'Acceptance fixture must publish a second run');
                    if(anotherRun){
                        await select('#run',anotherRun);
                        await wait('captureWeatherEvidence().ready&&captureWeatherEvidence().displayed.run==='+JSON.stringify(JSON.parse(anotherRun)[1]),'other model run');
                        await check('run change retains background selection and disabled contours',"document.getElementById('field-group-temperature').ariaPressed==='true'&&document.getElementById('contourPanel').hidden");
                    }
                    await select('#model',targetModel);
                    await wait('captureWeatherEvidence().ready&&captureWeatherEvidence().displayed.model==='+JSON.stringify(targetModel),'restore pressure model');
                    await chooseColumn('sp','pressure','contour');await settled('recover pressure contours');
                    await select('#projection','orthographic');await settled('orthographic contours');
                    await click('#fit');await settled('center globe at forecast coverage');
                    for(let i=0;i<9;i++)await click('#east');
                    await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,x:720,y:740});
                    await call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:720,y:200});
                    await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:720,y:200});
                    await wait("document.getElementById('contourLegend').textContent.includes('Нет изолиний в видимой области')",'weather field behind the horizon');
                    await check('empty viewport hides the scale and retains the interval',"document.getElementById('contourScale').hidden&&document.getElementById('contourLegend').textContent.includes('Изобары проведены через')");
                }
            }
            if(pointComparison&&width!==1440){
                await pickPoint();
                await wait(bothReadings('#mobilePoint'),'two native values in the mobile drawer');
                await check('mobile drawer renders two labelled rows and a fitted chart',`(()=>{
                    const card=document.querySelector('#mobilePoint'),plot=card.querySelector('.pointPlot');
                    const [left,right]=card.querySelectorAll('.pointReading');
                    return card.checkVisibility()&&left.getBoundingClientRect().left<right.getBoundingClientRect().left&&
                        plot.clientWidth>0&&plot.scrollWidth<=plot.clientWidth&&plot.querySelectorAll('g[data-point-layer]').length===2;
                })()`);
                await capture(width+'-mobile-point-comparison');
                await evaluate("document.querySelector('#mobilePoint .pointPlot').scrollIntoView({block:'center'})");
                await check('both curves fit the scrolled mobile drawer',`(()=>{
                    const plot=document.querySelector('#mobilePoint .pointPlot'),drawer=document.querySelector('#drawer');
                    const a=plot.getBoundingClientRect(),b=drawer.getBoundingClientRect();
                    return Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>80&&
                        plot.querySelectorAll('g[data-point-layer]:has(.forecastLine)').length===2;
                })()`);
                await capture(width+'-mobile-point-chart');
            }
            continue;
        }
        if(!await evaluate("document.getElementById('legendPanel').open"))await click('#legendPanel>summary');
        await check('default enabled '+width,"document.getElementById('contour-empty').getAttribute('aria-pressed')==='false'");
        await capture(width+'-initial');
        const before=await snapshot();await click('#contour-empty');
        await check('toggle retains field '+width,'(()=>{const s=captureWeatherEvidence();return !s.contours.enabled&&s.contours.labels.length===0&&s.displayed.selection==='+JSON.stringify(before.displayed.selection)+';})()');
        await chooseColumn(before.displayed.field_short_name,'temperature','contour');await settled('toggle on');
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
                        await click('#contour-group-'+button.slice('field-group-'.length));
                        const contourTile='#contourMenu .fieldOption[data-field='+JSON.stringify(entry.field)+']';
                        if(await evaluate(`document.querySelector(${JSON.stringify(contourTile)}).disabled`)){await click('#contourMenu .fieldMenuClose');continue;}
                        await click(contourTile);await settled('tour contours');
                        const state=await snapshot();assert.ok(state.contours.profile?.step||state.contours.state==='empty');
                        assert.ok(state.managed_bytes<=state.managed_budget_bytes);await capture('tour-'+model.replace(/[^a-z0-9-]/gi,'_')+'-'+report.states.length);
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
                    assert.ok(s.contours.labels.length<=7);assert.ok(s.managed_bytes<=s.managed_budget_bytes,JSON.stringify({bytes:s.managed_bytes,contours:s.contours}));
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
        assert.ok(await evaluate('window.__contourProbe.peak_managed_bytes<=captureWeatherEvidence().managed_budget_bytes'));
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
