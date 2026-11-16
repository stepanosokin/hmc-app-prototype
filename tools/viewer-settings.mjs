import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {nativePointPixel} from './viewer-fields.mjs';

/** The same catalogue names must be usable from ordinary field controls. */
export async function checkCatalogueSettings({call,evaluate,wait,click,select,capture,report,directory,width,height,origin}){
    await call('Browser.setPermission',{permission:{name:'clipboard-read'},setting:'granted',origin});
    const observations=[];let commonUrl;
    for(const [model,group,label,older] of [['WMS107-A','temperature','Температура на высоте',false],
        ['WMS107-A','wind','Скорость ветра',false],['WMS107-B','pressure','Давление на уровне моря',false],
        ['WMS107-A','temperature','Температура на высоте',true]]){
        const index=await evaluate(`[...document.querySelector('#model').options].findIndex(o=>o.value===${JSON.stringify(model)})`);
        assert.ok(index>=0,'Model is available in ordinary selector');
        await select('#model',true,index);
        await wait(`window.captureWeatherEvidence().selected?.model===${JSON.stringify(model)}&&window.captureWeatherEvidence().time_state==='ready'`,'catalogue model ready');
        // The catalogue is independent of the overlay. Retire its U/V requests
        // through the visible control before exercising public discovery slots.
        if(await evaluate("document.getElementById('windToggle').getAttribute('aria-pressed')==='true'&&!document.getElementById('windPanel').hidden")){
            await click('#windToggle');
        }
        await click('#field-group-'+group);
        await click('.fieldOption[aria-label^="'+label+'"]');
        await wait("window.captureWeatherEvidence().ready",'catalogue field ready');
        await click('#settings');
        if(older&&width>height&&await evaluate("!document.getElementById('updates').hidden")){
            await click('#declineUpdate');
            await wait("document.getElementById('updates').hidden",'publication notice dismissed before run selection');
        }
        if(older){
            const latest=await capture();await select('#run',false,0);
            await wait("window.captureWeatherEvidence().time_state==='ready'",'older catalogue run ready');
            assert.notEqual((await capture()).selected.run,latest.selected.run);
            await click('#settings');
        }
        await click('#wmsCopy');
        await wait("document.getElementById('copyStatus').textContent==='Адрес скопирован.'",'catalogue URL copied');
        const copied=await evaluate('navigator.clipboard.readText()');
        if(commonUrl)assert.equal(copied,commonUrl);commonUrl=copied;
        const observation=await evaluate(`(async()=>{
            const state=window.captureWeatherEvidence(),url=document.getElementById('wmsUrl').value,
                response=await fetch(url),xml=new DOMParser().parseFromString(await response.text(),'application/xml'),
                name=[...xml.querySelectorAll('Layer > Name')].find(n=>n.textContent===state.selected.wms_name),
                leaf=name?.parentElement,model=leaf?.parentElement.querySelector(':scope > Title')?.textContent,
                title=leaf?.querySelector(':scope > Title')?.textContent;
            return {status:response.status,url,name:name?.textContent,model,title,selected:state.selected,
                description:document.getElementById('linkSelection').textContent};})()`);
        assert.equal(observation.status,200);assert.ok(observation.name);assert.equal(observation.model,model);
        assert.ok(observation.title.startsWith(label),'The requested field was actually selected');
        assert.equal(observation.description,'Модель: '+model+' · Слой: '+observation.title);
        assert.equal(copied,observation.url);
        const screenshot=await call('Page.captureScreenshot',{format:'png'});
        await writeFile(join(directory,`catalogue-${model}-${group}-${older?'older':'latest'}-${width}x${height}.png`),Buffer.from(screenshot.data,'base64'));
        await click('#closeDrawer');await click('#wmsQuickCopy');
        await wait("document.getElementById('wmsQuickStatus').textContent==='Адрес скопирован.'",'catalogue quick URL copied');
        assert.equal(await evaluate('navigator.clipboard.readText()'),copied);
        observations.push(observation);
    }
    (report.catalogue_settings??=[]).push({width,height,observations});
    report.checks.push(`${width}x${height}: ordinary model/field selection, exact Russian catalogue names, both clipboard controls`);
}

