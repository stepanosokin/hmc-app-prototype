import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/** Visible controls, real public endpoints and an actual clipboard on the same origin. */
export async function checkSourceSettings({call,evaluate,wait,click,select,capture,report,directory,width,height,origin}){
    const ready=()=>wait('window.captureWeatherEvidence().ready','settings field ready');
    const links=()=>evaluate(`(()=>{const by=id=>document.getElementById(id);return {wms:by('wmsLink').getAttribute('href'),api:by('apiLink').getAttribute('href'),technical:by('metadataLink').getAttribute('href'),text:by('metadata').textContent,rows:by('metadata').querySelectorAll('dt').length,point:by('linkPoint').textContent};})()`);
    await click('#settings');let current=await capture(),value=await links();
    assert.ok(value.wms&&value.api&&value.technical,'Settings expose real WMS/API/metadata links');
    assert.match(value.point,/Пример — центр покрытия/);assert.ok(value.rows>=10&&value.text.length<2000);
    assert.ok(!value.text.includes('"dimensions"')&&!value.text.includes('"links"'),'No raw JSON dump');
    const checkIdentity=(value,state)=>{
        const wms=new URL(value.wms),api=new URL(value.api);
        assert.equal(wms.origin,origin);assert.equal(api.origin,origin);
        assert.ok(decodeURIComponent(wms.pathname).includes('/runs/'+state.selected.run+'/revisions/'+state.selected.revision+'/wms'));
        assert.equal(wms.searchParams.get('REQUEST'),'GetCapabilities');
        for(const key of ['selection','run','revision','valid_time'])assert.equal(api.searchParams.get(key),state.selected[key]);
        assert.ok(!/[?&](?:key|token|api_key)=/i.test(value.wms+value.api));
    };
    checkIdentity(value,current);
    const endpoint=await evaluate(`(async()=>{const wms=await fetch(document.getElementById('wmsLink').href),xml=await wms.text(),api=await fetch(document.getElementById('apiLink').href),point=await api.json(),metadata=await fetch(document.getElementById('metadataLink').href);
        const documentXml=new DOMParser().parseFromString(xml,'application/xml'),name=[...documentXml.querySelectorAll('Layer > Name')].at(-1)?.textContent;
        const map=new URL(document.getElementById('wmsLink').href);map.search=new URLSearchParams({SERVICE:'WMS',VERSION:'1.3.0',REQUEST:'GetMap',LAYERS:name,STYLES:'',CRS:'EPSG:4326',BBOX:'45,15,55,25',WIDTH:'8',HEIGHT:'8',FORMAT:'image/png',TIME:point.valid_time});const image=await fetch(map);
        return {wms:wms.status,xml:xml.includes('WMS_Capabilities'),api:api.status,point,metadata:metadata.status,map:image.status,map_type:image.headers.get('Content-Type')};})()`);
    assert.equal(endpoint.wms,200);assert.ok(endpoint.xml);assert.equal(endpoint.api,200);assert.notEqual(endpoint.point.value,null);assert.equal(endpoint.metadata,200);assert.equal(endpoint.map,200);assert.match(endpoint.map_type,/image\/png/);
    await call('Browser.setPermission',{permission:{name:'clipboard-read'},setting:'granted',origin});
    for(const kind of ['wms','api']){
        await click('#'+kind+'Copy');await wait("document.getElementById('copyStatus').textContent==='Адрес скопирован.'",'URL copied');
        assert.equal(await evaluate('navigator.clipboard.readText()'),value[kind]);
    }
    const item={width,height,initial:value,endpoints:{wms:endpoint.wms,api:endpoint.api,metadata:endpoint.metadata,map:endpoint.map,map_type:endpoint.map_type},clipboard:true};
    const gap=await evaluate("[...document.querySelectorAll('#time option')].findIndex(o=>o.textContent.includes('отсутствует'))");
    if(gap>=0){
        await select('#time',true,gap);await wait("window.captureWeatherEvidence().time_state==='missing'",'missing settings time');
        value=await links();assert.equal(value.api,null);assert.equal(value.technical,null);assert.ok(value.wms);assert.match(value.point,/Срок отсутствует/);item.missing_time=value;
    }
    await select('#time',true,2);await ready();value=await links();checkIdentity(value,await capture());
    await click('#settings');await select('#run',false,0);await ready();await click('#settings');value=await links();checkIdentity(value,await capture());
    await select('#run',true,0);await ready();await click('#settings');
    // A chosen point, rather than the default sample, supplies API coordinates.
    await click('#closeDrawer');
    const pixel=await evaluate(`(()=>{const g=window.captureWeatherEvidence(true).view,p=proj4('EPSG:4326','EPSG:3857').forward([37.6,55.7]),dpr=g.width/document.querySelector('.maplibregl-canvas').getBoundingClientRect().width;return {x:(g.origin[0]+p[0]*g.scale)/dpr,y:(g.origin[1]-p[1]*g.scale)/dpr};})()`);
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
        await evaluate(`(()=>{const original=fetch;window.__settingsOriginalFetch=original;window.fetch=async(input,options)=>{if(String(input).endsWith('/native.json')){window.__settingsHeld=true;await new Promise(resolve=>window.__settingsRelease=resolve);return new Response('{}',{status:503});}return original(input,options);};})()`);
        await select('#time',true,2);await wait('window.__settingsHeld','held settings field load');
        current=await capture();value=await links();assert.equal(current.time_state,'loading');assert.notEqual(current.displayed.valid_time,current.selected.valid_time);assert.ok(!value.api,'No old coverage sample for loading field');assert.match(value.text,/Загрузка/);
        await evaluate('window.__settingsRelease()');await wait("window.captureWeatherEvidence().time_state==='error'",'settings field error');
        value=await links();assert.ok(value.wms);assert.match(value.text,/Ошибка загрузки/);assert.ok(!value.api);
        await evaluate('window.fetch=window.__settingsOriginalFetch');await click('#retry');await ready();
        await evaluate("window.fetch=async(input,options)=>String(input).endsWith('/native.json')?new Response('{}',{status:410}):window.__settingsOriginalFetch(input,options)");
        await select('#time',true,0);await wait("window.captureWeatherEvidence().time_state==='expired'",'settings publication expiry');
        value=await links();assert.equal(value.api,null);assert.equal(value.wms,null);assert.equal(value.technical,null);
        item.loading_error_expiry=true;
    }
    report.checks.push(`${width}x${height}: real scoped WMS/API/metadata, clipboard, missing time, revision/point changes, both fonts/basemaps`);
}
