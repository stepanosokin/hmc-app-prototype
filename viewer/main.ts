import {referenceTime,withdrawnReplacement,type Selection,type PublishedGroup} from './selection.js';
import {FieldLoader,json,PublicationExpired,type FieldData} from './field.js';
import {create,clippedLine} from './geometry.js';
import {WeatherLayer} from './weather-layer.js';
import {nativeToWgs} from './native-layer.js';
import {nativePosition} from './source-crs.js';
import {LocalContext} from './local-context.js';
import {PointSeries,pointValue,SERIES_BUDGET,type PointResult,type Position} from './series.js';
import {PointChart} from './point-chart.js';
import {SourceSettings,type SourceDescription} from './source-settings.js';
import {FieldPicker,fieldPresentation,fieldUnits,fieldNumber} from './fields.js';
import {compactGroups,type CompactCatalogue} from './catalogue.js';

type Mode='mercator'|'orthographic'|'laea';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const control=(id:string)=>$<HTMLSelectElement>(id);
const text=(id:string,value:string)=>{$(id).textContent=value;};
const mobile=()=>matchMedia('(max-width:700px), (max-height:600px) and (orientation:landscape)').matches;
const portrayalBaseline=new URL(location.href).searchParams.get('validation')==='1'&&new URL(location.href).searchParams.get('portrayal')==='1';
const loader=new FieldLoader(portrayalBaseline);
const charts=new Map<string,PointChart>();
// Shared discovery, current/pending catalogues and four hydrated groups each.
// This is a managed estimate; actual JS heap remains a separate observation.
const CATALOGUE_BUDGET=24*1024**2;
const sourceSettings=new SourceSettings();
const fieldPicker=new FieldPicker(target=>setGroup(target,true));
const series=new PointSeries(pointValue,seriesChanged);
function seriesChanged(){
    if(series.expired&&timeState!=='expired'&&timeState!=='withdrawn'){
        cancelTime();timeState='expired';if(layer)layer.fieldVisible=false;map?.triggerRepaint();displayed=undefined;metadata=undefined;point=undefined;
        selectionDetails();notice('Публикация истекла. Перевыберите публикацию.');renderPoint('Публикация истекла');return;
    }
    if(position&&selected&&timeState==='ready'){
        const entry=series.entries[index];point=entry?.result;
        pointMessage=entry?.state==='error'?'Не удалось получить значение. Повторите ошибки ряда.':'';
        renderPoint();
    }else for(const chart of charts.values())chart.update(series,index,valueText);
}
function ensureSeries(initial?:PointResult){if(group&&position)void series.load(group,position,initial);}
const validation=new URLSearchParams(location.search).get('validation')==='1';
const validationFixtures=validation&&new URLSearchParams(location.search).get('fixtures')==='1';
let groups:PublishedGroup[]=[],group:PublishedGroup|undefined,index=0,mode:Mode='mercator';
let selected:Selection|undefined,data:FieldData|undefined,map:any,layer:WeatherLayer|undefined;
let position:Position|undefined,point:PointResult|undefined,pointController=new AbortController();
let center=[19.5,53],viewVersion=0,selectionVersion=0,mapWork=Promise.resolve();
let mapMode:Mode='mercator';
let mapBaseCenter:number[]=[],mapBaseProjection:any;
let ownedCanvas:HTMLCanvasElement|undefined;
let screenPick:unknown;
let unit='C',alternate=false,light=false,pointCollapsed=false,lost=false,rendererError='';
let metadata:SourceDescription|undefined,bootController=new AbortController(),pendingGroups:PublishedGroup[]|undefined;
const updateLoader=new FieldLoader(portrayalBaseline);
let updateController=new AbortController(),catalogueController=new AbortController(),updateBusy=false;
let dismissedPublication='',updateSerial=0,timeStagingBytes=0,updateStagingBytes=0;
let catalogueChecks=0;
let timeController=new AbortController(),displayed:Selection|undefined;
let reselectController=new AbortController();
let timeState:'loading'|'ready'|'missing'|'error'|'expired'|'withdrawn'='missing',pointMessage='',timeError='';
function cancelTime(){timeController.abort();timeController=new AbortController();loader.cancel();timeStagingBytes=0;}
function cancelUpdate(){
    const wasBusy=updateBusy;
    updateController.abort();updateController=new AbortController();updateLoader.cancel();updateBusy=false;updateStagingBytes=0;
    if(wasBusy)updateMessage('Обновление отменено. Текущая выборка сохранена.');
}
let firstCompleteMs:number|undefined,lastFrame:number|undefined;const frames:number[]=[];
let lastRendered:{selection:string;mode:string;at:number}|undefined;
const renderTimes:number[]=[];let warmSwitchMs:number|undefined;
const panels=['forecastPanel','navigationPanel','legendPanel','timelinePanel'].map(id=>$<HTMLDetailsElement>(id));
const timestamp=(value:string)=>new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',dateStyle:'short',timeStyle:'short'}).format(new Date(value))+' UTC';
const degrees=(value:number)=>value.toFixed(3)+'°';
const sourceUnits=()=>displayed?.units??selected?.units??group?.selection.units??'K';
const unitsText=()=>sourceUnits()==='K'?(unit==='C'?'°C':'K'):fieldUnits(sourceUnits());
const valueText=(value:number,source=sourceUnits())=>fieldNumber(value-(source==='K'&&unit==='C'?273.15:0),source)+' '+
    (source==='K'?(unit==='C'?'°C':'K'):fieldUnits(source));