/** Visible controls, real public endpoints and an actual clipboard on the same origin. */
export async function checkSourceSettings({call,evaluate,wait,click,select,capture,report,directory,width,height,origin}){
    const ready=()=>wait('window.captureWeatherEvidence().ready','settings field ready');
    const links=()=>evaluate(`(()=>{const by=id=>document.getElementById(id);return {wms:by('wmsLink').getAttribute('href'),api:by('apiLink').getAttribute('href'),technical:by('metadataLink').getAttribute('href'),text:by('metadata').textContent,rows:by('metadata').querySelectorAll('dt').length,point:by('linkPoint').textContent};})()`);
    await click('#settings');await wait("Boolean(document.getElementById('wmsUrl').value)",'common WMS link ready');let current=await capture(),value=await links();
    assert.ok(value.wms&&value.api&&value.technical,'Settings expose real WMS/API/metadata links');
    assert.match(value.point,/Пример — центр покрытия/);assert.ok(value.rows>=10&&value.text.length<2000);
    assert.ok(!value.text.includes('"dimensions"')&&!value.text.includes('"links"'),'No raw JSON dump');
    const checkIdentity=(value,state)=>{
        const wms=new URL(value.wms),api=new URL(value.api);
        assert.equal(wms.origin,origin);assert.equal(api.origin,origin);
        assert.equal(wms.pathname,'/gis/v1/wms');assert.ok(wms.searchParams.get('snapshot'));
        assert.equal(wms.searchParams.size,1);
        for(const key of ['selection','run','revision','valid_time'])assert.equal(api.searchParams.get(key),state.selected[key]);
        assert.ok(!/[?&](?:key|token|api_key)=/i.test(value.wms+value.api));
    };
    checkIdentity(value,current);
    const endpoint=await evaluate(`(async()=>{const wms=await fetch(document.getElementById('wmsLink').href),xml=await wms.text(),api=await fetch(document.getElementById('apiLink').href),point=await api.json(),metadata=await fetch(document.getElementById('metadataLink').href);
        const documentXml=new DOMParser().parseFromString(xml,'application/xml'),selected=window.captureWeatherEvidence().selected,
            node=[...documentXml.querySelectorAll('Layer > Name')].find(node=>node.textContent===selected.wms_name),name=node?.textContent,
            leaf=node?.parentElement,model=leaf?.parentElement?.querySelector(':scope > Title')?.textContent,
            title=leaf?.querySelector(':scope > Title')?.textContent;
        if(!name)throw Error('Выбранный вариант отсутствует в общем каталоге WMS');
        const map=new URL(document.getElementById('wmsLink').href);for(const [k,v] of Object.entries({SERVICE:'WMS',VERSION:'1.3.0',REQUEST:'GetMap',LAYERS:name,STYLES:'',CRS:'EPSG:4326',BBOX:'45,15,55,25',WIDTH:'8',HEIGHT:'8',FORMAT:'image/png',TIME:point.valid_time}))map.searchParams.set(k,v);const image=await fetch(map);
        return {wms:wms.status,xml:xml.includes('WMS_Capabilities'),api:api.status,point,metadata:metadata.status,map:image.status,map_type:image.headers.get('Content-Type'),
            catalogue:{name,model,title},description:document.getElementById('linkSelection').textContent};})()`);
    assert.equal(endpoint.wms,200);assert.ok(endpoint.xml);assert.equal(endpoint.api,200);assert.notEqual(endpoint.point.value,null);assert.equal(endpoint.metadata,200);assert.equal(endpoint.map,200);assert.match(endpoint.map_type,/image\/png/);
    assert.equal(endpoint.description,'Модель: '+endpoint.catalogue.model+' · Слой: '+endpoint.catalogue.title);
    await call('Browser.setPermission',{permission:{name:'clipboard-read'},setting:'granted',origin});
    for(const kind of ['wms','api']){
        await click('#'+kind+'Copy');await wait("document.getElementById('copyStatus').textContent==='Адрес скопирован.'",'URL copied');
        assert.equal(await evaluate('navigator.clipboard.readText()'),value[kind]);
    }
    await click('#closeDrawer');await click('#wmsQuickCopy');
    await wait("document.getElementById('wmsQuickStatus').textContent==='Адрес скопирован.'",'quick common WMS copied');
    assert.equal(await evaluate('navigator.clipboard.readText()'),value.wms);
    await click('#settings');
    assert.match(await evaluate("document.getElementById('sourceUnitsInfo').textContent"),/Общий WMS содержит последние опубликованные расчёты/);
    const item={width,height,initial:value,endpoints:{wms:endpoint.wms,api:endpoint.api,metadata:endpoint.metadata,map:endpoint.map,map_type:endpoint.map_type},clipboard:true};
    const gap=await evaluate("[...document.querySelectorAll('#time option')].findIndex(o=>o.textContent.includes('отсутствует'))");
    if(gap>=0){
        await select('#time',true,gap);await wait("window.captureWeatherEvidence().time_state==='missing'",'missing settings time');
        value=await links();assert.equal(value.api,null);assert.equal(value.technical,null);assert.ok(value.wms);assert.match(value.point,/Срок отсутствует/);item.missing_time=value;
    }
    await select('#time',true,2);await ready();value=await links();checkIdentity(value,await capture());
    await click('#settings');await select('#run',false,0);await ready();await click('#settings');value=await links();checkIdentity(value,await capture());
    assert.equal(value.wms,item.initial.wms,'Viewing an older run preserves the same latest-catalogue link');
    assert.match(await evaluate("document.getElementById('linkSelection').textContent"),/Модель:.*Слой:/);
    await select('#run',true,0);await ready();await click('#settings');
    // A chosen point, rather than the default sample, supplies API coordinates.
    await click('#closeDrawer');
    const pixel=await nativePointPixel(evaluate);assert.ok(pixel,'Visible settings point pixel');
    for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,...pixel,button:'left',clickCount:1});
    await wait('Boolean(window.captureWeatherEvidence().position)','settings point chosen');await click('#settings');value=await links();current=await capture();
    assert.match(value.point,/Выбранная точка/);const api=new URL(value.api);assert.equal(Number(api.searchParams.get('lon')),current.position.lng);assert.equal(Number(api.searchParams.get('lat')),current.position.lat);
    await click('#settingsBody details>summary');
    for(const font of [0,1])for(const base of [0,1]){
        await select('#font',true,font);await select('#basemap',true,base);
        await evaluate("document.querySelector('.connectionLinks').scrollIntoView({block:'center'})");
        const box=await evaluate("(()=>{const r=document.querySelector('.connectionLinks').getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,scroll:document.documentElement.scrollWidth};})()");
        assert.ok(box.left>=0&&box.right<=box.width+1&&box.scroll<=box.width+1);
        const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,`settings-${width}x${height}-font${font}-base${base}.png`),Buffer.from(shot.data,'base64'));
    }
    await evaluate("document.getElementById('metadata').scrollIntoView({block:'center'})");
    const metadataShot=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,`settings-metadata-${width}x${height}.png`),Buffer.from(metadataShot.data,'base64'));
    item.selected_point=value;(report.source_settings??=[]).push(item);
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape'});
    await click('#settings');assert.match((await links()).point,/Пример — центр покрытия/);
    if(width===1440){
        await evaluate(`(()=>{const original=fetch;window.__settingsOriginalFetch=original;window.fetch=async(input,options)=>{if(String(input).endsWith('/native.json')){window.__settingsRevisionHeld=true;await new Promise(resolve=>window.__settingsRevisionRelease=resolve);}return original(input,options);};})()`);
        await select('#run',false,0);await wait('window.__settingsRevisionHeld','held settings revision load');
        current=await capture();value=await links();assert.equal(current.selected.valid_time,current.displayed.valid_time);assert.notEqual(current.selected.revision,current.displayed.revision);
        assert.match(value.text,/Показан прежний кадр/);assert.ok(value.text.includes(current.displayed.revision.slice(0,12)));assert.ok(value.text.includes(current.selected.revision.slice(0,12)));
        await evaluate('window.__settingsRevisionRelease()');await ready();await evaluate('window.fetch=window.__settingsOriginalFetch');
        await click('#settings');await select('#run',true,0);await ready();await click('#settings');item.same_time_revision=true;
        await evaluate(`(()=>{const original=fetch;window.__settingsOriginalFetch=original;window.fetch=async(input,options)=>{if(String(input).endsWith('/native.json')){window.__settingsHeld=true;await new Promise(resolve=>window.__settingsRelease=resolve);return new Response('{}',{status:503});}return original(input,options);};})()`);
        await select('#time',true,2);await wait('window.__settingsHeld','held settings field load');
        current=await capture();value=await links();assert.equal(current.time_state,'loading');assert.notEqual(current.displayed.valid_time,current.selected.valid_time);assert.ok(!value.api,'No old coverage sample for loading field');assert.match(value.text,/Загрузка/);
        await evaluate('window.__settingsRelease()');await wait("window.captureWeatherEvidence().time_state==='error'",'settings field error');
        value=await links();assert.ok(value.wms);assert.match(value.text,/Ошибка загрузки/);assert.ok(!value.api);
        await evaluate('window.fetch=window.__settingsOriginalFetch');await click('#retry');await ready();
        await evaluate("window.fetch=async(input,options)=>String(input).endsWith('/native.json')?new Response('{}',{status:410}):window.__settingsOriginalFetch(input,options)");
        await select('#time',true,0);await wait("window.captureWeatherEvidence().time_state==='expired'",'settings publication expiry');
        value=await links();assert.equal(value.api,null);assert.ok(value.wms);assert.equal(value.technical,null);
        item.loading_error_expiry=true;
    }
    report.checks.push(`${width}x${height}: common pinned WMS, both clipboard controls, API/metadata, older run explanation, missing time, both fonts/basemaps`);
}
