// T23 public-API compatibility probe. A completed probe is not an acceptance pass.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,join,sep} from 'node:path';

const root = resolve('.');
const native = process.env.T23A_NATIVE === '1';
const directory = resolve(process.env.T23_REPORT_DIRECTORY || 'data/reports/t23/browser-'+randomUUID());
const profile = join(directory,'profile');
const sha = data => createHash('sha256').update(data).digest('hex');
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
const report = {scope:native?'T23a native display; mobile viewports are desktop emulation':'T23 compatibility only; mobile viewports are desktop emulation',
    starting_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),inputs:{},viewports:[],cleanup:{}};
assert.ok(directory.startsWith(join(root,'data','reports')+sep),'Reports must stay inside data/reports');
await mkdir(directory,{recursive:false});
const files = new Map();
for (const [url,path] of [['/',native?'tools/native-display/browser.html':'tools/display-projections/browser.html'],['/probe.js',native?'tools/native-display/probe.js':'tools/display-projections/probe.js'],
    ['/worker-projection.mjs','tools/display-projections/worker-projection.mjs'],
    ['/land.js','docs/prototypes/assets/land.js'],...(native?[['/native-layer.js','tools/native-display/native-layer.js'],
        ['/geometry-probe.js','tools/display-projections/probe.js']]:[])]) {
    const bytes = await readFile(path); files.set(url,bytes); report.inputs[path]=sha(bytes);
}
const lockPath = 'tools/display-projections/vendor-lock.json';
const lockBytes = await readFile(lockPath); report.inputs[lockPath]=sha(lockBytes);
report.inputs['tools/check-display-projections.mjs']=sha(await readFile('tools/check-display-projections.mjs'));
// Download before browser startup; all browser runtime inputs are served locally.
for (const entry of JSON.parse(lockBytes)) {
    const response = await fetch(entry.url);
    assert.ok(response.ok,entry.url);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length,entry.bytes); assert.equal(sha(bytes),entry.sha256);
    files.set('/vendor/'+entry.file,bytes);
    await mkdir(join(directory,'vendor'),{recursive:true});
    await writeFile(join(directory,'vendor',entry.file),bytes);
}
let reference;
if(process.env.T23_REFERENCE) {
    const bytes=await readFile(process.env.T23_REFERENCE);reference=JSON.parse(bytes);
    files.set('/reference.json',bytes);report.reference_sha256=sha(bytes);
}
const gateway=process.env.T23_GATEWAY;
if(gateway)assert.match(gateway,/^http:\/\/127\.0\.0\.1:\d+$/);
let pointRequests=0;
const server = createServer(async (request,response)=>{
    const incoming=new URL(request.url,'http://127.0.0.1');
    const point=native&&reference&&incoming.pathname==='/api/v1/point'&&pointRequests<24&&
        [...incoming.searchParams.keys()].length===8&&
        ['selection','run','revision','valid_time'].every(key=>incoming.searchParams.get(key)===reference.selection[key])&&
        incoming.searchParams.get('layer')===reference.selection.field&&
        incoming.searchParams.get('crs')==='http://www.opengis.net/def/crs/OGC/1.3/CRS84'&&
        ['lon','lat'].every(key=>incoming.searchParams.has(key)&&Number.isFinite(Number(incoming.searchParams.get(key))))&&
        Math.abs(Number(incoming.searchParams.get('lat')))<=90;
    if(gateway&&(reference?.tiles.some(tile=>tile.url===request.url)||native&&reference?.metadata_url===request.url||point)) {
        if(point)pointRequests++;
        try {
            const upstream=await fetch(gateway+request.url,{signal:AbortSignal.timeout(30000)});
            const bytes=Buffer.from(await upstream.arrayBuffer());
            response.writeHead(upstream.status,{'Content-Type':'application/octet-stream','X-HMC-Cache':upstream.headers.get('X-HMC-Cache')||''});
            response.end(bytes);
        } catch { response.writeHead(502);response.end('Шлюз недоступен'); }
        return;
    }
    const bytes = files.get(request.url.split('?')[0]);
    response.writeHead(bytes?200:404,{'Content-Type':request.url==='/'?'text/html; charset=utf-8':request.url==='/reference.json'?'application/json':'text/javascript; charset=utf-8'});
    response.end(bytes || 'Не найдено');
});
let child,socket,call;
try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin = `http://127.0.0.1:${server.address().port}`;
    const executable = process.env.T23_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    report.browser_executable=executable;
    child = spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check',
        '--disable-background-networking','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',
        `--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
    let startupError; child.on('error',error=>{startupError=error;});
    let port;
    for(let i=0;i<100;i++) {
        if(startupError)throw startupError;
        try {port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;} catch {}
        await delay(100);
    }
    assert.ok(port,'Browser debugging endpoint started');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    let id=0; const pending=new Map(); report.external_requests=[]; report.exceptions=[];report.console=[];
    socket.onmessage = event=>{
        const message=JSON.parse(event.data);
        if(pending.has(message.id)) {
            const promise=pending.get(message.id); pending.delete(message.id); clearTimeout(promise.timer);
            message.error?promise.reject(Error(JSON.stringify(message.error))):promise.resolve(message.result);
        } else if(message.method==='Runtime.exceptionThrown') report.exceptions.push(message.params.exceptionDetails);
        else if(message.method==='Runtime.consoleAPICalled')report.console.push({type:message.params.type,
            args:message.params.args.map(arg=>arg.value||arg.description)});
        else if(message.method==='Network.requestWillBeSent') {
            const url=message.params.request.url;
            if(/^https?:/.test(url)&&!url.startsWith(origin+'/'))report.external_requests.push(url);
        }
    };
    call = (method,params={})=>new Promise((resolve,reject)=>{
        const current=++id;
        const timer=setTimeout(()=>{pending.delete(current);reject(Error('CDP timeout: '+method));},native?120000:45000);
        pending.set(current,{resolve,reject,timer});socket.send(JSON.stringify({id:current,method,params}));
    });
    const evaluate = async expression=>{
        const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
        if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
    report.browser=await call('Browser.getVersion');
    report.system=await call('SystemInfo.getInfo').catch(error=>({unavailable:String(error)}));
    for(const [width,height,mobile] of [[1440,900,false],[390,844,true],[360,740,true]]) {
        await call('Emulation.setDeviceMetricsOverride',{width,height,mobile,deviceScaleFactor:1});
        await call('Page.navigate',{url:origin+'/'});
        for(let i=0;i<100;i++) {if(await evaluate('window.probeReady===true'))break;await delay(100);}
        const result=await evaluate('window.runProbe()');
        assert.ok(result,'Browser module started');
        report.viewports.push({width,height,mobile_emulation:mobile,...result});
        for(const mode of native?['hmc:orthographic','EPSG:3576']:['globe','hmc:orthographic','EPSG:3576']) {
            await evaluate(`window.showProbe(${JSON.stringify(mode)})`);
            const shot=await call('Page.captureScreenshot',{format:'png'});
            await writeFile(join(directory,`${width}x${height}-${mode.replace(':','-')}.png`),Buffer.from(shot.data,'base64'));
        }
    }
    assert.deepEqual(report.external_requests,[],'Browser uses local runtime resources');
    assert.deepEqual(report.exceptions,[],'No uncaught browser exception');
    report.status='compatibility-probe-complete';
    report.acceptance='incomplete';
} catch(error) {
    report.status='failed';report.failure=String(error);process.exitCode=1;
} finally {
    try {
        if(call)await call('Browser.close').catch(()=>{});
        socket?.close();
        if(child?.pid) {
            for(let i=0;i<50&&child.exitCode===null;i++)await delay(100);
            if(child.exitCode===null)execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});
            const remaining=execFileSync('powershell',['-NoProfile','-Command',
                "@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:T23_BROWSER_PROFILE) }).Count"],
                {encoding:'utf8',env:{...process.env,T23_BROWSER_PROFILE:profile},windowsHide:true}).trim();
            assert.equal(remaining,'0');
        }
        assert.ok(profile.startsWith(directory+sep));
        await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
        await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});
        report.cleanup={browser_processes_remaining:0,profile_removed:true,http_server_closed:true,compose_projects_created:0};
    } catch(error) {report.cleanup={error:String(error)};report.status='failed';process.exitCode=1;}
    await writeFile(join(directory,'browser.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({directory,status:report.status,acceptance:report.acceptance,failure:report.failure,cleanup:report.cleanup}));
}
