import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/** Pick an actual native coordinate whose map pixel is not covered by controls. */
export async function nativePointPixel(evaluate,mode){
    return evaluate(`(async()=>{const s=window.captureWeatherEvidence(),b=s.native_bounds,{nativePosition}=await import('/build/source-crs.js'),g=s.view_geometry;
        const mode=${JSON.stringify(mode)}??s.mode,spec=mode==='mercator'?'EPSG:3857':mode==='laea'?'EPSG:3576':mode==='laea-rf'?'hmc:laea-rf':
            '+proj=ortho +lat_0='+s.view_center[1]+' +lon_0='+s.view_center[0]+' +R=6378137';
        const canvas=document.querySelector('.maplibregl-canvas'),dpr=canvas.width/canvas.clientWidth;
        for(const [fx,fy] of [[.5,.5],[.35,.5],[.3,.35],[.25,.6],[.6,.65],[.5,.2]]){
            const p=nativePosition(s.source_crs,[b[0]+(b[2]-b[0])*fx,b[1]+(b[3]-b[1])*fy],true);
            if(mode==='laea'&&p[1]<45)continue;
            const q=proj4('EPSG:4326',spec).forward(p),pixel={x:(g.origin[0]+q[0]*g.scale)/dpr,y:(g.origin[1]-q[1]*g.scale)/dpr};
            if(!Number.isFinite(pixel.x)||!Number.isFinite(pixel.y))continue;
            if(document.elementFromPoint(pixel.x,pixel.y)?.classList.contains('maplibregl-canvas'))return pixel;
        }
        return null;})()`);
}