function statusLayout(){
    document.documentElement.style.setProperty('--notice-left',($('showPoint').offsetLeft+$('showPoint').offsetWidth+8)+'px');
    document.documentElement.style.setProperty('--notice-height',($('notice').hidden?0:$('notice').getBoundingClientRect().height)+'px');
}
function notice(message:string){
    if($('notice').textContent===message&&$('notice').hidden===!message)return;
    text('notice',message);$('notice').hidden=!message;statusLayout();
}
function rendererFailure(error:unknown){
    console.error('Ошибка графического слоя',error);
    rendererError='Браузер или графический процессор не поддерживает выбранный режим. Попробуйте Меркатор или обновите браузер.';
    text('projectionStatus','Режим недоступен. '+rendererError);
    $('useMercator').hidden=false;
    notice('Карта недоступна. '+rendererError);placePoint();
}
function selectionDetails(){
    if(!group)return;
    const source=group.selection;
    control('model').value=source.model;
    const title=fieldPresentation(displayed??source).label;
    document.querySelector('#forecastPanel h1')!.textContent=title;
    fieldPicker.update(groups,group);
    $('legendPanel').setAttribute('aria-label','Шкала выбранного поля');
    text('reference',(displayed?'Показан расчёт: ':'Выбран расчёт: ')+timestamp(referenceTime((displayed??source).run)));
    const valid=new Date(group.start+index*3600000).toISOString();
    const shown=displayed?timestamp(displayed.valid_time):'нет поля';
    text('valid','Показано: '+shown);text('compactTime',shown+(timeState==='loading'?' · загрузка':timeState==='error'?' · ошибка загрузки':timeState==='expired'?' · публикация истекла':timeState==='withdrawn'?' · публикация снята':''));
    text('timeLabel',timestamp(valid)+(timeState==='loading'?' · загружается':timeState==='error'?' · ошибка загрузки':timeState==='expired'?' · публикация истекла':timeState==='withdrawn'?' · публикация снята':''));
    text('selectionIdentity',(displayed?'Показана редакция ':'Выбрана редакция ')+(displayed??source).revision.slice(0,12));
    text('forecastSummary','Выбор: '+(source.fixture==='overlap'?'Тестовый перекрывающийся расчёт · ':source.fixture==='correction'?'Тестовая коррекция +1 K · ':'')+source.model+' · '+timestamp(referenceTime(source.run)));
    text('availability',timeState==='loading'?'Загрузка выбранного срока':timeState==='error'?'Ошибка загрузки срока':timeState==='expired'?'Публикация истекла':timeState==='withdrawn'?'Публикация снята':selected?'Срок опубликован':'Срок отсутствует');
    text('retry',timeState==='expired'||timeState==='withdrawn'?'Перевыбрать публикацию':'Повторить загрузку');
    sourceSettings.update(group,index,selected,position,metadata,timeState,displayed,
        timeState==='ready'?data?.metadata.grid.outer_cell_edges_wsen:undefined,timestamp);
    palette();layout();
}
function timeControls(){
    if(!group)return;
    control('time').replaceChildren(...group.times.map((item,i)=>new Option(timestamp(new Date(group!.start+i*3600000).toISOString())+(item?'':' · отсутствует'),String(i))));
    const range=$<HTMLInputElement>('timeRange');range.min='0';range.max=String(group.times.length-1);range.step='1';
    syncTime();
}
function syncTime(){control('time').value=String(index);$<HTMLInputElement>('timeRange').value=String(index);
    $<HTMLButtonElement>('previous').disabled=index===0;$<HTMLButtonElement>('next').disabled=index===(group?.times.length??1)-1;}
function setGroup(newGroup:PublishedGroup,preservePoint=false){
    const time=group?group.start+index*3600000:newGroup.start;
    if(preservePoint){cancelUpdate();pointController.abort();series.clear();point=undefined;}
    else clearPoint();
    group=newGroup;index=0;
    if(preservePoint){let distance=Infinity;group.times.forEach((item,i)=>{const delta=Math.abs(group!.start+i*3600000-time);if(item&&delta<distance){distance=delta;index=i;}});}
    timeState='missing';runControls();timeControls();ensureSeries();void chooseTime(index);
}
function clearPoint(){reselectController.abort();series.clear();cancelUpdate();pointController.abort();point=undefined;position=undefined;pointCollapsed=false;
    $('drawer').hidden=true;$('settings').setAttribute('aria-expanded','false');placePoint();if(group)selectionDetails();}
