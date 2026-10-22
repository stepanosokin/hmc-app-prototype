import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {navigationDelays} from './viewer-navigation.mjs';

// Real responses/uploads are delayed by the shared navigation probe. HTTP faults
// below are explicitly synthetic additions; successful fields are never replaced.
const faults=`(()=>{const fetchOriginal=window.fetch;
    window.__timeFault=0;
    window.fetch=(input,options)=>window.__timeFault&&String(input).endsWith('/native.json')
        ?Promise.resolve(new Response('',{status:window.__timeFault})):fetchOriginal(input,options);
})()`;

export async function checkTimeSwitch({call,evaluate,wait,select,click,capture,origin,report,directory,android=false}){
    await call('Page.addScriptToEvaluateOnNewDocument',{source:navigationDelays+';\n'+faults});
    await call('Page.navigate',{url:origin+'/?validation=1'});
    const ready=()=>wait('window.captureWeatherEvidence?.().ready','complete time selection');
    await ready();
    assert.equal(await evaluate('typeof window.__timeFault'), 'number','Fault probe installed');
    const result={scope:'Actual ICON-EU +1/+3 h through gateway/GPU; synthetic delays, HTTP 503/410 only',modes:[],numerical:[]};
    report.time_switch=result;
    for(const [mode,projectionIndex] of [['mercator',0],['orthographic',1],['laea',2]]){
        await click('#settings');await select('#projection',true,projectionIndex);await ready();
        await select('#time',true,0);await ready();
        if(!await evaluate("document.getElementById('drawer').hidden"))await click('#closeDrawer');
        const target=await evaluate("(()=>{const r=[...document.querySelectorAll('.mapLabel')].find(e=>e.textContent.includes('Москва')).getBoundingClientRect();return {x:r.x+3,y:r.y+3};})()");
        if(android){await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...target,id:1}]});await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
        else{await call('Input.dispatchMouseEvent',{type:'mousePressed',...target,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...target,button:'left',clickCount:1});}
        await wait('window.captureWeatherEvidence().point!=null','point before time switch');
        await click('#settings');
        await evaluate("window.__timeCanvas=document.querySelector('.maplibregl-canvas');window.__timeLabels=[...document.querySelectorAll('.mapLabel')]");
        const before=await capture(true),drawer=await evaluate("({hidden:document.getElementById('drawer').hidden,pointMode:document.getElementById('drawer').className})");
        const contextRequests=()=>report.requests.filter(r=>!r.url.includes('/api/')&&!r.url.includes('/ogc/')).length;
        const baselineRequests=contextRequests();let maxManaged=before.managed_bytes;
        const checkContext=async()=>{
            assert.equal(await evaluate("window.__timeCanvas===document.querySelector('.maplibregl-canvas')&&window.__timeLabels.every(e=>e.isConnected)"),true,'Map canvas and labels survive');
            const state=await capture(true);
            maxManaged=Math.max(maxManaged,state.managed_bytes);assert.ok(state.managed_bytes<=128*1024**2);
            assert.equal(contextRequests(),baselineRequests,'No context assets reloaded');
            assert.equal(state.mode,mode);assert.deepEqual(state.position,before.position);
            assert.deepEqual(state.view.origin,before.view.origin);assert.equal(state.view.scale,before.view.scale);
            assert.deepEqual(state.view.center,before.view.center);
            assert.deepEqual(await evaluate("({hidden:document.getElementById('drawer').hidden,pointMode:document.getElementById('drawer').className})"),drawer);
            return state;
        };
        const record=async()=>{const state=await capture(true);result.numerical.push({view:state.view,point:state.point,position:state.position,selected:state.selected});};
        await record();
        const races=[];
        for(const stage of ['fetch','decode','upload']){
            await evaluate(`Object.assign(window.__navigationGate,{stage:${JSON.stringify(stage)},hit:false,released:false,resume:null})`);
            await select('#time',true,2);await wait('window.__navigationGate.hit','held time '+stage);
            const loading=await checkContext();
            assert.equal(loading.time_state,'loading');assert.equal(loading.displayed.selection,before.displayed.selection);
            assert.equal(loading.point,undefined);
            assert.match(await evaluate("document.getElementById('valid').textContent"),/01:00/);
            assert.match(await evaluate("document.getElementById('timeLabel').textContent"),/03:00.*загружается/);
            if(stage==='fetch'){
                await evaluate('window.__navigationGate.resume()');await ready();
                await wait('window.captureWeatherEvidence().point!=null','new time point');
                const shown=await checkContext();assert.equal(shown.displayed.valid_time,'2026-10-15T03:00:00Z');
                assert.equal(shown.point.selection,shown.displayed.selection);await record();
            }else{
                await select('#time',true,0);
                if(stage==='upload')assert.equal(await evaluate('window.__navigationGate.textureDeleted'),true);
                await evaluate('window.__navigationGate.resume()');await ready();
                assert.equal((await capture()).displayed.selection,before.displayed.selection);
                assert.equal(await evaluate('window.__navigationGate.retiredWrites??0'),0);
            }
            races.push({stage,history:await evaluate('window.__navigationGate.history.splice(0)'),last_selection_wins:true});
            await evaluate('window.__navigationGate.stage=null');
            await select('#time',true,0);await ready();
        }
        await evaluate("Object.assign(window.__navigationGate,{stage:'point',hit:false,released:false,resume:null})");
        await select('#time',true,2);await ready();await wait('window.__navigationGate.hit','held time point');
        await select('#time',true,0);await ready();await wait('window.captureWeatherEvidence().point!=null','last time point');
        await evaluate('window.__navigationGate.resume()');
        await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
        assert.equal((await capture()).point.selection,before.selected.selection);
        await evaluate('window.__navigationGate.stage=null');
        await select('#time',true,1);
        const gap=await capture();assert.equal(gap.ready,false);assert.equal(gap.point,undefined);assert.deepEqual(gap.position,before.position);
        assert.equal(gap.displayed,undefined);
        assert.equal(await evaluate("window.__timeCanvas===document.querySelector('.maplibregl-canvas')"),true);
        await select('#time',true,0);await ready();
        // Exercise the other existing visible controls through trusted input.
        await click('#next');assert.equal((await capture()).time_state,'missing');
        await click('#next');await ready();assert.equal((await capture()).selected.valid_time,'2026-10-15T03:00:00Z');
        await click('#previous');assert.equal((await capture()).time_state,'missing');
        await click('#previous');await ready();
        await click('#timelinePanel>summary');
        await click('#timeRange');
        for(const key of ['End','Home']){
            await call('Input.dispatchKeyEvent',{type:'keyDown',key});await call('Input.dispatchKeyEvent',{type:'keyUp',key});
            await ready();
        }
        await click('#settings');
        await evaluate('window.__timeFault=503');await select('#time',true,2);
        await wait("window.captureWeatherEvidence().time_state==='error'",'synthetic HTTP failure');
        const failure=await checkContext();assert.equal(failure.displayed.selection,before.displayed.selection);assert.equal(failure.point,undefined);
        assert.match(await evaluate("document.getElementById('notice').textContent"),/Не удалось.*01:00/);
        await evaluate('window.__timeFault=410');await click('#retry');
        await wait("window.captureWeatherEvidence().time_state==='expired'",'synthetic publication expiry');
        assert.equal((await capture()).displayed,undefined);assert.equal((await capture()).point,undefined);
        await evaluate('window.__timeFault=0');await click('#retry');await ready();
        await wait('window.captureWeatherEvidence().point!=null','point after recovery');
        const final=await checkContext();assert.equal(final.selected.revision,before.selected.revision);
        const memory=await evaluate('({maxArrays:window.__navigationGate.maxArrays,maxArrayBytes:window.__navigationGate.maxArrayBytes,retiredWrites:window.__navigationGate.retiredWrites??0})');
        assert.ok(memory.maxArrays<=2);assert.equal(memory.retiredWrites,0);
        result.modes.push({mode,races,memory,max_managed_bytes:maxManaged,context_asset_requests_unchanged:true,camera_map_point_panel_preserved:true,gap_clears:true,error_retains_labelled_frame:true,expiry_hides:true});
        const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,'time-switch-'+mode+'.png'),Buffer.from(shot.data,'base64'));
    }
    report.checks.push('T25 three projections: same map/camera/point/panel, complete frames, fetch/decode/upload/point races, missing/error/expiry');
}