/** Real published indicators, visible buttons and responsive menus. */
export async function checkFieldGroups({call,evaluate,wait,click,select,capture,origin,report,directory}){
    report.field_controls=[];
    const waitSeries=async label=>{
        for(let i=0;i<600;i++){
            if(await evaluate('window.captureWeatherEvidence().point!=null&&!window.captureWeatherEvidence().series.busy'))return;
            await new Promise(resolve=>setTimeout(resolve,200));
        }
        throw Error('Timed out after 120 seconds: '+label);
    };
    for(const [width,height] of [[1440,900],[390,844],[360,740],[640,360]]){
        await call('Emulation.setDeviceMetricsOverride',{width,height,mobile:width<700,deviceScaleFactor:1});
        await call('Page.navigate',{url:origin+'/?validation=1'});
        await wait('window.captureWeatherEvidence?.().ready','field controls initial data');
        const scene={width,height,mobile_emulation:width<700,groups:[]};report.field_controls.push(scene);
        const names=await evaluate("[...document.querySelectorAll('#fieldButtons>button')].map(b=>b.textContent)");
        for(const required of ['Температура','Давление','Влажность','Ветер'])assert.ok(names.includes(required),required);
        const pixel=await nativePointPixel(evaluate);
        assert.ok(pixel,'An unobstructed point inside the published native footprint');
        await call('Input.dispatchMouseEvent',{type:'mousePressed',...pixel,button:'left',clickCount:1});
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',...pixel,button:'left',clickCount:1});
        await waitSeries('real point before changing fields');
        scene.initial_point=(await capture()).point;
        for(const [id,needle] of [['temperature','Температура на высоте 2 м'],['pressure','Давление на уровне моря'],['humidity','Относительная влажность'],['wind','Ветер на высоте 10 м']]){
            const before=await capture();await click('#field-group-'+id);
            const menu=await evaluate("(()=>{const e=document.querySelector('#fieldMenu'),r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,headings:[...e.querySelectorAll('h3')].map(h=>h.textContent),options:[...e.querySelectorAll('.fieldOption')].map(b=>({field:b.dataset.field,label:b.textContent})),scroll:document.documentElement.scrollWidth};})()");
            assert.ok(menu.left>=0&&menu.right<=width&&menu.top>=0&&menu.bottom<=height&&menu.scroll<=width,'Menu remains within viewport');
            assert.ok(menu.headings.length&&menu.options.length);
            const option=menu.options.find(o=>o.label.includes(needle));assert.ok(option,'Published indicator: '+needle);
            if(id==='temperature')assert.ok(menu.options.some(o=>o.label.includes('Температура поверхности')));
            if(id==='pressure')assert.ok(menu.options.some(o=>o.label.includes('Давление у поверхности')));
            const shot=await call('Page.captureScreenshot',{format:'png'});
            await writeFile(join(directory,`fields-${width}-${height}-${id}-menu.png`),Buffer.from(shot.data,'base64'));
            if(width===1440&&id==='wind')await evaluate(`(()=>{window.__t19FieldFetch=fetch;
                window.fetch=(input,options)=>String(input).endsWith('/native.json')?
                    Promise.resolve(new Response('{}',{status:503})):window.__t19FieldFetch(input,options);})()`);
            await click('.fieldOption[data-field="'+option.field+'"]');
            if(width===1440&&id==='wind'){
                await wait("window.captureWeatherEvidence().time_state==='error'",'supplementary field-load failure');
                await wait("!window.captureWeatherEvidence().series.busy&&window.captureWeatherEvidence().series.entries.some(e=>e.result?.value!=null)",'new canonical series beside retained field');
                const failed=await capture();
                assert.equal(failed.displayed.field,before.displayed.field,'Failed new field retains the previous map');
                assert.equal(failed.displayed.units,'%');
                const tooltip=await evaluate("document.querySelector('.realPointChart output').textContent");
                assert.ok(tooltip.includes('м/с')&&!tooltip.includes('%'),'Canonical wind series keeps its own units beside the humidity map');
                scene.field_load_failure_units={scope:'Explicit local 503 for native metadata; successful canonical point values remain real',
                    displayed:failed.displayed,series_units:failed.series.entries.find(e=>e.result)?.result.units,tooltip};
                await evaluate('window.fetch=window.__t19FieldFetch;delete window.__t19FieldFetch');
                await click('#settings');await click('#retry');await click('#closeDrawer');
            }
            await wait(`window.captureWeatherEvidence().ready&&window.captureWeatherEvidence().selected.field===${JSON.stringify(option.field)}`,'published field from sidebar');
            const after=await capture();assert.deepEqual(after.view_geometry,before.view_geometry,'Field choice preserves camera');
            assert.deepEqual(after.position,before.position,'Field choice preserves the point');
            assert.ok(after.position,'A selected geographic point must actually exist');
            await waitSeries('canonical series for new field');
            const point=await capture();assert.equal(point.point.field,point.selected.field);assert.equal(point.point.units,point.selected.units);
            if(before.selected.field!==point.selected.field)assert.notEqual(point.series.key,before.series.key,'Field choice replaces series identity');
            assert.equal(await evaluate("document.querySelector('#units').closest('label').hidden"),point.selected.units!=='K','Units control never shows kelvin for another quantity');
            assert.ok(after.managed_bytes<=128*1024**2);
            assert.equal(await evaluate("document.getElementById('fieldMenu').hidden"),true);
            if(id==='wind'){
                await new Promise(resolve=>setTimeout(resolve,500));
                const wind=await capture();assert.ok(wind.wind?.frames>1&&wind.wind.visible>0,'Arrows animate after wind choice');
                const shot=await call('Page.captureScreenshot',{format:'png'});
                await writeFile(join(directory,`fields-${width}-${height}-wind.png`),Buffer.from(shot.data,'base64'));
                scene.wind=wind.wind;
            }
            scene.groups.push({id,menu,selected:after.selected,managed_bytes:after.managed_bytes});
        }
        await click('#field-group-cloud');
        scene.cloud_layers=await evaluate("[...document.querySelectorAll('#fieldMenu .fieldOption')].map(b=>b.textContent)");
        for(const layer of ['слой 0–400 гПа','слой 400–800 гПа','слой 800 гПа — поверхность'])
            assert.ok(scene.cloud_layers.some(label=>label.includes(layer)),'Both real cloud-layer bounds: '+layer);
        const cloudShot=await call('Page.captureScreenshot',{format:'png'});
        await writeFile(join(directory,`fields-${width}-${height}-cloud-menu.png`),Buffer.from(cloudShot.data,'base64'));
        await click('#field-group-temperature');
        await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape'});
        assert.equal(await evaluate("document.getElementById('fieldMenu').hidden&&document.activeElement.id==='field-group-temperature'"),true,'Escape closes menu and restores focus');
        const options=await evaluate("[...document.querySelector('#run').options].map(o=>JSON.parse(o.value)[3])");
        assert.ok(options.every(field=>field===(scene.groups.at(-1).selected.field)),'Run control contains only the selected field');
        scene.heap=await call('Runtime.getHeapUsage');
        if(width===1440){
            await click('#settings');
            const models=await evaluate("[...document.querySelector('#model').options].map(o=>o.value)");
            const icon=models.indexOf('ICON-EU');assert.ok(icon>=0);
            await select('#model',true,icon);await wait('window.captureWeatherEvidence().ready','control model');
            assert.deepEqual(await evaluate("[...document.querySelectorAll('#fieldButtons>button')].map(b=>b.textContent)"),['Температура'],'Model switch replaces available groups');
        }
    }
    if(process.env.T19_CORPUS){
        const corpus=JSON.parse(await readFile(process.env.T19_CORPUS,'utf8'));
        const pinned=corpus.selections.find(s=>s.field_label==='Поле GRIB 0.3.1');assert.ok(pinned);
        await click('#field-group-pressure');await click('.fieldOption[data-field="'+pinned.field+'"]');
        await wait('window.captureWeatherEvidence().ready','pressure before retained revision choice');
        await click('#settings');
        const options=await evaluate("[...document.querySelector('#run').options].map(o=>JSON.parse(o.value))");
        const option=options.findIndex(key=>key[2]===pinned.revision&&key[3]===pinned.field);
        assert.ok(option>=0,'Pinned old revision remains in normalized discovery');
        await select('#run',true,option);
        await wait(`window.captureWeatherEvidence().ready&&window.captureWeatherEvidence().selected.revision===${JSON.stringify(pinned.revision)}`,'explicit retained revision');
        const before=await capture();await select('#time',true,1);
        await wait('window.captureWeatherEvidence().ready','retained revision next real time');
        const after=await capture();assert.equal(after.selected.revision,pinned.revision);
        assert.notEqual(before.selected.valid_time,after.selected.valid_time);
        // The full run also retains the nearly-complete previous revision:
        // exercise its long series alongside the pending latest catalogue.
        if(process.env.T19_COMPLETE_DATASET==='1'&&options.length>2){
            await click('#settings');await select('#run',true,1);
            await wait('window.captureWeatherEvidence().ready','long retained revision');
        }
        if(await evaluate("!document.querySelector('#drawer').hidden"))await click('#closeDrawer');
        const pixel=await nativePointPixel(evaluate);assert.ok(pixel,'Point for pending-catalogue memory observation');
        await call('Input.dispatchMouseEvent',{type:'mousePressed',...pixel,button:'left',clickCount:1});
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',...pixel,button:'left',clickCount:1});
        await waitSeries('retained series beside pending catalogue');
        const active=await capture();await click('#settings');
        const check=(await capture()).catalogue_checks;await click('#refresh');
        await wait(`window.captureWeatherEvidence().catalogue_checks>${check}`,'full catalogue beside selected old revision');
        const pending=await capture();assert.equal(pending.selected.revision,active.selected.revision);
        if(process.env.T19_COMPLETE_DATASET==='1')assert.equal(pending.catalogue_pending,true,'Full new catalogue stays pending beside the explicitly selected older revision');
        report.retained_revision={pinned_selection:after.selected,selection:pending.selected,revision_options:options.length,managed_bytes:pending.managed_bytes,
            pending:pending.catalogue_pending,series_entries:pending.series.entries.length,heap:await call('Runtime.getHeapUsage')};
    }
    report.checks.push('Right-side field groups, published variants/levels, model isolation, camera/point preservation, keyboard and four responsive viewports');
}