function releaseLayer(){
    const previous=layer;layer=undefined;
    previous?.context?.remove();
    if(previous&&map?.getLayer(previous.id))map.removeLayer(previous.id);
}
function reserveFrame(target:Selection){
    // Bound the download before allocating it, and include its future texture and
    // decode scratch. No frame cache; cancellation releases the reservation.
    const blocks=target.field_profile?(target.display_blocks??64):18;
    if(!Number.isInteger(blocks)||blocks<1||blocks>64)throw Error('Некорректный размер опубликованного поля.');
    const canvas=map?.getCanvas();
    const bytes=(332820*blocks+1024**2)*(target.wind_v?2:1)+(target.wind_v?0:258*258*8+258*258*blocks*8)+
        (target.wind_v&&canvas?canvas.width*canvas.height*4:0);
    if(stagingBase()+bytes+SERIES_BUDGET+CATALOGUE_BUDGET>128*1024**2)throw Error('Превышен бюджет обновления GPU.');
    return bytes;
}
function stagingBase(){
    // checkBudget reserves a full RGBA32F readback texture (16 bytes/pixel).
    // Readback is forbidden while staging; the old display and its arrays stay.
    const canvas=map?.getCanvas();
    return layer?layer.checkBudget()-(canvas?canvas.width*canvas.height*16:0):0;
}
async function prepareLayer(field:FieldData,owner:any,signal:AbortSignal){
    const extra=field.blocks.reduce((n,b)=>n+b.byteLength,0)+(field.wind?.blocks.reduce((n,b)=>n+b.byteLength,0)??0)+(field.wind?2*1024**2:258*258*8+258*258*field.blocks.length*8)+
        (field.wind?owner.getCanvas().width*owner.getCanvas().height*4:0);
    if((layer?stagingBase():owner.getCanvas().width*owner.getCanvas().height*28)+extra+SERIES_BUDGET+CATALOGUE_BUDGET>128*1024**2)
        throw Error('Превышен бюджет обновления GPU.');
    const candidate=new WeatherLayer(field,mode==='laea'?'EPSG:3576':mode==='orthographic'?'hmc:orthographic':'mercator',projection(),center);
    candidate.baseCenter=[...mapBaseCenter];candidate.baseProjection=mapBaseProjection;
    candidate.id='native-update-'+(++updateSerial);candidate.staged=true;
    const remove=()=>{if(owner.getLayer(candidate.id))owner.removeLayer(candidate.id);};
    signal.addEventListener('abort',remove,{once:true});
    try{
        signal.throwIfAborted();
        owner.addLayer(candidate,owner.getLayer('coverage')?'coverage':undefined);
        await candidate.prepared(signal);signal.throwIfAborted();return candidate;
    }catch(error){remove();throw error;}finally{signal.removeEventListener('abort',remove);}
}
function replaceLayer(candidate:WeatherLayer){
    if(layer){candidate.context=layer.context;layer.context=undefined;}
    if(mode==='orthographic')candidate.setCenter(center,projection());
    releaseLayer();layer=candidate;candidate.staged=false;candidate.setPalette(alternate);
    map.triggerRepaint();
}
async function chooseTime(next:number){
    if(timeState==='withdrawn'){notice('Публикация снята. Перевыберите публикацию в настройках.');return;}
    if(series.expired||timeState==='expired'){notice('Публикация истекла. Перевыберите публикацию в настройках.');return;}
    if(!group)return;index=Math.max(0,Math.min(group.times.length-1,next));syncTime();
    cancelTime();cancelUpdate();pointController.abort();point=undefined;
    const version=++selectionVersion;++viewVersion;
    selected=group.times[index]??undefined;
    timeState=selected?'loading':'missing';timeError='';
    renderPoint(selected?'Загрузка значения выбранного срока…':'Срок отсутствует');
    if(!selected){
        // Keep the geographic context, including the local context owned by the layer.
        if(layer)layer.fieldVisible=false;map?.triggerRepaint();
        displayed=undefined;metadata=undefined;
        selectionDetails();notice('В выбранной редакции этот срок отсутствует. Слой и значение точки скрыты.');return;
    }
    selectionDetails();
    notice('Загрузка числового поля…');
    const current=selected,transaction=new AbortController();timeController=transaction;
    const signal=AbortSignal.any([transaction.signal,AbortSignal.timeout(30000)]);
    const abort=()=>loader.cancel();signal.addEventListener('abort',abort,{once:true});
    let candidate:WeatherLayer|undefined,owner:any;
    try{
        timeStagingBytes=reserveFrame(current);
        const [field,description]=await Promise.all([loader.load(current),json<SourceDescription>(current.collection,loader.controller.signal)]);
        signal.throwIfAborted();if(version!==selectionVersion)return;
        if(!map){
            data=field;metadata=description;await rebuild(true);
            if(version!==selectionVersion)return;
            if(!layer)throw Error('Слой не создан');
            const initial=layer;
            const retire=()=>{if(layer===initial){releaseLayer();if(data===field){data=undefined;metadata=undefined;}}};
            signal.addEventListener('abort',retire,{once:true});
            try{await initial.prepared(signal);}catch(error){retire();throw error;}
            finally{signal.removeEventListener('abort',retire);}
        }else{
            owner=map;candidate=await prepareLayer(field,owner,signal);
            signal.throwIfAborted();if(version!==selectionVersion||owner!==map)return;
            replaceLayer(candidate);data=field;metadata=description;
        }
        displayed=current;timeState='ready';if(layer)layer.fieldVisible=true;map?.triggerRepaint();selectionDetails();notice('');renderPoint('');
        if(position)void refreshPoint(current,position);
    }catch(error){if(version===selectionVersion&&!transaction.signal.aborted){
        timeError=String(error);
        timeState=error instanceof PublicationExpired?'expired':'error';
        if(timeState==='expired'){series.expire();if(layer)layer.fieldVisible=false;map?.triggerRepaint();displayed=undefined;metadata=undefined;}
        selectionDetails();renderPoint(timeState==='expired'?'Публикация истекла':'Не удалось загрузить выбранный срок');
        notice(timeState==='expired'?'Публикация истекла. Проверьте обновления.':
            'Не удалось загрузить выбранный срок. '+(displayed?'Сохранено поле: '+timestamp(displayed.valid_time)+'. ':'')+'Повторите загрузку.');
    }}finally{
        signal.removeEventListener('abort',abort);
        if(candidate&&candidate!==layer&&owner?.getLayer(candidate.id))owner.removeLayer(candidate.id);
        if(transaction===timeController){loader.cancel();timeStagingBytes=0;}
    }
}
function coverage(raw=false){
    const [west,south,east,north]=data!.metadata.grid.outer_cell_edges_wsen,ring:number[][]=[];
    const geographic=(xy:number[])=>nativePosition(data!.metadata.source_crs,xy,true);
    for(let i=0;i<=160;i++)ring.push(geographic([west+(east-west)*i/160,south]));
    for(let i=0;i<=100;i++)ring.push(geographic([east,south+(north-south)*i/100]));
    for(let i=0;i<=160;i++)ring.push(geographic([east-(east-west)*i/160,north]));
    for(let i=0;i<=100;i++)ring.push(geographic([west,north-(north-south)*i/100]));
    return !raw&&mode!=='mercator'?clippedLine(ring,mode==='laea'?[90,90]:center,mode==='laea'?45:89.99999):
        {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:ring}};
}
function visible(p:Position){
    if(mode==='laea')return p.lat>=45;
    if(mode!=='orthographic')return true;
    const rad=Math.PI/180,phi=p.lat*rad,c=center[1]*rad;
    return Math.sin(phi)*Math.sin(c)+Math.cos(phi)*Math.cos(c)*Math.cos((p.lng-center[0])*rad)>0;
}
function projection(){return proj4('EPSG:4326',mode==='laea'?'EPSG:3576':mode==='mercator'?'EPSG:3857':
    `+proj=ortho +lat_0=${center[1]} +lon_0=${center[0]} +R=6378137 +units=m +no_defs`);}
