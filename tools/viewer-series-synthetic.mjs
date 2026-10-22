import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Native Android range may emit trusted input/change without a compatibility click.
export async function previewSeriesTime({call,evaluate,wait,click,android,host,index}){
    const selector=host+' .realPointChart input';
    if(android){
        const rect=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();e.scrollIntoView({block:'center'});const s=e.getBoundingClientRect();window.__seriesRangeEvent=null;e.addEventListener('input',event=>window.__seriesRangeEvent={trusted:event.isTrusted,value:e.value},{once:true});return {x:s.left+8+(s.width-16)*${index}/Number(e.max),y:s.top+s.height/2};})()`);
        await call('Input.synthesizeTapGesture',{...rect,duration:50,gestureSourceType:'touch'});
        await wait(`window.__seriesRangeEvent?.trusted&&document.querySelector(${JSON.stringify(selector)}).value==='${index}'`,'trusted graph range preview');
    }else{
        await click(selector);
        for(const key of ['Home',...Array(index).fill('ArrowRight')]){
            await call('Input.dispatchKeyEvent',{type:'keyDown',key});await call('Input.dispatchKeyEvent',{type:'keyUp',key});
        }
    }
}

// Supplements actual 24-time checks. Only the named cases replace real bytes.
const fixtures=`(()=>{
    const original=fetch;
    window.__seriesSynthetic={mode:'gaps',held:false,released:false,calls:[],release:null};
    window.fetch=async(input,options)=>{
        const url=String(input),test=window.__seriesSynthetic;
        if(url==='/api/v1/catalogue'){
            const response=await original(input,options),body=await response.json();
            if(test.mode==='reselect-hold'&&!test.catalogueHeld){test.catalogueHeld=true;await new Promise(resolve=>test.releaseCatalogue=resolve);test.catalogueReleased=true;}
            body.selections=body.selections.filter(s=>!s.valid_time.endsWith('02:00:00Z'));
            return Response.json(body);
        }
        if(!url.includes('/point?'))return original(input,options);
        test.calls.push(url);
        const time=new URL(url,location.origin).searchParams.get('valid_time');
        if(test.mode==='all-error'||test.mode==='gaps'&&time.endsWith('05:00:00Z'))return new Response('{}',{status:503});
        if(test.mode==='expired')return new Response('{}',{status:410});
        const response=await original(input,{...options,signal:undefined});
        // Preserve gateway errors and Retry-After so the real client can retry.
        if(!response.ok)return response;
        if(test.mode==='gaps'&&time.endsWith('06:00:00Z')&&!test.held){
            test.held=true;await new Promise(resolve=>test.release=resolve);test.released=true;
        }
        if(test.mode==='gaps'&&(time.endsWith('03:00:00Z')||time.endsWith('04:00:00Z'))){
            const body=await response.json();body.value=null;body.reason=time.endsWith('03:00:00Z')?'native_nodata':'outside_coverage';body.cell=null;
            return Response.json(body);
        }
        return response;
    };
})()`;

export async function checkSeriesSynthetic({call,evaluate,wait,select,click,capture,origin,report,directory,android,width}){
    if(width!==1440&&!android)return;
    const {identifier}=await call('Page.addScriptToEvaluateOnNewDocument',{source:fixtures});
    await call('Page.navigate',{url:origin+'/?validation=1'});
    const ready=()=>wait('window.captureWeatherEvidence?.().ready','synthetic fixture real field');
    await ready();
    const mobile=await evaluate("matchMedia('(max-width:700px), (max-height:600px) and (orientation:landscape)').matches");
    const host='#mobilePoint';
    const pick=async(lon,lat)=>{
        const pixel=await evaluate(`(()=>{const g=window.captureWeatherEvidence(true).view,p=proj4('EPSG:4326','EPSG:3857').forward([${lon},${lat}]),dpr=g.width/document.querySelector('.maplibregl-canvas').getBoundingClientRect().width;return {x:(g.origin[0]+p[0]*g.scale)/dpr,y:(g.origin[1]-p[1]*g.scale)/dpr};})()`);
        if(android)await call('Input.synthesizeTapGesture',{...pixel,duration:50,gestureSourceType:'touch'});
        else {await call('Input.dispatchMouseEvent',{type:'mousePressed',...pixel,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...pixel,button:'left',clickCount:1});}
    };
    await pick(37.6,55.7);await wait('window.__seriesSynthetic.held','old point response held');
    const oldPosition=(await capture()).position;
    if(!mobile)await click('#showPoint');
    const loading=await evaluate(`document.querySelector(${JSON.stringify(host+' .realPointChart p')}).textContent`);assert.match(loading,/Загрузка/);
    await click('#closeDrawer');await pick(35,55);
    await wait('window.captureWeatherEvidence().series.entries.length===24&&!window.captureWeatherEvidence().series.busy','new point partial series');
    const before=await capture(),key=before.series.key;
    await evaluate('window.__seriesSynthetic.release()');await wait('window.__seriesSynthetic.released','retired response released');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    let state=await capture();assert.equal(state.series.key,key);assert.notDeepEqual(state.position,oldPosition);
    assert.deepEqual(state.series.entries.slice(0,6).map(e=>e.state),['value','missing','native_nodata','outside_coverage','error','value']);
    if(!mobile)await click('#showPoint');
    // Select the gap through the graph's keyboard interface; it clears map and number.
    assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(host+' svg path')}).length`),18,'No line crosses the four known gaps');
    await previewSeriesTime({call,evaluate,wait,click,android,host,index:1});
    await click(host+' .realPointChart button:not([hidden])');
    await wait("window.captureWeatherEvidence().time_state==='missing'",'graph selects gap');
    state=await capture();assert.equal(state.frame_visible,false);assert.equal(state.point,undefined);
    assert.equal(state.series.key,key);assert.match(await evaluate(`document.querySelector(${JSON.stringify(host+' .realPointChart output')}).textContent`),/Срок отсутствует/);
    await click('#next');await ready();
    assert.equal((await capture()).point.reason,'native_nodata');
    await click('#next');await ready();assert.equal((await capture()).point.reason,'outside_coverage');
    const count=await evaluate('window.__seriesSynthetic.calls.length');
    await evaluate("window.__seriesSynthetic.mode='expired'");await click(host+' .realPointChart button:last-child');
    await wait('window.captureWeatherEvidence().series.expired','expiry invalidates series');
    state=await capture();assert.ok(state.series.entries.every(e=>!e.result));assert.equal(state.frame_visible,false);
    assert.equal(await evaluate('window.__seriesSynthetic.calls.length'),count+1);
    await click(host+' svg');
    assert.equal(await evaluate('window.__seriesSynthetic.calls.length'),count+1,'Expired graph cannot retry');
    const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,'series-synthetic-expired.png'),Buffer.from(shot.data,'base64'));
    report.series_synthetic={loading,states:before.series.entries.map(e=>e.state),late_response_rejected:true,gap_clears_map:true,
        expired_clears_values:true,expired_requires_reselection:true,scope:'Synthetic gaps/nodata/outside/503/410/delay supplement real data'};
    await evaluate("window.__seriesSynthetic.mode='reselect-hold'");await click('#settings');await click('#retry');
    await wait('window.__seriesSynthetic.catalogueHeld','held expired reselect catalogue');
    await select('#run',true,1);await ready();const newChoice=(await capture()).selected;
    await evaluate('window.__seriesSynthetic.releaseCatalogue()');await wait('window.__seriesSynthetic.catalogueReleased','late catalogue released');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal((await capture()).selected.selection,newChoice.selection,'Late reselect cannot override a newer run choice');
    report.series_synthetic.late_reselect_rejected=true;
    await call('Page.removeScriptToEvaluateOnNewDocument',{identifier});
    const full=await call('Page.addScriptToEvaluateOnNewDocument',{source:fixtures.replace("mode:'gaps'","mode:'all-error'")});
    await call('Page.navigate',{url:origin+'/?validation=1'});await ready();await pick(37.6,55.7);
    await wait('window.captureWeatherEvidence().series.entries.length===24&&!window.captureWeatherEvidence().series.busy','full series failure');
    if(!mobile)await click('#showPoint');
    assert.match(await evaluate(`document.querySelector(${JSON.stringify(host+' .realPointChart p')}).textContent`),/Не удалось загрузить ряд/);
    await evaluate("window.__seriesSynthetic.mode='ready'");await click(host+' .realPointChart button:last-child');
    await wait('window.captureWeatherEvidence().series.entries.filter(e=>e.state==="value").length===23&&!window.captureWeatherEvidence().series.busy','full retry succeeds');
    report.series_synthetic.full_error_retry=true;
    await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:full.identifier});
    report.checks.push('T27 synthetic loading/gaps/nodata/outside/partial/late point/expiry');
}
