import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {navigationDelays} from './viewer-navigation.mjs';

export async function checkUpdates({call,evaluate,wait,select,click,capture,origin,report,directory,android=false}){
    const project=process.env.T15_PROJECT;
    assert.match(project,/^hmc-publication-t13-[a-z0-9-]+$/);
    const service=(operation='publish')=>execFileSync('powershell',[
        '-NoProfile','-File','tools/publish-viewer-update.ps1','-Project',project,'-Operation',operation
    ],{windowsHide:true,timeout:180000,stdio:'pipe'});
    if(!android)await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,mobile:false,deviceScaleFactor:1});
    await call('Page.addScriptToEvaluateOnNewDocument',{source:navigationDelays});
    await call('Page.navigate',{url:origin+'/?validation=1&fixtures=1'});
    await wait('window.captureWeatherEvidence?.().ready','update baseline');
    const results={races:[],layouts:[],failures:[],platform:android?'physical Android':'desktop with emulated phone'};
    report.updates=results;
    const shot=async name=>{const image=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,'updates-'+name+'.png'),Buffer.from(image.data,'base64'));};
    const prototype=await readFile('docs/prototypes/weather-map.prototype.html');
    results.mockup={path:'docs/prototypes/weather-map.prototype.html',sha256:createHash('sha256').update(prototype).digest('hex'),
        comparison:['initially collapsed phone sheet','point/settings transitions','accessible time bar','compact panels','Russian UTC/projection controls']};
    const ready=()=>wait('window.captureWeatherEvidence().ready','complete field');
    const chooseRun=async key=>{
        await click('#settings');
        const index=await evaluate(`[...document.getElementById('run').options].findIndex(o=>o.value===${JSON.stringify(key)})`);
        assert.ok(index>=0);await select('#run',true,index);await ready();
    };
    await click('#settings');
    const actual=await evaluate("[...document.getElementById('run').options].findIndex(o=>JSON.parse(o.value)[1].startsWith('ICON-EU/')&&!o.textContent.includes('Тест'))");
    await select('#run',true,actual);await ready();
    const baselineKey=await evaluate("document.getElementById('run').value");
    await select('#time',true,2);await ready();
    const before=await capture();results.before=before.selected;
    const pick=async(waitPoint=true)=>{
        const p=await evaluate("(()=>{const r=[...document.querySelectorAll('.mapLabel')].find(e=>e.textContent.includes('Москва')).getBoundingClientRect();return {x:r.x+3,y:r.y+3};})()");
        if(android){await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
        else{await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});}
        if(waitPoint)await wait('window.captureWeatherEvidence().point!=null','canonical point');
    };
    await pick();const oldPoint=(await capture()).point,oldPosition=(await capture()).position;
    service();
    await click('#settings');await click('#refresh');
    await wait("!document.getElementById('acceptUpdate').hidden",'revision notification');
    assert.equal((await capture()).selected.selection,before.selected.selection);
    assert.equal((await capture()).point.selection,oldPoint.selection);
    await shot('unaccepted');await click('#declineUpdate');
    assert.equal((await capture()).selected.selection,before.selected.selection);results.declined=true;
    await click('#refresh');
    service('outage');
    try{
        await click('#acceptUpdate');
        await wait("document.getElementById('updateStatus').textContent.includes('Не удалось принять')",'failed update');
        assert.equal((await capture()).ready,true);assert.equal((await capture()).selected.selection,before.selected.selection);
        assert.equal((await capture()).point.selection,oldPoint.selection);
        results.failures.push('real API outage during revision load preserves field and point');
        await click('#refresh');
        await wait("document.getElementById('updateStatus').textContent.includes('Не удалось проверить')",'failed catalogue');
        assert.equal(await evaluate("document.getElementById('acceptUpdate').hidden"),true);
        await shot('service-failure');results.failures.push('real catalogue failure clears obsolete acceptance action');
    }finally{service('recover');}
    await wait("fetch('/api/v1/catalogue').then(r=>r.ok)",'API recovery');await click('#refresh');
    for(const stage of ['fetch','decode','upload']){
        await evaluate(`Object.assign(window.__navigationGate,{stage:${JSON.stringify(stage)},hit:false,released:false,resume:null,textureDeleted:false,retiredWrites:0})`);
        await click('#acceptUpdate');await wait('window.__navigationGate.hit','held update '+stage);
        assert.equal((await capture()).selected.selection,before.selected.selection);
        assert.equal((await capture()).ready,true,'Old layer remains usable during staging');
        if(stage==='upload'){
            await click('#declineUpdate');
            assert.equal(await evaluate('window.__navigationGate.textureDeleted'),true,'Exact staged texture deleted');
        }else await select('#projection',true,stage==='fetch'?1:2);
        await evaluate('window.__navigationGate.resume()');await ready();
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        assert.equal((await capture()).selected.selection,before.selected.selection);
        assert.equal(await evaluate('window.__navigationGate.retiredWrites'),0);
        results.races.push({stage,cancel:stage==='upload'?'decline':'projection',pinned:true,retired_texture:stage==='upload',history:await evaluate('window.__navigationGate.history.splice(0)')});
        await evaluate('window.__navigationGate.stage=null');await click('#refresh');
    }
    await select('#projection',true,0);await ready();
    await evaluate("Object.assign(window.__navigationGate,{stage:'point',hit:false,released:false,resume:null})");
    await pick(false);await wait('window.__navigationGate.hit','old mode point held');
    await select('#projection',true,1);await ready();
    await wait('window.captureWeatherEvidence().point!=null','new mode point');
    const newPoint=(await capture()).point;
    await evaluate('window.__navigationGate.resume();window.__navigationGate.stage=null');
    assert.deepEqual((await capture()).point,newPoint);results.races.push({stage:'point',cancel:'projection',pinned:true});
    await click('#west');const geometryBefore=(await capture(true)).view;
    await evaluate("Object.assign(window.__navigationGate,{stage:'upload',hit:false,released:false,resume:null,textureDeleted:false,retiredWrites:0})");
    await click('#acceptUpdate');await wait('window.__navigationGate.hit','staged globe update');
    await click('#west');const rotated=(await capture(true)).view;
    await evaluate('window.__navigationGate.resume()');
    await wait(`window.captureWeatherEvidence().ready&&window.captureWeatherEvidence().selected.revision!==${JSON.stringify(before.selected.revision)}`,'explicit revision refresh');
    await evaluate('window.__navigationGate.stage=null');
    const after=await capture(true);results.after=after.selected;
    assert.equal(after.selected.run,before.selected.run);assert.equal(after.selected.valid_time,before.selected.valid_time);
    assert.equal(after.view.cache_identity.identity.revision,after.selected.revision);
    assert.deepEqual(after.view.origin,rotated.origin);assert.equal(after.view.scale,rotated.scale);
    assert.deepEqual(after.view.center,rotated.center);assert.notDeepEqual(rotated.center,geometryBefore.center);
    assert.equal(after.point.revision,after.selected.revision);assert.equal(after.point.selection,after.selected.selection);
    assert.ok(Math.abs(after.point.value-oldPoint.value-1)<1e-6,'Labelled correction is exactly +1 K');
    assert.deepEqual(after.position,oldPosition);
    results.atomic={point:after.point,cache_identity:after.view.cache_identity,geometry_preserved:true,managed_bytes:after.managed_bytes};
    await shot('accepted-globe');
    await chooseRun(baselineKey);await select('#time',true,1);
    assert.equal((await capture()).selected,undefined);
    await click('#settings');await click('#refresh');await click('#acceptUpdate');
    await wait('window.captureWeatherEvidence().ready&&window.captureWeatherEvidence().selected.valid_time.includes("02:00")','explicit gap refresh');
    results.gap_refresh=(await capture()).selected;
    await click('#refresh');await click('#latestRun');
    await wait('window.captureWeatherEvidence().ready&&window.captureWeatherEvidence().selected.fixture==="overlap"','explicit new run');
    assert.equal((await capture()).selected.valid_time,'2026-10-15T01:00:00Z');
    assert.equal((await capture()).point,undefined);results.new_run=(await capture()).selected;
    const sizes=android?[await evaluate('[innerWidth,innerHeight]')]:[[390,844],[360,740],[640,360],[700,740],[701,740]];
    for(const [width,height] of sizes){
        if(!android)await call('Emulation.setDeviceMetricsOverride',{width,height,mobile:true,deviceScaleFactor:1});
        await call('Page.navigate',{url:origin+'/?validation=1&fixtures=1'});await ready();
        assert.equal(await evaluate("document.getElementById('drawer').hidden"),true);
        await pick();
        if(width<=700||height<=600){
            assert.equal(await evaluate("!document.getElementById('drawer').hidden&&document.getElementById('drawer').classList.contains('pointMode')"),true);
            await click('#sheetSettings');await click('#sheetPoint');await select('#time',true,2);await ready();
            assert.equal(await evaluate("document.getElementById('drawer').hidden"),false);
            const rectangles=await evaluate("(()=>{const a=document.getElementById('drawer').getBoundingClientRect(),b=document.getElementById('timelinePanel').getBoundingClientRect();return {sheet:{top:a.top,bottom:a.bottom,height:a.height},time:{top:b.top,bottom:b.bottom},utc:document.getElementById('compactTime').textContent};})()");
            assert.ok(rectangles.sheet.bottom<=rectangles.time.top,'Sheet/time do not overlap');
            assert.match(rectangles.utc,/UTC/);results.layouts.push({width,height,...rectangles});
            await shot(width+'x'+height+'-point-time');await click('#closeDrawer');
        }else results.layouts.push({width,height,desktop_breakpoint:true});
    }
    report.checks.push('T15 explicit updates, real failures, atomic point/GPU identity, stale work and responsive sheet');
}