async function rebuild(fit=false){
    const version=++viewVersion;
    mapWork=mapWork.catch(()=>{}).then(async()=>{
        if(version!==viewVersion||!data||lost)return;
        const currentData=data;
        const mountStart=performance.now();
        const scale=layer?.geometry().scale,zoom=map?.getZoom()??0;
        if(map&&mapMode!=='orthographic'){const c=map.getCenter();center=[c.lng,c.lat];}
        if(mode==='laea')center=[center[0],Math.max(45,center[1])];
        releaseLayer();
        ownedCanvas=undefined;
        map=await create(mode==='laea'?'EPSG:3576':mode==='orthographic'?'hmc:orthographic':'mercator',center,zoom);
        mapMode=mode;
        if(version!==viewVersion||currentData!==data){map.remove();map=undefined;return;}
        map.dragRotate.disable();map.touchZoomRotate.disableRotation();
        const canvas=map.getCanvas();
        ownedCanvas=canvas;
        canvas.addEventListener('webglcontextlost',(event:Event)=>{if(ownedCanvas!==canvas)return;event.preventDefault();lost=true;cancelTime();cancelUpdate();loader.cancel();
            ++selectionVersion;notice('Графический контекст потерян. Ожидается восстановление.');placePoint();});
        canvas.addEventListener('webglcontextrestored',()=>{if(ownedCanvas!==canvas)return;lost=false;ownedCanvas=undefined;releaseLayer();map.remove();map=undefined;
            if(timeState==='missing'&&data)void rebuild(true);else void chooseTime(index);});
        layer=new WeatherLayer(currentData,mode==='laea'?'EPSG:3576':mode==='orthographic'?'hmc:orthographic':'mercator',projection(),center);
        layer.fieldVisible=Boolean(displayed)&&timeState!=='missing'&&timeState!=='expired'&&timeState!=='withdrawn';
        mapBaseCenter=[...layer.baseCenter];mapBaseProjection=layer.baseProjection;
        map.addLayer(layer);layer.setPalette(alternate);
        if(mode!=='mercator')layer.context=new LocalContext(map,coverage(mode==='orthographic'),mode);
        else{map.addSource('coverage',{type:'geojson',data:coverage()});map.addLayer({id:'coverage',source:'coverage',type:'line',paint:{'line-color':'#fff','line-width':1}});}
        rendererError='';$('useMercator').hidden=true;
        if(scale&&!fit){const ratio=scale/layer.geometry().scale;if(Number.isFinite(ratio)&&ratio>0)map.setZoom(map.getZoom()+Math.log2(ratio));}
        if(fit)fitCoverage();
        map.on('render',placePoint);map.on('click',(event:any)=>void pickScreen(event));
        lastFrame=undefined;
        map.on('render',()=>{const now=performance.now();
            if(layer?.ready&&layer.fieldVisible&&!lost){firstCompleteMs??=now;renderTimes.push(now);if(renderTimes.length>120)renderTimes.shift();
                lastRendered={selection:layer.metadata.selection,mode:layer.mode,at:now};
                if(lastFrame!==undefined){frames.push(now-lastFrame);if(frames.length>120)frames.shift();}lastFrame=now;}});
        map.once('render',()=>{warmSwitchMs=performance.now()-mountStart;});
        for(const [name,coords] of [['Москва',[37.6173,55.7558]],['Санкт-Петербург',[30.3158,59.9391]]] as const){
            const label=document.createElement('div');label.className='mapLabel';label.textContent='● '+name;
            label.dataset.point=JSON.stringify(coords);
            map.getContainer().append(label);
            map.on('render',()=>{label.hidden=!visible({lng:coords[0],lat:coords[1]});
                const p=layer?.project([...coords]);if(p)Object.assign(label.style,{left:p.x+'px',top:p.y+'px'});});
            map.once('remove',()=>label.remove());
        }
        map.on('error',()=>{notice('Ошибка карты. Повторите загрузку.');});
        text('projectionStatus',mode==='laea'?'Показано к северу от 45° с. ш.; южнее — в других видах.':mode==='orthographic'?'Ортографический глобус. Вращайте перетаскиванием.':'Всё доступное покрытие прогноза.');
        text('compactProjection',mode==='laea'?'LAEA 3576 · ≥45° с. ш.':mode==='orthographic'?'Глобус':'Меркатор');
        if($('notice').textContent?.startsWith('Графический контекст'))notice('');
        updateBasemap();placePoint();layout();
    }).catch(error=>{if(version===viewVersion&&data)rendererFailure(error);});
    await mapWork;
}
function fitCoverage(){
    if(!map||!data||!layer||lost||rendererError)return;
    const [w,s,e,n]=data.metadata.grid.outer_cell_edges_wsen;
    if(mode==='orthographic')rotate(nativePosition(data.metadata.source_crs,[(w+e)/2,(s+n)/2],true));
    const points:number[][]=(coverage(true).geometry.coordinates as number[][]).filter(p=>p.every(Number.isFinite)&&(mode!=='laea'||p[1]>=45));
    if(!points.length){notice('Покрытие находится вне области этого вида карты.');return;}
    // Fit in the registered projected plane; orthographic camera remains fixed.
    const projected=points.map(p=>projection().forward(p));
    const xmin=Math.min(...projected.map(p=>p[0])),xmax=Math.max(...projected.map(p=>p[0]));
    const ymin=Math.min(...projected.map(p=>p[1])),ymax=Math.max(...projected.map(p=>p[1]));
    const g=layer!.geometry(),dpr=map.getCanvas().width/map.getContainer().clientWidth;
    const target=Math.min(map.getContainer().clientWidth*.88*dpr/(xmax-xmin),map.getContainer().clientHeight*.66*dpr/(ymax-ymin));
    const delta=Math.log2(target/g.scale);map.setZoom(map.getZoom()+delta);
    if(mode!=='orthographic')map.setCenter(projection().inverse([(xmin+xmax)/2,(ymin+ymax)/2]));
}
function rotate(next:number[]){center=[((next[0]+540)%360)-180,Math.max(-89.99,Math.min(89.99,next[1]))];
    if(mode==='orthographic'&&layer)layer.setCenter(center,projection());placePoint();}
