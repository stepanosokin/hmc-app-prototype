// Isolated frozen viewer, read-only proxy to immutable real publications.
// Does not rebuild or modify the user's running viewer, database or volumes.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,readdir,mkdir,rm,copyFile} from 'node:fs/promises';
import {resolve,join,dirname,sep,extname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {nativePointPixel} from './viewer-fields.mjs';
import {checkWindFixtures} from './viewer-wind-fixtures.mjs';

const directory=resolve(process.argv[2]),browser=process.argv[3]??'chrome';
const direct=process.argv[4]==='--direct-smoke';
const fixturesOnly=process.argv[4]==='--fixtures-only';
assert.ok(directory.startsWith(resolve('data/reports/wind72')+sep));
const gateway=process.env.HMC_WIND_GATEWAY??'http://127.0.0.1:8140';
assert.match(gateway,/^http:\/\/127\.0\.0\.1:\d+$/);
const executable=browser==='edge'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'C:/Program Files/Google/Chrome/Application/chrome.exe';
await mkdir(directory,{recursive:false});
const report={scope:'Wind overlay: frozen production viewer and real published APIs; emulated mobile, not physical hardware',
    browser,gateway,starting_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),checks:[],inputs:{},errors:[],screenshots:[],states:[],requests:[],cleanup:{}};
const sha=b=>createHash('sha256').update(b).digest('hex');
const freeze=async(source,target)=>{const bytes=await readFile(source);report.inputs[source]=sha(bytes);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);};
for(const entry of await readdir('viewer',{withFileTypes:true}))if(entry.isFile()&&/\.(?:ts|js|json|css|html|mjs)$/.test(entry.name))
    await freeze('viewer/'+entry.name,join(directory,'inputs/viewer',entry.name));
