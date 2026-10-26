import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {nativePointPixel} from './viewer-fields.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const camera=state=>{
    assert.ok(Number.isFinite(state.map_zoom),'Actual MapLibre zoom is recorded');
    return {map_zoom:state.map_zoom,view_geometry:state.view_geometry,view_center:state.view_center};
};
const percentiles=values=>{
    const sorted=values.toSorted((a,b)=>a-b);
    return Object.fromEntries([.5,.95,.99].map(p=>[String(p),sorted.length?sorted[Math.ceil(p*sorted.length)-1]:null]));
};

/** Actual map/browser work; source arrays and images remain distinct representations. */
export async function measureViewer({call,evaluate,wait,click,select,capture,origin,report,directory,width,height}){
    const baseline=process.env.T19_PORTRAYAL==='1',rounds=Number(process.env.T19_ROUNDS||3);
    const corpus=JSON.parse(await readFile(process.env.T19_CORPUS,'utf8'));
    assert.ok(Number.isInteger(rounds)&&rounds>=1&&rounds<=10);
    const settle=async expression=>{
        for(let i=0;i<600;i++){if(await evaluate(expression))return;await pause(200);}
        throw Error('T19: browser operation exceeded 120 seconds: '+expression);
    };
    const rendered="window.captureWeatherEvidence().ready&&window.captureWeatherEvidence().rendered?.selection===window.captureWeatherEvidence().selected.selection";
    const view={observed_start:new Date().toISOString(),width,height,portrayal_baseline:baseline,physical_mobile:false,measurements:[],field_changes:[]};report.viewports.push(view);
    report.scope='T19 actual desktop browser workload; Android deferred to #51; cache placement and driver overhead declared';
    view.network_scope={viewer_origin:origin,transport:'local workstation loopback; no browser network throttling',production_network:false};
    const pinned=corpus.selections.find(s=>s.field_label==='Поле GRIB 0.3.1');
    const matches=(option,selection)=>{const key=JSON.parse(option.value);return key[2]===selection.revision&&key[3]===selection.field;};
    assert.ok(pinned&&corpus.wind_selection,'Pinned representative pressure and U/V pair');
    const sources=baseline?[['scalar',pinned]]:[['scalar',pinned],['wind',corpus.wind_selection]];
    await call('Performance.enable');
    for(const [kind,selection] of sources){
        // Set the current field's revision first, so the sidebar chooses its
        // sibling in that exact revision rather than whichever finished latest.
        const prior=await capture();
        if(prior.selected.revision!==selection.revision){
            await click('#settings');
            const roots=await evaluate("[...document.querySelector('#run').options].map(o=>JSON.parse(o.value))");
            const root=roots.findIndex(key=>key[2]===selection.revision);assert.ok(root>=0);
            await select('#run',true,root);await settle(rendered);
        }
        if(kind==='scalar'){
            const before=await capture();
            const offset=(Date.parse(selection.valid_time)-Date.parse(before.selected.valid_time))/3600000;
            const time=(await evaluate("Number(document.querySelector('#time').value)"))+offset;
            if(offset!==0){await select('#time',true,time);await settle(rendered);}
        }
        if(await evaluate("!document.querySelector('#drawer').hidden"))await click('#closeDrawer');
        await click('#field-group-'+(kind==='wind'?'wind':'pressure'));
        const screenshot=await call('Page.captureScreenshot',{format:'png'});
        await writeFile(join(directory,`field-menu-${kind}.png`),Buffer.from(screenshot.data,'base64'));
        const fieldStart=await evaluate('performance.now()');
        await click('.fieldOption[data-field="'+selection.field+'"]');
        await settle(rendered);
        const completeField=await capture();
        assert.equal(completeField.selected.revision,selection.revision);
        assert.equal(completeField.selected.field,selection.field);
        if(kind==='scalar')assert.equal(completeField.selected.selection,selection.selection,'Numeric and image field timing use exactly the pinned selection');
        view.field_changes.push({kind,complete_field_ms:(await evaluate('performance.now()'))-fieldStart,
            identity:completeField.selected,rendered:completeField.rendered,
            latency_scope:'visible field option input to exact layer MapLibre render event; includes automation/poll overhead, not a GPU timer or physical presentation timestamp'});
        await click('#settings');
        const options=await evaluate("[...document.querySelector('#run').options].map(o=>({value:o.value}))");
        const option=options.findIndex(o=>matches(o,selection));assert.ok(option>=0,'Pinned revision remains selectable for this field');
        await select('#run',true,option);
        await settle(rendered);
        for(const [mode,index] of [['mercator',0],['orthographic',1],['laea',2]]){
            const observedStart=new Date().toISOString();
            await click('#settings');const modeStart=await evaluate('performance.now()');
            await select('#projection',true,index);await settle(`${rendered}&&window.captureWeatherEvidence().rendered.mode===${JSON.stringify(mode==='orthographic'?'hmc:orthographic':mode==='laea'?'EPSG:3576':'mercator')}`);
            await click('#closeDrawer');
            const modeState=await capture();
            const modeResult={kind,mode,observed_start:observedStart,load_ms:modeState.load_ms,mode_switch_ms:(await evaluate('performance.now()'))-modeStart,
                initial_frame_rendered_at_ms:modeState.first_complete_ms,transfer_bytes:modeState.transfer_bytes,managed_bytes:modeState.managed_bytes,
                decode_ms:modeState.decode_timings,wind_decode_ms:modeState.wind_decode_timings,upload_timings:modeState.upload_timings,
                identity:modeState.selected,camera:camera(modeState),actions:[]};
            assert.ok(modeResult.managed_bytes<=128*1024**2,'Combined managed resource budget');
            // Choose the real native coverage centre, not a colour-derived value.
            const target=await nativePointPixel(evaluate,mode);
            if(target&&target.x>0&&target.y>0&&target.x<width&&target.y<height){
                await call('Input.dispatchMouseEvent',{type:'mousePressed',...target,button:'left',clickCount:1});
                await call('Input.dispatchMouseEvent',{type:'mouseReleased',...target,button:'left',clickCount:1});
                await settle('!window.captureWeatherEvidence().series.busy');
            }
            const beforeSeries=await capture();
            assert.ok(beforeSeries.position&&beforeSeries.series.entries.some(e=>e.state==='value'),'A real canonical point series is visible');
            for(let round=0;round<rounds;round++){
                const old=await capture(),begin=await evaluate('performance.now()');
                await evaluate("window.__t19Canvas=document.querySelector('.maplibregl-canvas')");
                const next=await evaluate("(()=>{const e=document.querySelector('#time'),values=[...e.options].filter(o=>!o.textContent.includes('отсутствует')).map(o=>Number(o.value));return values[(values.indexOf(Number(e.value))+1)%values.length];})()");
                await select('#time',true,next);await settle(rendered);
                const state=await capture();
                assert.notEqual(state.selected.selection,old.selected.selection,'Time changes to another real field');
                assert.ok(state.managed_bytes<=128*1024**2);
                assert.equal(state.series.key,beforeSeries.series.key,'Time-only navigation reuses the canonical point series');
                assert.deepEqual(state.position,old.position,'Time navigation preserves the point');
                assert.deepEqual(state.view_geometry,old.view_geometry,'Time navigation preserves camera and projection');
                assert.equal(state.map_zoom,old.map_zoom,'Time navigation preserves zoom');
                assert.equal(await evaluate("window.__t19Canvas===document.querySelector('.maplibregl-canvas')"),true,'Time navigation preserves the map canvas');
                modeResult.actions.push({round,elapsed_ms:(await evaluate('performance.now()'))-begin,rendered:state.rendered,load_ms:state.load_ms,
                    transfer_bytes:state.transfer_bytes,managed_bytes:state.managed_bytes,series:state.series,camera:camera(state),
                    decode_ms:state.decode_timings,upload_timings:state.upload_timings,wind:state.wind});
            }
            const targetPixel=await evaluate(`(()=>{const points=[[.4,.45],[.5,.3],[.65,.35],[.7,.7],[.3,.5]];
                return points.map(([x,y])=>({x:x*${width},y:y*${height}})).find(p=>[p.x,p.x-60].every(x=>document.elementFromPoint(x,p.y)?.classList.contains('maplibregl-canvas')));})()`);
            assert.ok(targetPixel,'Drag must start and end over the real map canvas');
            const beforeDrag=await capture();
            const dragStart=await evaluate('performance.now()'),sx=targetPixel.x,sy=targetPixel.y;
            await call('Input.dispatchMouseEvent',{type:'mousePressed',x:sx,y:sy,button:'left',clickCount:1});
            for(let i=1;i<=60;i++){await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:sx-i,y:sy+i/4,button:'left',buttons:1});await pause(16);}
            await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:sx-60,y:sy+15,button:'left',clickCount:1});
            const beforeWheel=await capture();
            await call('Input.dispatchMouseEvent',{type:'mouseWheel',x:sx,y:sy,deltaY:-100,deltaX:0});await pause(1000);
            const state=await capture(),frames=state.render_times_ms.filter(t=>t>=dragStart);
            modeResult.performance_observed_end=new Date().toISOString();
            assert.notEqual(state.map_zoom,beforeWheel.map_zoom,'Wheel input changes actual map zoom');
            modeResult.navigation={before_drag:camera(beforeDrag),before_wheel:camera(beforeWheel),after_wheel:camera(state)};
            const intervals=frames.slice(1).map((t,i)=>t-frames[i]);
            modeResult.frame_ms=percentiles(intervals);modeResult.frame_samples=intervals.length;
            modeResult.median_fps=modeResult.frame_ms['0.5']?1000/modeResult.frame_ms['0.5']:null;
            modeResult.wind=state.wind;modeResult.managed_bytes_after=state.managed_bytes;
            modeResult.heap=await call('Runtime.getHeapUsage');
            modeResult.gpu_memory={observed_bytes:null,reason:'Browser exposes no exact per-layer GPU counter; managed bytes are estimates including declared textures and framebuffer'};
            modeResult.point_series=state.series;
            const screenshot=await call('Page.captureScreenshot',{format:'png'});
            await writeFile(join(directory,`t19-${width}-${height}-${kind}-${mode}.png`),Buffer.from(screenshot.data,'base64'));
            if(kind==='wind')assert.ok(state.wind?.frames>1&&state.wind?.visible>0,'Real U/V arrows animate in the selected projection');
            // Explicit faults supplement real data; they are excluded from the
            // performance samples above but remain under the same HTTP load.
            const selection=state.selected.selection;
            await evaluate("(()=>{window.__t19Context=document.querySelector('.maplibregl-canvas').getContext('webgl2').getExtension('WEBGL_lose_context');window.__t19Context.loseContext();})()");
            await settle('window.captureWeatherEvidence().context_lost');
            await evaluate('window.__t19Context.restoreContext();delete window.__t19Context');
            await settle('window.captureWeatherEvidence().ready&&!window.captureWeatherEvidence().context_lost');
            assert.equal((await capture()).selected.selection,selection);
            assert.ok((await capture()).managed_bytes<=128*1024**2);
            modeResult.context_loss_restored=true;
            modeResult.observed_end=new Date().toISOString();view.measurements.push(modeResult);
            await writeFile(join(directory,'workload-progress.json'),JSON.stringify(view,null,2)+'\n');
        }
        // One canonical point request fails; every successful response remains
        // real gateway data. Only the failed entry is retried.
        await click('#settings');await select('#projection',true,0);await settle('window.captureWeatherEvidence().ready');await click('#closeDrawer');
        const faultTime=(await capture()).series.entries.find(e=>e.selection)?.selection.valid_time;
        assert.ok(faultTime);
        await evaluate(`(()=>{window.__t19Fetch=fetch;window.__t19FaultTime=${JSON.stringify(faultTime)};
            window.fetch=(input,options)=>{const url=String(input);if(url.includes('/point?')&&new URL(url,location.origin).searchParams.get('valid_time')===window.__t19FaultTime)
                return Promise.resolve(new Response('{}',{status:503}));return window.__t19Fetch(input,options);};})()`);
        await click('#showPoint');await click('#clearMobilePoint');
        // The preceding projection/pan measurements may leave all probe cells
        // offscreen. This fault supplement starts from the data coverage.
        await click('#fit');await pause(500);
        const pixel=await nativePointPixel(evaluate);assert.ok(pixel,'Unobstructed canonical point for the failure/retry check');
        await call('Input.dispatchMouseEvent',{type:'mousePressed',...pixel,button:'left',clickCount:1});
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',...pixel,button:'left',clickCount:1});
        await settle("!window.captureWeatherEvidence().series.busy&&window.captureWeatherEvidence().series.entries.some(e=>e.state==='error')");
        const partial=await capture();assert.ok(partial.series.entries.some(e=>e.state==='value'));
        await evaluate('window.__t19FaultTime=null');await click('#showPoint');await click('#mobilePoint .realPointChart button:last-child');
        await settle("!window.captureWeatherEvidence().series.busy&&!window.captureWeatherEvidence().series.entries.some(e=>e.state==='error')");
        const recovered=await capture();assert.equal(recovered.series.requests,partial.series.requests+1);
        view.measurements.push({kind,synthetic_http_fault:'503 for one canonical time; successful data unchanged',partial_series:partial.series,recovered_series:recovered.series});
        // An expired selection must clear the frame and values until explicit reselection.
        await evaluate("window.fetch=(input,options)=>String(input).endsWith('/native.json')?Promise.resolve(new Response('{}',{status:410})):window.__t19Fetch(input,options)");
        const next=await evaluate("(()=>{const e=document.querySelector('#time'),v=[...e.options].filter(o=>!o.textContent.includes('отсутствует')).map(o=>Number(o.value));return v[(v.indexOf(Number(e.value))+1)%v.length];})()");
        await click('#settings');await select('#time',true,next);await settle("window.captureWeatherEvidence().time_state==='expired'");
        const expired=await capture();assert.equal(expired.frame_visible,false);assert.equal(expired.point,undefined);
        view.measurements.push({kind,synthetic_http_fault:410,expired_frame_cleared:true,managed_bytes:expired.managed_bytes});
        await evaluate('window.fetch=window.__t19Fetch;delete window.__t19Fetch');
    }
    view.observed_end=new Date().toISOString();
    report.checks.push('T19 desktop scalar/image comparator and real U/V arrow measurements');
}
