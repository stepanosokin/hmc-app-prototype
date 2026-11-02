// Actual viewer integration, using public controls and canonical point responses.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkPyramid({evaluate,call,directory}){
    const pause=ms=>new Promise(r=>setTimeout(r,ms)),rows=[];
    const capture=()=>evaluate('captureWeatherEvidence()');
    async function ready(field){
        let s;
        for(let i=0;i<1200;i++){
            s=await capture();
            if(s.time_state==='error'||s.renderer_error||s.contours?.state==='error')throw Error(JSON.stringify(s));
            if(s.ready&&(!field||s.displayed.field_short_name===field)&&['ready','empty'].includes(s.contours.state)&&!s.contours.worker_active&&s.wind_overlay.state==='ready')return s;
            await pause(100);
        }
        throw Error('Live pyramid readiness: '+JSON.stringify(s));
    }
    async function click(selector){
        const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
        for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...p});
    }
    async function select(selector,value){
        const idx=await evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).options).findIndex(o=>o.value===${JSON.stringify(String(value))})`);
        assert.ok(idx>=0,'Available select value '+value);await click(selector);
        for(const key of ['Home',...Array(idx).fill('ArrowDown'),'Enter'])for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:{Home:36,ArrowDown:40,Enter:13}[key]});
        await pause(300);
    }
    const initial=await ready();assert.ok(initial.contours.stats.surface,'Production surface worker');
    const metadata=await evaluate("fetch(captureWeatherEvidence().displayed.native_display.replace('/display/3/','/display/4/8/')).then(r=>r.json())");
    assert.equal(metadata.display_level,8);assert.deepEqual(initial.contours.native_grid.shape_yx,metadata.grid.shape_yx);
    assert.equal(initial.contours.stats.surface.postprocess,'none; Float64 screen coordinates');
    assert.equal(initial.wind_overlay.paused,false);assert.ok(initial.wind_overlay.arrows.visible>0);
    const paints=initial.wind_overlay.arrows.paints;await pause(400);assert.ok((await capture()).wind_overlay.arrows.paints>paints,'Wind particles painted over time');
    const windRequests=await evaluate(`(async()=>{const s=captureWeatherEvidence(),{compactGroups}=await import('/build/catalogue.js'),groups=compactGroups(await(await fetch('/api/v1/catalogue?view=compact')).json()),u=groups.flatMap(g=>g.times).find(p=>p?.selection===s.wind_overlay.selection);return {selections:[u.selection,u.wind_v.selection],urls:performance.getEntriesByType('resource').map(e=>new URL(e.name).pathname).filter(p=>p.includes('/display/4/8/'))};})()`);
    for(const id of windRequests.selections){assert.ok(windRequests.urls.includes('/api/v1/selections/'+id+'/display/4/8/native.json'),'Wind ×8 metadata loaded');assert.ok(windRequests.urls.some(p=>p.startsWith('/api/v1/selections/'+id+'/display/4/8/native/')),'Wind ×8 blocks loaded');}
    for(const field of ['t','prmsl','tp']){
        const receipt=JSON.parse(await readFile('data/reports/pyramid79/final-chrome/'+field+'-preparation.json','utf8'));
        const identity=await evaluate(`fetch('/api/v1/selections/${receipt.selection}/display/3/native.json').then(r=>r.json()).then(m=>m.identity)`);
        const groups=await evaluate("Array.from(document.querySelectorAll('#fieldButtons button')).map(b=>b.id)");
        let found=false;
        for(const id of groups){await click('#'+id);const selector='.fieldOption[data-field="'+identity.field+'"]';
            if(await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)){await click(selector);found=true;break;}}
        assert.ok(found,'Field control '+field);await ready(field);
        await select('#projection','mercator');await ready(field);await click('#fit');await pause(300);await ready(field);
        const pixel=await evaluate("(()=>{const s=captureWeatherEvidence(),g=s.view_geometry,p=proj4('EPSG:4326','EPSG:3857').forward([37.6173,55.7558]),r=document.querySelector('.maplibregl-canvas').getBoundingClientRect(),dpr=g.width/r.width;return{x:r.x+(g.origin[0]+p[0]*g.scale)/dpr,y:r.y+(g.origin[1]-p[1]*g.scale)/dpr};})()");
        for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...pixel});
        let state;
        for(let i=0;i<1800;i++){state=await capture();if(state.series.entries.length&&!state.series.busy&&state.wind_overlay.point_entries.length&&!state.wind_overlay.point_entries.some(e=>e.state==='loading'))break;await pause(100);}
        assert.ok(state.series.entries.some(e=>e.state==='value'));assert.ok(!state.series.entries.some(e=>e.state==='error'||e.state==='loading'));
        assert.ok(state.wind_overlay.point_entries.length&&!state.wind_overlay.point_entries.some(e=>e.state==='error'||e.state==='loading'),'Whole canonical wind series completed');
        const reference=await evaluate(`(async()=>{const s=captureWeatherEvidence(),out=[];for(const e of s.series.entries){if(!e.selection)continue;const p=e.selection,q=new URLSearchParams({selection:p.selection,run:p.run,revision:p.revision,valid_time:p.valid_time,layer:p.field,lon:String(s.position.lng),lat:String(s.position.lat),crs:'http://www.opengis.net/def/crs/OGC/1.3/CRS84'});const r=await fetch('/api/v1/point?'+q);if(!r.ok)throw Error('Canonical point '+r.status);out.push(await r.json());}return out;})()`);
        for(const result of reference){const entry=state.series.entries.find(e=>e.result?.selection===result.selection);assert.ok(entry);assert.deepEqual(entry.result,result);}
        assert.ok(await evaluate("Boolean(document.querySelector('#pointContent .realPointChart svg'))"),'Forecast chart exists');
        const windReference=await evaluate(`(async()=>{const s=captureWeatherEvidence(),{compactGroups}=await import('/build/catalogue.js'),{pointValue}=await import('/build/series.js'),{nativePosition}=await import('/build/source-crs.js'),{earthComponents}=await import('/build/wind.js'),{windValue}=await import('/build/wind-values.js');const groups=compactGroups(await(await fetch('/api/v1/catalogue?view=compact')).json()),g=groups.find(g=>g.times.some(p=>p?.selection===s.wind_overlay.selection));if(!g)throw Error('Wind group unavailable');const m=await(await fetch(g.selection.native_display)).json(),out=[];for(const e of s.wind_overlay.point_entries){if(e.state!=='value')continue;const p=g.times.find(p=>p&&Date.parse(p.valid_time)===Date.parse(e.time));const a=await pointValue(p,s.position,new AbortController().signal),b=await pointValue(p.wind_v,s.position,new AbortController().signal),[w,south]=m.grid.outer_cell_edges_wsen,[dx,dy]=m.grid.spacing_degrees_xy,xy=[w+(a.cell.column+.5)*dx,south+(a.cell.row+.5)*dy],ll=nativePosition(m.source_crs,xy,true),v=earthComponents(a.value,b.value,m,xy,ll,p=>nativePosition(m.source_crs,p,true));out.push({time:e.time,...windValue(v.east,v.north)});}return out;})()`);
        assert.ok(windReference.length);for(const expected of windReference){const actual=state.wind_overlay.point_entries.find(e=>e.time===expected.time);assert.equal(actual.speed,expected.speed);assert.equal(actual.direction,expected.direction);}
        const screenshot=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,field+'-point.png'),Buffer.from(screenshot.data,'base64'));
        await click('#closePoint');
        for(const mode of field==='t'?['laea-rf','laea','orthographic','mercator']:['laea-rf']){
            await select('#projection',mode);state=await ready(field);assert.equal(state.mode,mode);assert.ok(state.managed_bytes<=128*1024**2);assert.ok(state.contours.stats.surface);
            const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,field+'-'+mode+'.png'),Buffer.from(shot.data,'base64'));
            rows.push({field,mode,selection:state.displayed,bytes:state.transfer_bytes,load_ms:state.load_ms,contours:state.contours,wind:state.wind_overlay,canonical_points:reference.length,canonical_wind_points:windReference.length,managed_bytes:state.managed_bytes});
        }
        const before=state.displayed.selection,next=await evaluate("Array.from(document.getElementById('time').options).find(o=>!o.disabled&&o.value!==document.getElementById('time').value)?.value");
        assert.ok(next!==undefined);await select('#time',next);state=await ready(field);assert.notEqual(state.displayed.selection,before,'Forecast time switches');
    }
    return {status:'passed',rows,windRequests,scope:'Live ×8 raster/contours/wind; original point/chart and wind series; actual controls, four projections, field/time changes'};
}
