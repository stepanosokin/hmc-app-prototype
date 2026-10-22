import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {checkSeriesSynthetic,previewSeriesTime} from './viewer-series-synthetic.mjs';

export async function checkPointSeries({call,evaluate,wait,select,click,capture,origin,report,directory,android,width,height}){
    const ready=()=>wait('window.captureWeatherEvidence().ready','GPU field');
    const complete=()=>wait('window.captureWeatherEvidence().series.entries.length===24&&!window.captureWeatherEvidence().series.busy','24 canonical times');
    const pick=async(lon,lat)=>{
        const pixel=await evaluate(`(()=>{const g=window.captureWeatherEvidence(true).view,p=proj4('EPSG:4326','EPSG:3857').forward([${lon},${lat}]),dpr=g.width/document.querySelector('.maplibregl-canvas').getBoundingClientRect().width;return {x:(g.origin[0]+p[0]*g.scale)/dpr,y:(g.origin[1]-p[1]*g.scale)/dpr};})()`);
        if(android)await call('Input.synthesizeTapGesture',{...pixel,duration:50,gestureSourceType:'touch'});
        else {await call('Input.dispatchMouseEvent',{type:'mousePressed',...pixel,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...pixel,button:'left',clickCount:1});}
    };
    const mobile=await evaluate("matchMedia('(max-width:700px), (max-height:600px) and (orientation:landscape)').matches");
    const host='#mobilePoint';
    // Only HTTP failure is synthetic; every successful value keeps real gateway bytes.
    await evaluate(`(()=>{const original=fetch;window.__seriesFault=3;window.__seriesCalls=[];window.fetch=async(input,options)=>{
        const url=String(input);if(url.includes('/point?')){window.__seriesCalls.push(url);const t=new URL(url,location.origin).searchParams.get('valid_time');
        if(window.__seriesFault===3&&t.endsWith('03:00:00Z'))return new Response('{}',{status:503});}
        return original(input,options);};})()`);
    await pick(37.6,55.7);await complete();
    const checkGraph=async host=>{
        const state=await capture(),entries=state.series.entries;
        const expectedPoints=entries.filter(e=>e.state==='value').length;
        const expectedSegments=entries.slice(1).filter((e,i)=>e.state==='value'&&entries[i].state==='value').length;
        const graph=await evaluate(`(()=>{const chart=document.querySelector(${JSON.stringify(host+' .realPointChart')}),svg=chart.querySelector('svg'),r=svg.getBoundingClientRect();return {visible:svg.checkVisibility(),width:r.width,height:r.height,points:svg.querySelectorAll('.seriesValue,.selectedValue').length,segments:svg.querySelectorAll('.forecastLine').length};})()`);
        assert.ok(graph.visible&&graph.width>0&&graph.height>0,'Point graph has a visible SVG area: '+host);
        assert.equal(graph.points,expectedPoints,'Every canonical value is drawn: '+host);
        assert.equal(graph.segments,expectedSegments,'Only adjacent values are joined: '+host);
        (report.point_graphs??=[]).push({host,expectedPoints,expectedSegments,...graph});
    };
    // Check the map popup before opening the separate point drawer on desktop.
    await checkGraph(mobile?host:'#pointContent');
    if(!mobile)await click('#showPoint');
    let state=await capture();assert.equal(state.series.entries.filter(e=>e.state==='value').length,23);
    assert.equal(state.series.entries[2].state,'error');assert.equal(state.series.requests,24);
    assert.equal(await evaluate(`${JSON.stringify(host)}&&document.querySelector(${JSON.stringify(host+' .realPointChart p')}).textContent.includes('Частичный')`),true);
    const count=await evaluate('window.__seriesCalls.length');
    await evaluate('window.__seriesFault=0');await click(host+' .realPointChart button:last-child');await complete();
    state=await capture();assert.equal(state.series.requests,25);assert.equal(state.series.entries.filter(e=>e.state==='value').length,24);
    await checkGraph(host);
    assert.equal(await evaluate('window.__seriesCalls.length'),count+1);
    const identity=state.series.key;
    const reuseCount=await evaluate('window.__seriesCalls.length');
    await click('#settings');await select('#units',true,1);await click('#sheetPoint');
    assert.match(await evaluate(`document.querySelector(${JSON.stringify(host+' .realPointChart output')}).textContent`),/ K/);
    await click('#settings');await select('#units',true,0);await click('#sheetPoint');
    assert.equal(await evaluate('window.__seriesCalls.length'),reuseCount,'Units reuse canonical kelvin values');
    const result={width,height,physical_android:android,position:state.position,entries:state.series.entries,
        requests:state.series.requests,elapsed_ms:state.series.elapsed_ms,modes:[],synthetic:'HTTP 503 for +3 h; successful responses are real'};
    (report.point_series??=[]).push(result);
    for(const [mode,projectionIndex] of [['mercator',0],['orthographic',1],['laea',2]]){
        if(projectionIndex){await click('#settings');await select('#projection',true,projectionIndex);await ready();await click('#showPoint');}
        if(mobile&&await evaluate("document.getElementById('drawer').hidden"))await click('#showPoint');
        const before=await capture();assert.equal(before.series.key,identity);
        const requests=await evaluate('window.__seriesCalls.length');
        if(!android){
            const rect=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(host+' svg')}).getBoundingClientRect();return {x:r.left+r.width*.4,y:r.top+r.height*.5};})()`);
            const selection=(await capture()).selected.selection;
            await call('Input.dispatchMouseEvent',{type:'mouseMoved',...rect});
            assert.equal((await capture()).selected.selection,selection,'Hover never changes time');
        }
        // Hover/keyboard preview must not change selection; Enter is explicit.
        const selected=(await capture()).selected.selection;
        await previewSeriesTime({call,evaluate,wait,click,android,host,index:android?11:23});
        assert.equal((await capture()).selected.selection,selected);
        assert.match(await evaluate(`document.querySelector(${JSON.stringify(host+' .realPointChart output')}).textContent`),/UTC/);
        if(android){
            const rect=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(host+' svg')}).getBoundingClientRect();return {x:r.left+r.width*252/264,y:r.top+r.height/2};})()`);
            await call('Input.synthesizeTapGesture',{...rect,duration:50,gestureSourceType:'touch'});
        }else{
            await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter'});
        }
        await ready();await wait("window.captureWeatherEvidence().point?.valid_time==='2026-10-16T00:00:00Z'",'last exact time from cached series');
        state=await capture(true);assert.equal(state.selected.valid_time,state.point.valid_time);assert.equal(state.displayed.selection,state.point.selection);
        assert.equal(await evaluate("document.getElementById('timeRange').value"),'23');
        assert.equal(await evaluate('window.__seriesCalls.length'),requests,'Time switch reuses the series');
        assert.ok(state.managed_bytes<=128*1024**2);
        const geometry=await evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(host+' .realPointChart')}),r=c.getBoundingClientRect(),s=c.querySelector('svg').getBoundingClientRect(),d=document.getElementById('drawer').getBoundingClientRect(),t=document.getElementById('timelinePanel').getBoundingClientRect(),b=document.getElementById('closeDrawer').getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,svg_width:s.width,scroll:document.documentElement.scrollWidth,drawer:{top:d.top,bottom:d.bottom,left:d.left,right:d.right},time:{top:t.top,bottom:t.bottom},close:{top:b.top,bottom:b.bottom,left:b.left,right:b.right}};})()`);
        assert.ok(geometry.left>=0&&geometry.right<=geometry.width+1&&geometry.scroll<=geometry.width+1);
        assert.ok(geometry.drawer.bottom<=geometry.time.top,'Point panel does not cover time');
        assert.ok(geometry.close.top>=geometry.drawer.top&&geometry.close.bottom<=geometry.drawer.bottom,'Collapse remains visible while graph scrolls');
        result.modes.push({mode,input:android?'trusted touch range and SVG':'keyboard and mouse preview',selection:state.selected,point:state.point,displayed:state.displayed,managed_bytes:state.managed_bytes,geometry});
        const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,`series-${width}x${height}-${mode}.png`),Buffer.from(shot.data,'base64'));
    }
    await checkSeriesSynthetic({call,evaluate,wait,select,click,capture,origin,report,directory,android,width});
    report.checks.push(`${width}x${height}: T27 24 raw canonical times, partial failure/retry, keyboard preview/select, three projections, bounded reuse and layout`);
}