function placePoint(){
    $('pointMarker').hidden=true;$('pointCard').hidden=true;$('showPoint').hidden=!position;
    if(!position||!layer||rendererError||lost)return;
    const hidden=!visible(position);
    const message=hidden?(mode==='laea'?'Точка сохранена вне области от 45° с. ш.':'Точка сохранена за горизонтом глобуса.') : '';
    if(message&&timeState==='ready')notice(message);
    else if($('notice').textContent?.startsWith('Точка сохранена'))notice('');
    const pixel=layer.project([position.lng,position.lat]);
    const onscreen=!hidden&&pixel.x>=0&&pixel.x<=innerWidth&&pixel.y>=0&&pixel.y<=innerHeight;
    $('pointMarker').hidden=!onscreen;
    Object.assign($('pointMarker').style,{left:pixel.x+'px',top:pixel.y+'px'});
    if(!onscreen||mobile()||pointCollapsed||!$('drawer').hidden&&$('drawer').classList.contains('pointMode'))return;
    const card=$('pointCard');card.hidden=false;
    Object.assign(card.style,{left:Math.max(10,Math.min(innerWidth-310,pixel.x+18))+'px',top:Math.max(70,Math.min(innerHeight-card.offsetHeight-165,pixel.y-30))+'px'});
}
function renderPoint(message=pointMessage){
    pointMessage=message;
    if(group)sourceSettings.update(group,index,selected,position,metadata,timeState,displayed,
        timeState==='ready'?data?.metadata.grid.outer_cell_edges_wsen:undefined,timestamp);
    $('sheetPoint').hidden=!position;$('clearMobilePoint').hidden=!position;
    if(!position)for(const chart of charts.values())chart.element.remove();
    for(const id of ['pointContent','mobilePoint']){
        const container=$(id);
        if(!container.querySelector('.pointCoordinates')){
            const coordinate=document.createElement('small');coordinate.className='pointCoordinates';
            const value=document.createElement('strong');value.className='pointValue';
            const details=document.createElement('details'),summary=document.createElement('summary'),provenance=document.createElement('p');
            provenance.className='pointProvenance';summary.textContent='Ячейка и происхождение';details.append(summary,provenance);
            container.replaceChildren(coordinate,value,details);
        }
        container.querySelector('.pointCoordinates')!.textContent=position?degrees(position.lng)+' в. д. · '+degrees(position.lat)+' с. ш.'+(selected?.wind_v?' · ряд: компонента U ветра':''):'';
        const value=container.querySelector('.pointValue')!;value.textContent=message||(point?.value!=null?valueText(point.value,point.units):
            point?.reason==='outside_coverage'?'Вне покрытия':point?.reason==='native_nodata'?'Нет данных в нативной ячейке':'Загрузка значения…');
        value.classList.toggle('pointMessage',Boolean(message));
        container.querySelector('.pointProvenance')!.textContent=(group?'Расчёт: '+group.selection.run+'. Редакция: '+group.selection.revision+
            '. Поле: '+group.selection.field+', уровень: '+group.selection.level+', сетка: '+group.selection.native_grid_sha256+', участник: '+(group.selection.member??'нет')+'. ':'')+(point?
            'Ближайшая нативная ячейка · точный срок UTC. '+(point.cell?`Строка ${point.cell.row}, столбец ${point.cell.column}; ${degrees(point.cell.lon)}, ${degrees(point.cell.lat)}. `:'')+
            'Выборка: '+point.selection+'. Редакция: '+point.revision+'. Источник: '+JSON.stringify(point.source):'');
        if(position){
            let chart=charts.get(id);if(!chart){chart=new PointChart(next=>void chooseTime(next));charts.set(id,chart);}
            chart.update(series,index,valueText);if(chart.element.parentElement!==container)container.append(chart.element);
        }
    }
    placePoint();
}
async function pickScreen(event:any){
    if(timeState==='withdrawn'){notice('Публикация снята. Перевыберите публикацию в настройках.');return;}
    if(timeState==='expired'){notice('Публикация истекла. Перевыберите публикацию в настройках.');return;}
    if(!layer||lost||rendererError)return;
    let pixel=[event.point.x,event.point.y];
    const original=event.originalEvent?.changedTouches?.[0]??event.originalEvent;
    if(Number.isFinite(original?.clientX)){const rect=map.getCanvas().getBoundingClientRect();pixel=[original.clientX-rect.left,original.clientY-rect.top];}
    const g=layer.geometry(),dpr=g.width/map.getContainer().clientWidth;
    const p=projection().inverse([(pixel[0]*dpr-g.origin[0])/g.scale,(g.origin[1]-pixel[1]*dpr)/g.scale]);
    const candidate={lng:((p[0]+540)%360)-180,lat:p[1]};
    if(!p.every(Number.isFinite)||Math.abs(p[1])>90||!visible(candidate))return;
    const projected=layer.project([candidate.lng,candidate.lat]);
    if(Math.hypot(projected.x-pixel[0],projected.y-pixel[1])>.5)return;
    screenPick={pixel:[pixel[0]*dpr,pixel[1]*dpr],...g,center:[...center],mode:mode==='orthographic'?'hmc:orthographic':mode==='laea'?'EPSG:3576':'mercator'};
    cancelUpdate();pointController.abort();series.clear();
    position=candidate;point=undefined;pointCollapsed=false;
    renderPoint(timeState==='loading'?'Загрузка значения выбранного срока…':timeState==='missing'?'Срок отсутствует':timeState==='error'?'Не удалось загрузить выбранный срок':'');
    ensureSeries();if(mobile())openDrawer(true);
    if(selected&&timeState==='ready')await refreshPoint(selected,candidate);
}
async function refreshPoint(current:Selection,candidate:Position){
    // Time, projection and unit changes reuse the pinned scalar series.
    ensureSeries();if(current===selected&&candidate===position)seriesChanged();
}
function changeProjection(next:Mode,fit=false){
    const loading=timeState==='loading';
    if(loading){cancelTime();++selectionVersion;}
    cancelUpdate();pointController.abort();pointController=new AbortController();
    const current=selected,candidate=position;
    const version=selectionVersion;
    mode=next;control('projection').value=mode;
    void rebuild(fit).then(()=>{if(loading&&version===selectionVersion&&mode===next)void chooseTime(index);});
    if(current&&candidate&&timeState==='ready')void refreshPoint(current,candidate);
}
function openDrawer(pointMode=false){
    pointMode=pointMode&&Boolean(position);
    if(mobile())for(const panel of panels)panel.open=false;
    $('drawer').hidden=false;$('drawer').classList.toggle('pointMode',pointMode);
    $('settingsBody').hidden=pointMode;$('mobilePoint').hidden=!pointMode;
    text('closeDrawer',pointMode?'⌄':'Свернуть ⌄');
    $('clearMobilePoint').hidden=!position;
    $('sheetPoint').hidden=!position;
    $('settings').setAttribute('aria-expanded','true');layout();
}
function palette(){
    const temperature=sourceUnits()==='K';control('units').disabled=!temperature;
    control('units').closest('label')!.hidden=!temperature;
    control('palette').options[0].textContent=temperature?'Температурная':'Стандартная';
    for(const e of document.querySelectorAll('.unit'))e.textContent=unitsText();
    const title=group?fieldPresentation(displayed??group.selection).label:'Поле прогноза';
    text('legendSummary',title+' · '+unitsText());text('legendTitle',title);
    const source=displayed??selected??group?.selection;
    text('legendSource',source?.wind_v?'Ряд точки: компонента U ветра':source?source.model+' · числовые данные':'Публикация не выбрана');
    const range=data?.metadata.display_range??[253.15,313.15];
    const ticks=document.querySelectorAll('.ticks span');
    Array.from({length:4},(_,i)=>range[0]+(range[1]-range[0])*i/3).forEach((value,i)=>ticks[i].textContent=temperature?String(Number((value-(unit==='C'?273.15:0)).toFixed(2))):fieldNumber(value,sourceUnits()));
    const ramp=document.querySelector<HTMLElement>('.ramp')!;
    const wind=Boolean((displayed??selected)?.wind_v)&&!portrayalBaseline;
    ramp.style.display=wind?'none':'';(document.querySelector('.ticks') as HTMLElement).style.display=wind?'none':'';
    if(wind)text('legendSummary','Ветер · стрелки движутся по потоку');
    ramp.style.background=alternate?'linear-gradient(90deg,#1f2e8c,#ffcc33)':'';
    layer?.setPalette(alternate);if(position)renderPoint();
}
function updateBasemap(){
    document.body.classList.toggle('basemapLight',light);
    if(!map)return;
    if(layer?.context){layer.context.last=undefined;
        layer.context.water=light?'#c7dbe4':'#314d5b';layer.context.landColor=light?'#e8e5d8':'#52615e';}
    if(map.getLayer('background'))map.setPaintProperty('background','background-color',light?'#c7dbe4':'#314d5b');
    if(map.getLayer('water'))map.setPaintProperty('water','fill-color',light?'#c7dbe4':'#314d5b');
    map.setPaintProperty('land','fill-color',light?'#e8e5d8':'#52615e');map.triggerRepaint();
}
function layout(){
    document.documentElement.style.setProperty('--time-height',$('timelinePanel').getBoundingClientRect().height+'px');
    if(!mobile())document.querySelector<HTMLElement>('.projectionControl')!.style.top=(document.querySelector('.selection')!.getBoundingClientRect().bottom+8)+'px';
    else document.querySelector<HTMLElement>('.projectionControl')!.style.top='';
    map?.resize();placePoint();statusLayout();fieldPicker.layout();
}
control('projection').onchange=()=>changeProjection(control('projection').value as Mode);
$('useMercator').onclick=()=>changeProjection('mercator',true);
$('fit').onclick=fitCoverage;
$('zoomIn').onclick=()=>map?.zoomIn();$('zoomOut').onclick=()=>map?.zoomOut();
for(const [id,delta] of [['west',-20],['east',20]] as const)$(id).onclick=()=>{
    if(mode==='orthographic')rotate([center[0]+delta,center[1]]);else if(map){const c=map.getCenter();map.panTo([c.lng+delta,c.lat]);}};