for(const path of ['tools/check-wind-overlay.mjs','tools/viewer-fields.mjs','tools/viewer-wind-fixtures.mjs'])await freeze(path,join(directory,'inputs',path));
await freeze('tests/fixtures/wind/rotated-reference.json',join(directory,'inputs/tests/fixtures/wind/rotated-reference.json'));
const build=join(directory,'site/build');
const profile=join(directory,'profile'),pause=ms=>new Promise(r=>setTimeout(r,ms));
let child,socket,call,server;
try{
    const result=execFileSync(process.execPath,['viewer/node_modules/typescript/bin/tsc','-p',join(directory,'inputs/viewer/tsconfig.json'),'--outDir',build],{encoding:'utf8',windowsHide:true});
    await writeFile(join(directory,'compile.log'),result);
    const catalogueBytes=Buffer.from(await(await fetch(gateway+'/api/v1/catalogue?view=compact')).arrayBuffer());
    const catalogue=JSON.parse(catalogueBytes);await writeFile(join(directory,'catalogue.json'),catalogueBytes);
    const windModel=catalogue.templates.find(t=>t.wind_axis==='u')?.model;assert.ok(windModel,'Actual publication includes U/V');
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
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=direct?gateway:'http://127.0.0.1:'+server.address().port;
    report.test_origin=origin;
    if(direct)report.scope='Direct smoke of the locally served viewer and real APIs; no fixture proxy used by the page';
    if(fixturesOnly)report.scope='Development: synthetic supplement only, not complete browser acceptance';
    child=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
    let port;for(let i=0;i<100;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{}await pause(100);}assert.ok(port,'CDP started');
    const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
    await new Promise((res,rej)=>{socket.onopen=res;socket.onerror=rej;});let id=0;const pending=new Map();
    socket.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')report.errors.push(m.params.exceptionDetails);};
    call=(method,params={})=>new Promise((res,rej)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);rej(Error('CDP timeout '+method));},20000);pending.set(n,{resolve:res,reject:rej,timer});socket.send(JSON.stringify({id:n,method,params}));});
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const wait=async(expression,name)=>{console.log(JSON.stringify({phase:name}));for(let i=0;i<450;i++){if(await evaluate(expression))return;await pause(100);}throw Error('Timeout: '+name);};
    const check=async(name,expression)=>{assert.equal(await evaluate(expression),true,name);report.checks.push(name);};
    const click=async selector=>{const b=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...b});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...b});};
    const select=async(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const snapshot=()=>evaluate('captureWeatherEvidence()');
    const capture=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,name+'.png'),Buffer.from(r.data,'base64'));report.screenshots.push(name+'.png');report.states.push({name,...await snapshot()});};
    await call('Page.enable');await call('Runtime.enable');report.version=await call('Browser.getVersion');
    for(const [width,height] of direct?[[1440,900]]:[[1440,900],[360,740],[640,360]]){
        await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        await call('Page.navigate',{url:origin+'/?validation=1'});await wait('window.captureWeatherEvidence?.().ready','initial scalar');
        if(fixturesOnly)break;
        if((await snapshot()).selected.model!==windModel){await select('#model',windModel);await wait('captureWeatherEvidence().ready&&captureWeatherEvidence().selected.model==='+JSON.stringify(windModel),'wind model');}
        await wait("captureWeatherEvidence().wind_overlay.state==='ready'&&captureWeatherEvidence().wind?.visible>0",'independent actual wind');
        await check(width+' default enabled and exact identity',"(()=>{const s=captureWeatherEvidence(),w=s.wind.identity;return s.wind_overlay.enabled&&['model','run','revision','valid_time','member'].every(k=>w[k]===s.displayed[k]);})()");
        await check(width+' controls above legend',"document.getElementById('windPanel').getBoundingClientRect().bottom<=document.getElementById('legendPanel').getBoundingClientRect().top");
        await check(width+' managed memory bounded','captureWeatherEvidence().managed_bytes<=128*1024**2');
        await check(width+' adaptive density uses approved desktop reference',`captureWeatherEvidence().wind.arrows===Math.round(${width}*${height}/(1440*900)*768)`);
        await capture(width+'-initial');
        const before=(await snapshot()).displayed.selection;
        await click('#windToggle');await check(width+' toggle independent',`!captureWeatherEvidence().wind_overlay.enabled&&captureWeatherEvidence().displayed.selection===${JSON.stringify(before)}`);
        await click('#windToggle');await wait("captureWeatherEvidence().wind_overlay.state==='ready'&&captureWeatherEvidence().wind?.visible>0",'wind on');
        if(width===1440&&!direct){
            for(const mode of ['mercator','orthographic','laea','laea-rf']){
                await select('#projection',mode);await wait(`captureWeatherEvidence().ready&&captureWeatherEvidence().mode===${JSON.stringify(mode)}&&captureWeatherEvidence().wind?.visible>0`,'mode '+mode);
                await check(mode+' same selection and wind',`captureWeatherEvidence().displayed.selection===${JSON.stringify(before)}&&captureWeatherEvidence().wind.identity.valid_time===captureWeatherEvidence().displayed.valid_time`);
                await capture('projection-'+mode);
            }
            for(const [steps,label] of [[2,'region'],[2,'city']]){
                for(let i=0;i<steps;i++){await click('#zoomIn');await pause(350);}
                await check('Stable CSS density at '+label,'captureWeatherEvidence().wind.arrows===768&&captureWeatherEvidence().wind.visible>0');
                await capture('zoom-'+label);
            }
            await click('#fit');await pause(350);
        }
        const pixel=await nativePointPixel(evaluate);assert.ok(pixel,'Uncovered native point exists');pixel.x+=.37;pixel.y+=.23;
        await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pixel});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pixel});
        await wait("captureWeatherEvidence().wind_overlay.point_entries.some(e=>e.state==='value')&&!captureWeatherEvidence().wind_overlay.point_entries.some(e=>e.state==='loading')",'U/V point series');
        await check(width+' scalar chart with wind flags',"document.querySelector('.realPointChart .pointPlot svg g title')?.textContent.includes('м/с')&&document.querySelector('.realPointChart .forecastLine')!==null");
        await check(width+' entire popup chart fits without horizontal scrolling',"(()=>{const plots=[...document.querySelectorAll('.realPointChart .pointPlot')].filter(e=>e.getClientRects().length);return plots.length>0&&plots.every(e=>e.clientWidth>0&&e.scrollWidth<=e.clientWidth);})()");
        await check(width+' barb and exact-value units explicit',"document.querySelector('.realPointChart>small').textContent.includes('в узлах')&&document.querySelector('.realPointChart>small').title.includes('м/с')");
        await capture(width+'-point');
        if(width!==1440){
            await evaluate("document.querySelector('#mobilePoint .pointPlot').scrollIntoView({block:'center'})");
            await check(width+' popup graph can be exposed by scrolling',"(()=>{const r=document.querySelector('#mobilePoint .pointPlot').getBoundingClientRect(),d=document.getElementById('drawer').getBoundingClientRect();return r.top>=d.top&&r.bottom<=d.bottom;})()");
            await capture(width+'-point-chart');
            await check(width+' close control exposed',"(()=>{const e=document.getElementById('closeDrawer'),r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;})()");
        }
        await select('#basemap','light');await select('#font','courier');await capture(width+'-light-courier');
        await check(width+' no document overflow','document.documentElement.scrollWidth<=innerWidth');
        await select('#basemap','dark');await select('#font','system');
        if(width===1440&&!direct){
            await click('#field-group-pressure');
            await wait("document.querySelector('#fieldMenu .fieldOption')",'pressure option');await click('#fieldMenu .fieldOption');
            await wait("captureWeatherEvidence().ready&&['prmsl','sp'].includes(captureWeatherEvidence().selected.field_short_name)",'pressure primary');
            await wait("captureWeatherEvidence().wind_overlay.state==='ready'&&captureWeatherEvidence().wind?.visible>0",'wind above pressure');
            await capture('pressure-overlay');
            await click('#next');await wait("captureWeatherEvidence().ready&&captureWeatherEvidence().wind_overlay.state==='ready'&&captureWeatherEvidence().wind.identity.valid_time===captureWeatherEvidence().displayed.valid_time",'exact next time');
            await capture('next-time');
            const ids=await evaluate("[...document.querySelectorAll('#fieldButtons>button')].map(e=>e.id)");
            const componentFields=catalogue.templates.filter(t=>t.wind_axis).map(t=>t.field);
            for(const id of ids){
                await click('#'+id);await wait("!document.getElementById('fieldMenu').hidden",'field menu '+id);
                const options=await evaluate("[...document.querySelectorAll('#fieldMenu .fieldOption')].map(e=>e.dataset.field)");
                assert.ok(options.length&&!options.some(field=>componentFields.includes(field)),'U/V excluded from scalar menu '+id);
                await click('#fieldMenu .fieldOption');
                await wait("captureWeatherEvidence().ready&&captureWeatherEvidence().wind_overlay.state==='ready'&&captureWeatherEvidence().wind?.visible>0",'overlay on '+id);
                await check('Exact wind identity on '+id,"(()=>{const s=captureWeatherEvidence();return ['model','run','revision','valid_time','member'].every(k=>s.wind.identity[k]===s.displayed[k]);})()");
                await check('Memory bounded on '+id,'captureWeatherEvidence().managed_bytes<=128*1024**2');
                await capture('field-'+id);
            }
        }
    }
    if(!direct)report.synthetic=await checkWindFixtures(evaluate,origin);
    assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;
    if(call)try{report.failure_state=(await call('Runtime.evaluate',{expression:'window.captureWeatherEvidence?.()',returnByValue:true})).result.value;report.failure_dom=(await call('Runtime.evaluate',{expression:'document.body.innerText',returnByValue:true})).result.value;const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,'failure.png'),Buffer.from(r.data,'base64'));}catch{}
}finally{
    try{
        if(call)try{await call('Page.navigate',{url:'about:blank'});await call('Browser.close');}catch{}socket?.close();
        if(child){for(let i=0;i<50&&child.exitCode===null;i++)await pause(100);if(child.exitCode===null)execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});}
        const remaining=execFileSync('powershell',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:HMC_WIND_PROFILE) }).Count"],{encoding:'utf8',windowsHide:true,env:{...process.env,HMC_WIND_PROFILE:profile}}).trim();
        assert.equal(remaining,'0');assert.ok(profile.startsWith(directory+sep));await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
        if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
        report.cleanup={browser_processes_remaining:0,profile_removed:true,test_proxy_closed:true,compose_resources_created:0,live_services_modified:false,live_data_modified:false};
    }catch(error){report.status='failed';report.cleanup={error:String(error)};process.exitCode=1;}
    await writeFile(join(directory,'validation.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({directory,status:report.status,checks:report.checks.length,screenshots:report.screenshots.length,cleanup:report.cleanup,failure:report.failure}));
}
