// Independent CPU/GLSL projection checks in a real browser. Owns only its profile.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const directory=resolve(process.env.GRIB_CRS_BROWSER_REPORT);
assert.ok(directory.startsWith(resolve('data/reports')+'\\'));
const origin=process.env.GRIB_CRS_VIEWER||'http://127.0.0.1:8189';
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
const fixtures=JSON.parse(await readFile(process.env.GRIB_CRS_REFERENCE,'utf8'));
await mkdir(directory,{recursive:false});
const profile=join(directory,'profile'),delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={scope:'six synthetic GRIB2 projection definitions, sphere and WGS84 ellipsoid; CPU and real GPU',cases:[],cleanup:{}};
let child,socket,call;
try{
    child=spawn(process.env.GRIB_CRS_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',[
        '--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',
        '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
    let port;
    for(let i=0;i<100;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{}await delay(100);}
    assert.ok(port,'Browser debugger started');
    const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
    await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
    let id=0;const pending=new Map();
    socket.onmessage=event=>{const message=JSON.parse(event.data),entry=pending.get(message.id);if(!entry)return;
        pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(Error(JSON.stringify(message.error))):entry.resolve(message.result);};
    call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout: '+method));},45000);
        pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params}));});
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
        if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    await call('Page.enable');await call('Runtime.enable');
    await call('Page.navigate',{url:origin+'/__start'});
    for(let i=0;i<100;i++){try{if(await evaluate("document.readyState==='complete'&&location.pathname==='/__start'"))break;}catch{}await delay(100);}
    await evaluate(`new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/vendor/proj4.js';script.onload=resolve;script.onerror=reject;document.head.append(script);})`);
    report.browser=await call('Browser.getVersion');
    for(const fixture of fixtures){
        const actual=await evaluate(`(async()=>{
            const fixture=${JSON.stringify(fixture)};
            const {nativePosition}=await import('/build/source-crs.js');
            const {NativeLayer}=await import('/build/native-layer.js');
            const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;document.body.append(canvas);
            const gl=canvas.getContext('webgl2');if(!gl)throw Error('WebGL2 unavailable');
            const projection=proj4('EPSG:4326','EPSG:3857');
            const metadata={contract:'hmc-native-display/2',grid:fixture.grid,columns:[0,0],source_crs:fixture.source_crs};
            const bytes=new ArrayBuffer(332820),v=new Float32Array(bytes,0,258*258),mask=new Uint8Array(bytes,258*258*4);
            for(let row=0;row<3;row++)for(let col=0;col<4;col++){const i=(row+1)*258+col+1;v[i]=280+row*4+col;mask[i]=1;}
            const map={getCanvas:()=>canvas,getContainer:()=>({clientWidth:64,clientHeight:64}),triggerRepaint:()=>{}};
            const layer=new NativeLayer([bytes],'mercator',projection,metadata);
            try{layer.onAdd(map,gl);
                const cpu=fixture.samples.map(p=>({forward:nativePosition(fixture.source_crs,p.wgs84),inverse:nativePosition(fixture.source_crs,p.native,true)}));
                const gpu=layer.positions(fixture.samples.map((p,i)=>[String(i),...p.map]),false);
                return {cpu,gpu,renderer:gl.getParameter(gl.RENDERER)};
            }finally{if(layer.program)layer.onRemove(map,gl);gl.getExtension('WEBGL_lose_context')?.loseContext();canvas.remove();}
        })()`);
        let cpuError=0,gpuError=0;
        for(let i=0;i<fixture.samples.length;i++){
            const expected=fixture.samples[i];
            for(let j=0;j<2;j++){
                const raw=actual.cpu[i].forward[j]-expected.native[j];
                const difference=fixture.template<2&&j===0?(raw+540)%360-180:raw;
                cpuError=Math.max(cpuError,Math.abs(difference));
                assert.ok(Math.abs(difference)<(fixture.template<2?1e-8:1e-4),`CPU native ${fixture.template}/${fixture.earth_shape}/${i}/${j}: ${difference}`);
                const inverse=actual.cpu[i].inverse[j]-expected.wgs84[j];
                assert.ok(Math.abs(j===0?(inverse+540)%360-180:inverse)<1e-8,JSON.stringify({scope:'CPU inverse',template:fixture.template,shape:fixture.earth_shape,index:i,axis:j,inverse,actual:actual.cpu[i].inverse,expected:expected.wgs84}));
            }
            assert.equal(actual.gpu[i][4],1,`GPU valid ${fixture.template}/${fixture.earth_shape}/${i}`);
            const error=Math.abs(actual.gpu[i][3]-expected.value);gpuError=Math.max(gpuError,error);
            assert.ok(error<=.01,`GPU value ${fixture.template}/${fixture.earth_shape}/${i}: ${error}`);
        }
        report.cases.push({template:fixture.template,earth_shape:fixture.earth_shape,cpu_max_native_error:cpuError,gpu_max_error_K:gpuError,...actual});
    }
    report.status='passed';
}catch(error){report.status='failed';report.failure=String(error);process.exitCode=1;}
finally{
    if(call&&socket?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}}
    socket?.close();
    for(let i=0;i<100&&child?.exitCode===null;i++)await delay(50);
    if(child?.exitCode===null)child.kill();
    for(let i=0;i<100&&child?.exitCode===null;i++)await delay(50);
    await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    report.cleanup={browser_stopped:!child||child.exitCode!==null,profile_removed:true};
    await writeFile(join(directory,'browser.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({directory,status:report.status,failure:report.failure,cleanup:report.cleanup}));
}