control('units').onchange=()=>{unit=control('units').value;palette();};
control('palette').onchange=()=>{alternate=control('palette').value==='contrast';palette();};
control('time').onchange=()=>void chooseTime(Number(control('time').value));
$<HTMLInputElement>('timeRange').oninput=event=>void chooseTime(Number((event.target as HTMLInputElement).value));
$('previous').onclick=()=>void chooseTime(index-1);$('next').onclick=()=>void chooseTime(index+1);
control('run').onchange=()=>{const found=groups.find(item=>item.key===control('run').value);if(found)setGroup(found);};
control('model').onchange=()=>{const found=groups.find(item=>item.selection.model===control('model').value);if(found){control('run').value=found.key;setGroup(found);}};
$('settings').onclick=()=>openDrawer();
$('sheetSettings').onclick=()=>openDrawer();$('sheetPoint').onclick=()=>openDrawer(true);
$('closeDrawer').onclick=()=>{$('drawer').hidden=true;$('settings').setAttribute('aria-expanded','false');pointCollapsed=true;layout();};
$('showPoint').onclick=()=>{pointCollapsed=false;openDrawer(true);placePoint();};
$('closePoint').onclick=clearPoint;
$('clearMobilePoint').onclick=clearPoint;
addEventListener('keydown',event=>{if(event.key==='Escape')clearPoint();});
control('basemap').onchange=()=>{light=control('basemap').value==='light';updateBasemap();};
control('font').onchange=()=>{document.documentElement.style.setProperty('--page-font',control('font').value==='courier'?'"Courier New",monospace':'system-ui,"Segoe UI",sans-serif');layout();};
$('retry').onclick=()=>timeState==='expired'||timeState==='withdrawn'?void reselectPublication():groups.length?void chooseTime(index):void boot();
async function reselectPublication(){
    reselectController.abort();reselectController=new AbortController();
    const owner=reselectController,version=selectionVersion,previous=group;
    try{
        const available=await catalogue(owner.signal);
        if(owner.signal.aborted||owner!==reselectController||version!==selectionVersion||previous!==group)return;
        const target=available.find(item=>item.key===previous?.key)??available[0];
        if(!target){notice('Доступных публикаций нет. Повторите перевыбор позже.');return;}
        const valid=previous?previous.start+index*3600000:target.start;
        groups=available;group=target;index=Math.max(0,Math.min(target.times.length-1,Math.round((valid-target.start)/3600000)));
        series.clear();point=undefined;timeState='missing';runControls();timeControls();ensureSeries();void chooseTime(index);
    }catch{if(!owner.signal.aborted&&owner===reselectController&&version===selectionVersion&&previous===group)
        notice('Не удалось перевыбрать публикацию. Повторите попытку в настройках.');}
}
for(const panel of panels){panel.open=!mobile();panel.addEventListener('toggle',()=>{
    if(mobile()&&panel.open){for(const other of panels)if(other!==panel)other.open=false;
        if(panel.id!=='timelinePanel'){$('drawer').hidden=true;$('settings').setAttribute('aria-expanded','false');}}
    layout();});}
addEventListener('resize',layout);
// One Map and orthographic camera during drag. MapLibre retains pinch/scroll zoom.
let drag:{id:number;x:number;y:number;center:number[];last:number[];time:number;velocity:number[]}|undefined;
let multi=false,inertia=0,suppressClick=false;
const pointers=new Set<number>(),container=$('map');
container.addEventListener('pointerdown',event=>{cancelAnimationFrame(inertia);pointers.add(event.pointerId);
    if(pointers.size===1)suppressClick=false;
    if(pointers.size>1){multi=true;drag=undefined;return;}
    if(mode==='orthographic')drag={id:event.pointerId,x:event.clientX,y:event.clientY,center:[...center],last:[event.clientX,event.clientY],time:performance.now(),velocity:[0,0]};});
