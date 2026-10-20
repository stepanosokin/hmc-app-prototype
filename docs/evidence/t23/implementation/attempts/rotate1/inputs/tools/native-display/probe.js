import * as maplibre from '/vendor/maplibre-gl.mjs';
import {create,clippedLine} from '/geometry-probe.js';
import {NativeLayer,nativeToWgs} from '/native-layer.js';
import {OrthographicContext} from '/orthographic-context.js';

const status=document.getElementById('status'),delay=ms=>new Promise(r=>setTimeout(r,ms));
let orthoCenter=[20,50];
const orthoDefinition=()=>`+proj=ortho +lat_0=${orthoCenter[1]} +lon_0=${orthoCenter[0]} +R=6378137 +units=m +no_defs`;
let ortho=orthoDefinition();
const displayDefinition=mode=>mode==='EPSG:3576'?'EPSG:3576':mode==='mercator'?'EPSG:3857':ortho;
const visible=position=>{
    if(activeMode==='EPSG:3576')return position.lat>=45;
    if(activeMode!=='hmc:orthographic')return true;
    const phi=position.lat*Math.PI/180,phi0=orthoCenter[1]*Math.PI/180;
    return Math.sin(phi)*Math.sin(phi0)+Math.cos(phi)*Math.cos(phi0)*Math.cos((position.lng-orthoCenter[0])*Math.PI/180)>0;
};
let data,map,layer,activeMode,labels=[];
let pendingPick,pointController,selectedPosition,selectedMarker,selectedMarkerHandler;
let displayUnits='K',selectedPoint;
const fieldController=new AbortController();
function pointStatus(point) {
    const value=point.value===null?'Нет значения в точке.':
        (point.value-(displayUnits==='°C'?273.15:0)).toFixed(2)+' '+displayUnits+' · ближайшая нативная ячейка';
    status.textContent=(activeMode==='EPSG:3576'?'Показано к северу от 45° с. ш. · ':'')+value;
}
async function get(url) {
    for(let attempt=0;attempt<6;attempt++) {
        const response=await fetch(url,{signal:AbortSignal.any([fieldController.signal,AbortSignal.timeout(30000)])});
        if(response.status===429){await delay(500);continue;}
        if(!response.ok)throw Error('Числовое поле недоступно. Повторите позже.');
        return response;
    }
    throw Error('Сервис занят. Повторите позже.');
}
async function load(prepare) {
    const start=performance.now(),reference=await (await fetch('/reference.json')).json();
    const metaResponse=await get(reference.metadata_url),metadata=await metaResponse.json();
    if(metadata.contract!=='hmc-native-display/1'||metadata.selection!==reference.selection.selection)
        throw Error('Несогласованный числовой контракт.');
    if(metadata.selection_identity.some(key=>metadata.identity[key]!==reference.selection[key]))
        throw Error('Изменилась неизменяемая выборка прогноза.');
    const prepared=prepare(metadata);
    const blocks=new Array(18);let next=0,bytes=new TextEncoder().encode(JSON.stringify(metadata)).length;
    const timings=[];
    async function worker() {
        while(next<18){
            const i=next++,column=i%6,row=Math.floor(i/6);
            const url=metadata.url.replace('{column}',column).replace('{row}',row),before=performance.now();
            const payload=await (await get(url)).arrayBuffer();
            if(payload.byteLength!==332820)throw Error('Повреждённый числовой блок.');
            const values=new Float32Array(payload,0,258*258),mask=new Uint8Array(payload,258*258*4);
            for(let j=0;j<values.length;j++)if(!Number.isFinite(values[j])||mask[j]>1||mask[j]===0&&values[j]!==0)
                throw Error('Недопустимое значение или маска блока.');
            blocks[i]=payload;bytes+=payload.byteLength;timings.push({column,row,ms:performance.now()-before});
            if(bytes>8*1024**2)throw Error('Превышен объём числовых данных на вид.');
            (await prepared).uploadBlock(i,payload);
        }
    }
    // Two fetches; the native generator queues fairly within the request deadline.
    await Promise.all([worker(),worker()]);
    return {reference,metadata,blocks,bytes,timings,load_ms:performance.now()-start};
}
function coverage(raw=false) {
    const ring=[];
    const west=-23.53125,east=62.53125,south=29.46875,north=70.53125;
    for(let i=0;i<=200;i++)ring.push([west+(east-west)*i/200,nativeToWgs(south)]);
    for(let i=0;i<=100;i++)ring.push([east,nativeToWgs(south+(north-south)*i/100)]);
    for(let i=0;i<=200;i++)ring.push([east-(east-west)*i/200,nativeToWgs(north)]);
    for(let i=0;i<=100;i++)ring.push([west,nativeToWgs(north-(north-south)*i/100)]);
    if(!raw&&activeMode!=='mercator')return clippedLine(ring,activeMode==='EPSG:3576'?[90,90]:orthoCenter,activeMode==='EPSG:3576'?45:89.99999);
    return {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:ring}};
}
async function show(mode,preparedMap,preparedLayer,camera) {
    document.getElementById('ortho').disabled=true;document.getElementById('laea').disabled=true;
    pointController?.abort();
    if(selectedMarkerHandler)map.off('render',selectedMarkerHandler);
    selectedMarker?.remove();selectedMarker=undefined;selectedMarkerHandler=undefined;
    for(const label of labels)label.remove();labels=[];
    activeMode=mode;
    if(camera?.center&&mode==='hmc:orthographic'){orthoCenter=[...camera.center];ortho=orthoDefinition();}
    const center=camera?.center??(mode==='EPSG:3576'?[25,60]:orthoCenter);
    map=await (preparedMap??create(mode,center,camera?.zoom??(mode==='EPSG:3576'?.7:0)));
    map.resize();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    map.dragRotate.disable();map.touchZoomRotate.disableRotation();map.keyboard.disable();
    const projection=proj4('EPSG:4326',displayDefinition(mode));
    layer=preparedLayer??new NativeLayer(data.blocks,mode,projection,data.metadata,orthoCenter);
    if(!preparedLayer)map.addLayer(layer);
    if(window.t23Interaction&&mode==='hmc:orthographic') {
        layer.context=new OrthographicContext(map,coverage(true));
    } else {
        map.addSource('coverage',{type:'geojson',data:coverage()});
        map.addLayer({id:'coverage',type:'line',source:'coverage',paint:{'line-color':'#fff','line-width':1.5}});
    }
    for(const [name,point] of [['Москва',[37.6173,55.7558]],['Санкт-Петербург',[30.3158,59.9391]]]){
        const label=document.createElement('div');label.className='label';label.textContent='● '+name;
        map.getContainer().append(label);labels.push(label);
        label.style.zIndex='2';
        const place=()=>{label.hidden=!visible({lng:point[0],lat:point[1]});if(label.hidden)return;const p=layer.project(point);label.style.left=p.x+'px';label.style.top=p.y+'px';};
        map.on('render',place);place();
    }
    status.textContent=(mode==='EPSG:3576'?'Показано к северу от 45° с. ш. · ':mode==='mercator'?'Mercator · ':'Сферическая ортография · ')+
        data.reference.selection.valid_time+' · значения в '+displayUnits;
    if(selectedPoint)pointStatus(selectedPoint);
    await new Promise(resolve=>{map.once('render',resolve);map.triggerRepaint();});
    map.on('click',event=>{
        if(activeMode==='hmc:orthographic'&&event.point){
            const g=layer.geometry(),dpr=g.width/map.getContainer().clientWidth;
            const geo=layer.projection.inverse([(event.point.x*dpr-g.origin[0])/g.scale,(g.origin[1]-event.point.y*dpr)/g.scale]);
            event.lngLat={lng:geo[0],lat:geo[1]};
        }
        if(!Number.isFinite(event.lngLat.lng)||!Number.isFinite(event.lngLat.lat)||!visible(event.lngLat))return;
        pendingPick=pick(event.lngLat);
        pendingPick.catch(error=>{if(error.name!=='AbortError')status.textContent='Не удалось получить значение в точке. Повторите попытку.';});
    });
    document.getElementById('ortho').disabled=false;document.getElementById('laea').disabled=false;
    if(selectedPosition)placeMarker(selectedPosition);
    return map;
}
function placeMarker(position) {
    selectedPosition=position;
    if(selectedMarker){selectedMarkerHandler();return;}
    const marker=document.createElement('div');marker.id='selected-point';marker.className='label';
    marker.textContent='⊕';marker.style.color='#ffed79';marker.style.fontSize='22px';
    map.getContainer().append(marker);selectedMarker=marker;
    const place=()=>{
        marker.hidden=!visible(selectedPosition);
        const message=document.getElementById('visibility-message');
        if(message)message.textContent=marker.hidden?(activeMode==='EPSG:3576'?'Точка сохранена вне области от 45° с. ш.':'Точка сохранена за горизонтом.'):'';
        if(marker.hidden)return;
        const p=layer.project([selectedPosition.lng,selectedPosition.lat]);
        marker.style.left=(p.x-11)+'px';marker.style.top=(p.y-14)+'px';
    };
    selectedMarkerHandler=place;
    marker.style.zIndex='2';
    map.on('render',place);place();
}
async function pick(position) {
    pointController?.abort();pointController=new AbortController();
    const controller=pointController;
    const selected=data.reference.selection;
    const query=new URLSearchParams(Object.fromEntries(['selection','run','revision','valid_time'].map(key=>[key,selected[key]])));
    query.set('layer',selected.field);query.set('lon',position.lng);query.set('lat',position.lat);
    query.set('crs','http://www.opengis.net/def/crs/OGC/1.3/CRS84');
    const response=await fetch('/api/v1/point?'+query,{signal:controller.signal});
    if(!response.ok)throw Error('Не удалось получить значение в точке.');
    const point=await response.json();
    controller.signal.throwIfAborted();
    if(point.selection!==selected.selection||point.spatial_selection!=='nearest-native-cell')
        throw Error('Изменился смысл выборки в точке.');
    placeMarker(position);
    selectedPoint=point;pointStatus(point);
    return point;
}
// Start field I/O during worker/map initialization, before the driver calls runProbe.
// The navigation-origin timer below includes this entire bootstrap.
const initialMap=create('hmc:orthographic',[20,50],0);
let initialLayer;
const initialData=load(async metadata=>{
        const preparedMap=await initialMap;
        initialLayer=new NativeLayer([],'hmc:orthographic',proj4('EPSG:4326',ortho),metadata);
        preparedMap.addLayer(initialLayer);
        return initialLayer;
});
window.runProbe=async()=>{
    // performance.now() starts at page navigation: include local scripts/worker startup.
    const start=0;
    document.getElementById('ortho').disabled=true;document.getElementById('laea').disabled=true;
    data=await initialData;
    const result={selection:data.metadata.selection,contract:data.metadata.contract,views:[],experiments:[],
        transfer_bytes:data.bytes,load_ms:data.load_ms,requests:data.timings,
        device_scope:window.t23PhysicalMobile?'physical mobile browser and GPU':'real desktop GPU; mobile viewports are desktop emulation'};
    for(const mode of ['hmc:orthographic','EPSG:3576']) {
        const switchStart=performance.now();await show(mode,result.views.length?undefined:initialMap,
            result.views.length?undefined:initialLayer);
        if(!result.views.length)result.cold_first_show_ms=performance.now()-start;
        else result.warm_mode_switch_ms=performance.now()-switchStart;
        const observations=layer.samples();
        observations.controls=[[37.6173,55.7558],[30.3158,59.9391],[0,45]].map(point=>{
            const pixel=layer.project(point),dpr=map.getCanvas().width/map.getContainer().clientWidth;
            return {point,pixel:[pixel.x*dpr,pixel.y*dpr]};
        });
        const projection=proj4('EPSG:4326',displayDefinition(mode));
        const geometryCases=[['pole',[90,90]],['dateline-positive',[180,80]],['dateline-negative',[-180,80]],
            ...(mode==='EPSG:3576'?[['south-of-cut',[90,44.999]],['north-of-cut',[90,45.001]]]:[])];
        const geometryPoints=geometryCases.map(([name,point])=>[name,...projection.forward(point)]);
        if(mode==='hmc:orthographic')geometryPoints.push(['horizon-inside',6378137*.9999,0],['horizon-outside',6378137*1.0001,0]);
        observations.synthetic_geometry=layer.positions(geometryPoints);
        observations.synthetic_masks=layer.syntheticMasks();
        observations.points=[];
        for(let i=0;i<3;i++){
            map.fire('click',{lngLat:{lng:37.6173,lat:55.7558}});
            observations.points.push(await pendingPick);
        }
        const frames=[];let last=performance.now();
        const baseline=map.getCenter(),zoom=map.getZoom();
        for(let i=0;i<60;i++)await new Promise(resolve=>{
            map.once('render',()=>{const now=performance.now();frames.push(now-last);last=now;resolve();});
            map.jumpTo({center:[baseline.lng+.03*Math.sin(i/7),baseline.lat],zoom:zoom+.1*Math.sin(i/10)});
        });
        observations.scripted_pan_zoom_p95_ms=frames.sort((a,b)=>a-b)[Math.floor(frames.length*.95)];
        observations.frame_scope=window.t23PhysicalMobile?
            'scripted flat-camera pan/zoom on physical mobile GPU; no continuous globe rotation claim':
            'scripted flat-camera pan/zoom on desktop GPU; no physical mobile or globe rotation claim';
        observations.estimated_managed_bytes=data.bytes+258*258*2*4+observations.gpu_bytes+
            map.getCanvas().width*map.getCanvas().height*8;
        if(observations.estimated_managed_bytes>128*1024**2)throw Error('Превышен бюджет числовых ресурсов.');
        result.views.push(observations);
        const frame=data.reference.experiments.find(frame=>frame.mode===mode);
        const payload=await (await get(frame.url)).arrayBuffer();
        const values=new Float32Array(payload,0,258*258),valid=new Uint8Array(payload,258*258*4);
        const comparison=layer.samples({width:258,height:258,origin:[129,129],scale:129/frame.extent});
        comparison.scope='server-screen-comparison';
        for(const sample of comparison.samples){const i=sample[1]*258+sample[0];sample.push(values[i],valid[i]);}
        result.experiments.push(comparison);
    }
    const gl=map.getCanvas().getContext('webgl2'),debug=gl.getExtension('WEBGL_debug_renderer_info');
    result.renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    result.first_sequence_ms=performance.now()-start;result.errors=window.probeErrors;
    return result;
};
window.showProbe=async mode=>{await show(mode);return {mode};};
window.releaseProbe=async()=>{
    fieldController.abort();pointController?.abort();
    const active=map??await initialMap.catch(()=>null);
    active?.remove();
    const remaining=Boolean(document.querySelector('#map canvas'));
    document.getElementById('map').replaceWith(document.createElement('div'));
    for(const control of document.querySelectorAll('button,select'))control.disabled=true;
    return {map_removed:!remaining,load_aborted:fieldController.signal.aborted};
};
const showError=()=>{status.textContent='Не удалось показать карту. Повторите попытку.';};
if(window.t23Interaction){
    const {installInteraction}=await import('/interaction.js');
    installInteraction({show:(mode,camera)=>show(mode,undefined,undefined,camera),pick,
        rotate:center=>{
            if(activeMode!=='hmc:orthographic')return;
            orthoCenter=[...center];ortho=orthoDefinition();
            layer.setCenter(center,proj4('EPSG:4326',ortho));
        },
        current:()=>({map,layer,mode:activeMode,center:[...orthoCenter],position:selectedPosition,selection:data?.reference.selection}),
        setUnits:units=>{displayUnits=units;if(selectedPoint)pointStatus(selectedPoint);},placeMarker});
}
if(!window.t23Interaction){
    document.getElementById('ortho').onclick=()=>show('hmc:orthographic').catch(showError);
    document.getElementById('laea').onclick=()=>show('EPSG:3576').catch(showError);
}
window.probeReady=true;