container.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId||multi)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)<5)return;
    container.setPointerCapture(event.pointerId);suppressClick=true;
    const now=performance.now(),dt=Math.max(1,now-drag.time);drag.velocity=[(event.clientX-drag.last[0])/dt,(event.clientY-drag.last[1])/dt];
    drag.last=[event.clientX,event.clientY];drag.time=now;
    rotate([drag.center[0]-dx*.2,drag.center[1]+dy*.2]);
});
const endDrag=(event:PointerEvent)=>{
    pointers.delete(event.pointerId);
    if(multi){if(!pointers.size)multi=false;drag=undefined;return;}
    const ended=drag;drag=undefined;
    if(!ended||event.type==='pointercancel'||!suppressClick)return;
    const velocity=ended.velocity;let previous=performance.now();
    const glide=(now:number)=>{const dt=Math.min(32,now-previous);previous=now;
        velocity[0]*=Math.exp(-dt/180);velocity[1]*=Math.exp(-dt/180);
        if(mode!=='orthographic'||Math.hypot(...velocity)<.01)return;
        rotate([center[0]-velocity[0]*dt*.2,center[1]+velocity[1]*dt*.2]);inertia=requestAnimationFrame(glide);};
    inertia=requestAnimationFrame(glide);
};
container.addEventListener('pointerup',endDrag);container.addEventListener('pointercancel',endDrag);
container.addEventListener('click',event=>{if(suppressClick){event.stopImmediatePropagation();suppressClick=false;}},true);
async function catalogue(signal=bootController.signal){return compactGroups(await json<CompactCatalogue>('/api/v1/catalogue?view=compact',signal,4*1024**2),validationFixtures);}
function runControls(){
    const current=group??groups[0];
    const runs=groups.filter(item=>!current||item.selection.model===current.selection.model&&item.selection.field===current.selection.field);
    control('run').replaceChildren(...runs.map(item=>new Option((item.selection.fixture==='overlap'?'Тестовый расчёт · ':item.selection.fixture==='correction'?'Тестовая коррекция +1 K · ':'')+item.selection.model+' · '+timestamp(referenceTime(item.selection.run))+' · '+item.selection.revision.slice(0,8),item.key)));
    control('model').replaceChildren(...[...new Set(groups.map(item=>item.selection.model))].map(model=>new Option(model,model)));
    control('model').title='Опубликованные модели';if(group)control('model').value=group.selection.model;
    if(group)control('run').value=group.key;}
function sameRun(item:PublishedGroup){return group&&['model','run','field','level'].every(key=>item.selection[key as keyof Selection]===group!.selection[key as keyof Selection]);}
function updateActions(){
    const revision=pendingGroups?.find(sameRun);
    $('acceptUpdate').hidden=!revision||revision.key===group?.key;
    $('latestRun').hidden=!pendingGroups?.some(item=>!sameRun(item)&&referenceTime(item.selection.run)>referenceTime(group?.selection.run??''));
}
function updateMessage(message:string){text('updateStatus',message);$('updates').hidden=false;}
async function checkUpdates(manual=false){
    if(updateBusy)return;
    catalogueController.abort();catalogueController=new AbortController();const signal=catalogueController.signal;
    const previous=group,version=selectionVersion;
    try{
        const latest=await catalogue(signal);signal.throwIfAborted();
        if(previous!==group||version!==selectionVersion)return;
        if(group&&!latest.some(item=>item.key===group!.key)){
            const validTime=group.start+index*3600000;
            const replacement=withdrawnReplacement(group,latest,validTime);
            cancelTime();cancelUpdate();pointController.abort();reselectController.abort();
            ++selectionVersion;++viewVersion;
            series.clear();point=undefined;position=undefined;
            if(layer)layer.fieldVisible=false;map?.triggerRepaint();
            displayed=undefined;selected=undefined;metadata=undefined;data=undefined;
            groups=latest;pendingGroups=undefined;runControls();updateActions();
            timeState='withdrawn';selectionDetails();renderPoint('Публикация снята');
            notice('Публикация снята');updateMessage('Публикация снята');catalogueChecks++;
            if(replacement){
                group=replacement;index=(validTime-replacement.start)/3600000;timeState='missing';
                updateMessage('Снятая редакция заменена публикацией с сохранившимися данными.');
                runControls();timeControls();void chooseTime(index);
            }
            return;
        }
        const newestRevision=latest.find(sameRun);
        const changed=Boolean(newestRevision&&newestRevision.key!==group?.key)||latest.some(item=>!sameRun(item)&&referenceTime(item.selection.run)>referenceTime(group?.selection.run??''));
        pendingGroups=changed?latest:undefined;updateActions();
        catalogueChecks++;
        if(changed&&JSON.stringify(latest.map(item=>item.key))!==dismissedPublication)
            updateMessage('Есть новая публикация. Текущая выборка сохранена до подтверждения.');
        else if(manual)updateMessage(changed?'Обновление отложено. Выборка сохранена.':'Новых публикаций нет.');
    }catch(error){if(!signal.aborted){pendingGroups=undefined;updateActions();updateMessage('Не удалось проверить обновления. Текущая выборка сохранена.');}}
}
async function acceptPublication(newRun=false){
    if(updateBusy||timeState==='loading'||!pendingGroups||!group||!map||(selected&&!layer?.ready)||lost||rendererError)return;
    const catalogueSnapshot=pendingGroups;
    const target=catalogueSnapshot.find(item=>newRun?!sameRun(item)&&referenceTime(item.selection.run)>referenceTime(group!.selection.run):sameRun(item));
    if(!target||target.key===group.key)return;
    const targetIndex=newRun?0:Math.round((group.start+index*3600000-target.start)/3600000);
    const current=target.times[targetIndex];
    if(!current){updateMessage('Выбранный срок отсутствует в новой редакции. Текущая выборка сохранена.');return;}
    cancelUpdate();catalogueController.abort();updateController=new AbortController();updateBusy=true;
    const transaction=updateController;
    const signal=AbortSignal.any([transaction.signal,AbortSignal.timeout(30000)]),owner=map;
    const oldSelection=selected,oldPosition=position;
    updateMessage('Загрузка обновления… Текущая выборка остаётся доступна.');
    let candidate:WeatherLayer|undefined;
    const abortField=()=>updateLoader.cancel();signal.addEventListener('abort',abortField,{once:true});
    try{
        updateStagingBytes=reserveFrame(current);
        const fieldPromise=updateLoader.load(current);
        const [field,description,nextPoint]=await Promise.all([fieldPromise,json<SourceDescription>(current.collection,signal),
            !newRun&&oldPosition?pointValue(current,oldPosition,signal):Promise.resolve(undefined)]);
        signal.throwIfAborted();
        if(owner!==map||oldSelection!==selected)return;
        candidate=await prepareLayer(field,owner,signal);
        signal.throwIfAborted();if(owner!==map||oldSelection!==selected)return;
        pointController.abort();replaceLayer(candidate);
        data=field;metadata=description;selected=current;displayed=current;timeState='ready';group=target;index=targetIndex;
        if(mode!=='mercator'&&!candidate.context)candidate.context=new LocalContext(map,coverage(mode==='orthographic'),mode);
        groups=catalogueSnapshot;pendingGroups=undefined;runControls();timeControls();selectionDetails();
        series.clear();point=nextPoint;if(newRun){position=undefined;pointCollapsed=false;}
        ensureSeries(nextPoint);
        candidate.setPalette(alternate);renderPoint('');updateActions();
        updateMessage('Публикация обновлена по вашему запросу.');layout();
    }catch(error){if(!transaction.signal.aborted)
        updateMessage('Не удалось принять обновление. Текущая выборка сохранена. Повторите попытку.');
    }finally{
        signal.removeEventListener('abort',abortField);
        if(candidate&&candidate!==layer&&owner.getLayer(candidate.id))owner.removeLayer(candidate.id);
        if(transaction===updateController){updateBusy=false;updateLoader.cancel();updateStagingBytes=0;}
    }
}
$('refresh').onclick=()=>void checkUpdates(true);
$('acceptUpdate').onclick=()=>void acceptPublication();
$('latestRun').onclick=()=>void acceptPublication(true);
$('declineUpdate').onclick=()=>{cancelUpdate();dismissedPublication=JSON.stringify(pendingGroups?.map(item=>item.key));$('updates').hidden=true;};
const poll=setInterval(()=>{if(!document.hidden)void checkUpdates();},60000);
async function boot(){
    bootController.abort();bootController=new AbortController();notice('Загрузка опубликованных прогнозов…');
    try{groups=await catalogue();if(!groups.length){notice('Опубликованные прогнозы недоступны.');return;}
        const initial=groups.find(item=>item.selection.model===groups[0].selection.model&&item.selection.field_short_name==='t'&&item.selection.field_level_type==='surface')??groups[0];
        setGroup(initial);
    }catch(error){notice((error as Error).name==='AbortError'?'Загрузка отменена.':'Сервис прогнозов недоступен. Откройте настройки и повторите загрузку.');}
}
addEventListener('pagehide',()=>{clearInterval(poll);reselectController.abort();series.clear();cancelTime();cancelUpdate();catalogueController.abort();++viewVersion;++selectionVersion;data=undefined;loader.cancel();pointController.abort();bootController.abort();cancelAnimationFrame(inertia);ownedCanvas=undefined;releaseLayer();map?.remove();});
// Read-only numerical evidence surface, enabled solely by an explicit validation URL.
function numericalView(){
    if(!layer?.ready||lost||layer.wind||timeState!=='ready'||updateBusy||timeStagingBytes||updateStagingBytes)return undefined;
    const view=layer.samples(),p=projection();
    const cases:[string,number[]][]=[['pole',[90,90]],['dateline-positive',[180,80]],['dateline-negative',[-180,80]]];
    if(mode==='laea')cases.push(['south-of-cut',[90,44.999]],['north-of-cut',[90,45.001]]);
    const positions=cases.map(([label,point])=>[label,...p.forward(point)]).filter(item=>item.slice(1).every(Number.isFinite));
    if(mode==='orthographic')positions.push(['horizon-inside',6378137*.9999,0],['horizon-outside',6378137*1.0001,0]);
    const dpr=view.width/map.getContainer().clientWidth;
    return {...view,synthetic_geometry:layer.positions(positions),controls:[
        ...[...document.querySelectorAll<HTMLElement>('.mapLabel')].filter(label=>!label.hidden).map(label=>{
            const rect=label.getBoundingClientRect();return {point:JSON.parse(label.dataset.point!),pixel:[rect.left*dpr,rect.top*dpr],source:'laid-out DOM label'};}),
        ...(layer.context?[[37.6173,55.7558],[30.3158,59.9391]].map(point=>({point,pixel:layer!.context!.project(point),source:'local Canvas2D context'})):[])
    ]};
}
if(validation){
    Object.assign(window,{captureWeatherEvidence:(samples=false)=>({ready:Boolean(layer?.ready&&layer.fieldVisible&&!lost&&timeState==='ready'),frame_visible:Boolean(layer?.ready&&layer.fieldVisible&&!lost),mode,selected,displayed,time_state:timeState,time_error:timeError,position,point,
        series:{key:series.key,entries:series.entries,expired:series.expired,busy:series.busy,requests:series.requests,elapsed_ms:series.elapsedMs},
        view:samples?numericalView():undefined,transfer_bytes:data?.bytes,load_ms:data?.load_ms,
        map_zoom:map?.getZoom(),view_geometry:layer?.geometry(),view_center:[...center],native_bounds:data?.metadata.grid.outer_cell_edges_wsen,source_crs:data?.metadata.source_crs,
        synthetic_masks:samples&&layer?.ready&&!lost&&data?.metadata.grid.shape_yx.join(',')==='657,1377'?layer.syntheticMasks():undefined,
        managed_bytes:!lost?(timeStagingBytes||updateStagingBytes?stagingBase():layer?.checkBudget()??0)+timeStagingBytes+updateStagingBytes+SERIES_BUDGET+CATALOGUE_BUDGET:undefined,context_lost:lost,renderer_error:rendererError,
        first_complete_ms:firstCompleteMs,render_frames_ms:[...frames],render_times_ms:[...renderTimes],warm_switch_ms:warmSwitchMs,
        rendered:lastRendered,
        catalogue_checks:catalogueChecks,catalogue_pending:Boolean(pendingGroups),
        upload_timings:layer?.uploadTimings,decode_timings:data?.decode_ms,wind_decode_timings:data?.wind?.decode_ms,
        portrayal_baseline:portrayalBaseline,wind:layer?.wind?.evidence(),screen_pick:screenPick})});
}
palette();layout();void boot();
