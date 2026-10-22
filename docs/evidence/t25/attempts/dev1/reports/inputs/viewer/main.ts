import {publishedGroups,referenceTime,type Selection,type PublishedGroup} from './selection.js';
import {FieldLoader,json,PublicationExpired,type FieldData} from './field.js';
import {create,clippedLine} from './geometry.js';
import {WeatherLayer} from './weather-layer.js';
import {nativeToWgs} from './native-layer.js';
import {LocalContext} from './local-context.js';

type Mode='mercator'|'orthographic'|'laea';
type Position={lng:number;lat:number};
interface PointResult {selection:string;run:string;revision:string;valid_time:string;field:string;
    units:string;value:number|null;reason:string|null;spatial_selection:string;source:unknown;
    cell:{row:number;column:number;lon:number;lat:number}|null}
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const control=(id:string)=>$<HTMLSelectElement>(id);
const text=(id:string,value:string)=>{$(id).textContent=value;};
const mobile=()=>matchMedia('(max-width:700px), (max-height:600px) and (orientation:landscape)').matches;
const loader=new FieldLoader();
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
let metadata:unknown,bootController=new AbortController(),pendingGroups:PublishedGroup[]|undefined;
const updateLoader=new FieldLoader();
let updateController=new AbortController(),catalogueController=new AbortController(),updateBusy=false;
let stagedLayer:WeatherLayer|undefined,stagedMap:any,dismissedPublication='',updateSerial=0;
let timeController=new AbortController(),displayed:Selection|undefined;
let timeState:'loading'|'ready'|'missing'|'error'|'expired'='missing',pointMessage='';
function cancelTime(){timeController.abort();loader.cancel();}
function cancelUpdate(){
    const wasBusy=updateBusy;
    updateController.abort();updateLoader.cancel();updateBusy=false;
    if(stagedLayer&&stagedMap?.getLayer(stagedLayer.id))stagedMap.removeLayer(stagedLayer.id);
    stagedLayer=undefined;stagedMap=undefined;
    if(wasBusy)updateMessage('Обновление отменено. Текущая выборка сохранена.');
}
let firstCompleteMs:number|undefined,lastFrame:number|undefined;const frames:number[]=[];
const renderTimes:number[]=[];let warmSwitchMs:number|undefined;
const panels=['forecastPanel','navigationPanel','legendPanel','timelinePanel'].map(id=>$<HTMLDetailsElement>(id));
const timestamp=(value:string)=>new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',dateStyle:'short',timeStyle:'short'}).format(new Date(value))+' UTC';
const degrees=(value:number)=>value.toFixed(3)+'°';
const valueText=(value:number)=> (value-(unit==='C'?273.15:0)).toFixed(2)+' '+(unit==='C'?'°C':'K');
function notice(message:string){text('notice',message);$('notice').hidden=!message;}
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
    text('reference','Расчёт: '+timestamp(referenceTime(source.run)));
    const valid=new Date(group.start+index*3600000).toISOString();
    const shown=displayed?timestamp(displayed.valid_time):'нет поля';
    text('valid','Показано: '+shown);text('compactTime',shown);
    text('timeLabel',timestamp(valid)+(timeState==='loading'?' · загружается':timeState==='error'?' · ошибка загрузки':timeState==='expired'?' · публикация истекла':''));
    text('selectionIdentity','Редакция '+source.revision.slice(0,12));
    text('forecastSummary',(source.fixture==='overlap'?'Тестовый перекрывающийся расчёт · ':source.fixture==='correction'?'Тестовая коррекция +1 K · ':'')+source.model+' · '+timestamp(referenceTime(source.run)));
    text('availability',timeState==='loading'?'Загрузка выбранного срока':timeState==='error'?'Ошибка загрузки срока':timeState==='expired'?'Публикация истекла':selected?'Срок опубликован':'Срок отсутствует');
    const age=Math.max(0,Math.floor((Date.now()-Date.parse(referenceTime(source.run)))/3600000));
    const completeness=source.completeness==='complete'?'полный':source.completeness==='partial'?'неполный':'неизвестна';
    text('metadata','Возраст расчёта: '+age+' ч. Полнота: '+completeness+'. '+
        'Опубликовано сроков: '+group.times.filter(Boolean).length+'. '+
        'Источник: DWD ICON-EU, T_G, поверхность. Выборка: '+(selected?.selection??'отсутствует')+'. '+
        (metadata?'Происхождение: '+JSON.stringify(metadata):''));
}
function timeControls(){
    if(!group)return;
    control('time').replaceChildren(...group.times.map((item,i)=>new Option(timestamp(new Date(group!.start+i*3600000).toISOString())+(item?'':' · отсутствует'),String(i))));
    const range=$<HTMLInputElement>('timeRange');range.min='0';range.max=String(group.times.length-1);range.step='1';
    syncTime();
}
function syncTime(){control('time').value=String(index);$<HTMLInputElement>('timeRange').value=String(index);
    $<HTMLButtonElement>('previous').disabled=index===0;$<HTMLButtonElement>('next').disabled=index===(group?.times.length??1)-1;}
function setGroup(newGroup:PublishedGroup){clearPoint();group=newGroup;index=0;timeControls();void chooseTime(0);}
function clearPoint(){cancelUpdate();pointController.abort();point=undefined;position=undefined;pointCollapsed=false;
    $('drawer').hidden=true;$('settings').setAttribute('aria-expanded','false');placePoint();}
function releaseLayer(){
    const previous=layer;layer=undefined;
    previous?.context?.remove();
    if(previous&&map?.getLayer(previous.id))map.removeLayer(previous.id);
}
async function prepareLayer(field:FieldData,owner:any,signal:AbortSignal){
    const extra=field.bytes+258*258*8+258*258*18*8;
    if((layer?.checkBudget()??owner.getCanvas().width*owner.getCanvas().height*28)+extra>128*1024**2)
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
    if(!group)return;index=Math.max(0,Math.min(group.times.length-1,next));syncTime();
    cancelTime();cancelUpdate();pointController.abort();point=undefined;
    const version=++selectionVersion;++viewVersion;
    selected=group.times[index]??undefined;
    timeState=selected?'loading':'missing';
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
        const [field,description]=await Promise.all([loader.load(current),json<unknown>(current.collection,loader.controller.signal)]);
        signal.throwIfAborted();if(version!==selectionVersion)return;
        if(!map){
            data=field;metadata=description;await rebuild(true);
            signal.throwIfAborted();if(version!==selectionVersion)return;
            if(!layer)throw Error('Слой не создан');
            await layer.prepared(signal);
        }else{
            owner=map;candidate=await prepareLayer(field,owner,signal);
            signal.throwIfAborted();if(version!==selectionVersion||owner!==map)return;
            replaceLayer(candidate);data=field;metadata=description;
        }
        displayed=current;timeState='ready';selectionDetails();notice('');renderPoint('');
        if(position)void refreshPoint(current,position);
    }catch(error){if(version===selectionVersion&&!transaction.signal.aborted){
        timeState=error instanceof PublicationExpired?'expired':'error';
        if(timeState==='expired'){if(layer)layer.fieldVisible=false;map?.triggerRepaint();displayed=undefined;metadata=undefined;}
        selectionDetails();renderPoint(timeState==='expired'?'Публикация истекла':'Не удалось загрузить выбранный срок');
        notice(timeState==='expired'?'Публикация истекла. Проверьте обновления.':
            'Не удалось загрузить выбранный срок. '+(displayed?'Сохранено поле: '+timestamp(displayed.valid_time)+'. ':'')+'Повторите загрузку.');
    }}finally{
        signal.removeEventListener('abort',abort);
        if(candidate&&candidate!==layer&&owner?.getLayer(candidate.id))owner.removeLayer(candidate.id);
        if(stagedLayer===candidate){stagedLayer=undefined;stagedMap=undefined;}
        if(transaction===timeController)loader.cancel();
    }
}
function coverage(raw=false){
    const [west,south,east,north]=data!.metadata.grid.outer_cell_edges_wsen,ring:number[][]=[];
    for(let i=0;i<=160;i++)ring.push([west+(east-west)*i/160,nativeToWgs(south)]);
    for(let i=0;i<=100;i++)ring.push([east,nativeToWgs(south+(north-south)*i/100)]);
    for(let i=0;i<=160;i++)ring.push([east-(east-west)*i/160,nativeToWgs(north)]);
    for(let i=0;i<=100;i++)ring.push([west,nativeToWgs(north-(north-south)*i/100)]);
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
        void chooseTime(index);});
        layer=new WeatherLayer(currentData,mode==='laea'?'EPSG:3576':mode==='orthographic'?'hmc:orthographic':'mercator',projection(),center);
        layer.fieldVisible=timeState!=='missing'&&timeState!=='expired';
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
            if(layer?.ready&&!lost){firstCompleteMs??=now;renderTimes.push(now);if(renderTimes.length>120)renderTimes.shift();
                if($('notice').textContent==='Загрузка числового поля…')notice('');
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
    if(mode==='orthographic')rotate([(w+e)/2,(nativeToWgs(s)+nativeToWgs(n))/2]);
    const south=mode==='laea'?Math.max(45,nativeToWgs(s)):nativeToWgs(s);
    const points:number[][]=[];
    for(let i=0;i<=60;i++)for(const lat of [south,nativeToWgs(n)])points.push([w+(e-w)*i/60,lat]);
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
    if(message)notice(message);
    else if($('notice').textContent?.startsWith('Точка сохранена'))notice('');
    const pixel=layer.project([position.lng,position.lat]);
    const onscreen=!hidden&&pixel.x>=0&&pixel.x<=innerWidth&&pixel.y>=0&&pixel.y<=innerHeight;
    $('pointMarker').hidden=!onscreen;
    Object.assign($('pointMarker').style,{left:pixel.x+'px',top:pixel.y+'px'});
    if(!onscreen||mobile()||pointCollapsed)return;
    const card=$('pointCard');card.hidden=false;
    Object.assign(card.style,{left:Math.max(10,Math.min(innerWidth-310,pixel.x+18))+'px',top:Math.max(70,Math.min(innerHeight-card.offsetHeight-165,pixel.y-30))+'px'});
}
function renderPoint(message=pointMessage){
    pointMessage=message;
    for(const id of ['pointContent','mobilePoint']){
        const container=$(id);container.replaceChildren();
        const coordinate=document.createElement('small');coordinate.textContent=position?degrees(position.lng)+' в. д. · '+degrees(position.lat)+' с. ш.':'';
        const value=document.createElement('strong');value.textContent=message||(point?.value!=null?valueText(point.value):
            point?.reason==='outside_coverage'?'Вне покрытия':point?.reason==='native_nodata'?'Нет данных в нативной ячейке':'Загрузка значения…');
        value.classList.toggle('pointMessage',Boolean(message));
        const details=document.createElement('details'),summary=document.createElement('summary'),provenance=document.createElement('p');
        summary.textContent='Ячейка и происхождение';provenance.textContent=point?
            'Ближайшая нативная ячейка · точный срок UTC. '+(point.cell?`Строка ${point.cell.row}, столбец ${point.cell.column}; ${degrees(point.cell.lon)}, ${degrees(point.cell.lat)}. `:'')+
            'Выборка: '+point.selection+'. Редакция: '+point.revision+'. Источник: '+JSON.stringify(point.source):'';
        details.append(summary,provenance);container.append(coordinate,value,details);
    }
    placePoint();
}
async function pickScreen(event:any){
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
    cancelUpdate();pointController.abort();
    position=candidate;point=undefined;pointCollapsed=false;
    renderPoint(timeState==='loading'?'Загрузка значения выбранного срока…':timeState==='missing'?'Срок отсутствует':timeState==='expired'?'Публикация истекла':timeState==='error'?'Не удалось загрузить выбранный срок':'');
    if(mobile())openDrawer(true);
    if(selected&&timeState==='ready')await refreshPoint(selected,candidate);
}
async function refreshPoint(current:Selection,candidate:Position){
    pointController.abort();pointController=new AbortController();const signal=pointController.signal;
    point=undefined;renderPoint('');
    try{
        const result=await pointValue(current,candidate,signal);signal.throwIfAborted();if(current!==selected)return;
        point=result;renderPoint('');
    }catch(error){if(!signal.aborted){
        if(error instanceof PublicationExpired){
            cancelTime();timeState='expired';if(layer)layer.fieldVisible=false;map?.triggerRepaint();displayed=undefined;point=undefined;
            selectionDetails();notice('Публикация истекла. Проверьте обновления.');renderPoint('Публикация истекла');
        }else renderPoint('Не удалось получить значение. Повторите выбор точки.');
    }}
}
async function pointValue(current:Selection,candidate:Position,signal:AbortSignal){
    const query=new URLSearchParams({selection:current.selection,run:current.run,revision:current.revision,
        valid_time:current.valid_time,layer:current.field,lon:String(candidate.lng),lat:String(candidate.lat),
        crs:'http://www.opengis.net/def/crs/OGC/1.3/CRS84'});
    const result=await json<PointResult>('/api/v1/point?'+query,signal);signal.throwIfAborted();
    if(['selection','run','revision','valid_time','field'].some(key=>result[key as keyof PointResult]!==current[key as keyof Selection])||
        result.spatial_selection!=='nearest-native-cell'||result.units!=='K')throw Error('Несогласованное значение точки.');
    return result;
}
function changeProjection(next:Mode,fit=false){
    if(timeState==='loading'){cancelTime();++selectionVersion;timeState='error';selectionDetails();}
    cancelUpdate();pointController.abort();pointController=new AbortController();
    const signal=pointController.signal,current=selected,candidate=position;
    mode=next;control('projection').value=mode;void rebuild(fit);
    if(current&&candidate&&timeState==='ready'){
        point=undefined;renderPoint();
        void pointValue(current,candidate,signal).then(result=>{
            if(!signal.aborted&&current===selected&&candidate===position){point=result;renderPoint();}
        }).catch(()=>{if(!signal.aborted)renderPoint('Не удалось получить значение. Повторите выбор точки.');});
    }
}
function openDrawer(pointMode=false){
    if(mobile())for(const panel of panels)panel.open=false;
    $('drawer').hidden=false;$('drawer').classList.toggle('pointMode',pointMode);
    $('settingsBody').hidden=pointMode;$('mobilePoint').hidden=!pointMode;
    text('closeDrawer',pointMode?'⌄':'Свернуть ⌄');
    $('clearMobilePoint').hidden=!position;
    $('sheetPoint').hidden=!position;
    $('settings').setAttribute('aria-expanded','true');layout();
}
function palette(){
    for(const e of document.querySelectorAll('.unit'))e.textContent=unit==='C'?'°C':'K';
    text('legendSummary','Температура · '+(unit==='C'?'°C':'K'));
    const ticks=document.querySelectorAll('.ticks span');[-20,0,20,40].forEach((value,i)=>ticks[i].textContent=String(unit==='C'?value:value+273.15));
    const ramp=document.querySelector<HTMLElement>('.ramp')!;
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
    map?.resize();placePoint();
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
$('settings').onclick=()=>openDrawer();$('temperature').onclick=()=>openDrawer();
$('sheetSettings').onclick=()=>openDrawer();$('sheetPoint').onclick=()=>openDrawer(true);
$('closeDrawer').onclick=()=>{$('drawer').hidden=true;$('settings').setAttribute('aria-expanded','false');pointCollapsed=true;layout();};
$('showPoint').onclick=()=>{pointCollapsed=false;if(mobile())openDrawer(true);placePoint();};
$('closePoint').onclick=clearPoint;
$('clearMobilePoint').onclick=clearPoint;
addEventListener('keydown',event=>{if(event.key==='Escape')clearPoint();});
control('basemap').onchange=()=>{light=control('basemap').value==='light';updateBasemap();};
control('font').onchange=()=>{document.documentElement.style.setProperty('--page-font',control('font').value==='courier'?'"Courier New",monospace':'system-ui,"Segoe UI",sans-serif');layout();};
$('retry').onclick=()=>groups.length?void chooseTime(index):void boot();
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
async function catalogue(signal=bootController.signal){return publishedGroups((await json<{selections:Selection[]}>('/api/v1/catalogue',signal)).selections,validationFixtures);}
function runControls(){control('run').replaceChildren(...groups.map(item=>new Option((item.selection.fixture==='overlap'?'Тестовый расчёт · ':item.selection.fixture==='correction'?'Тестовая коррекция +1 K · ':'')+item.selection.model+' · '+timestamp(referenceTime(item.selection.run))+' · '+item.selection.revision.slice(0,8),item.key)));
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
    try{
        const latest=await catalogue(signal);signal.throwIfAborted();
        const newestRevision=latest.find(sameRun);
        const changed=Boolean(newestRevision&&newestRevision.key!==group?.key)||latest.some(item=>!sameRun(item)&&referenceTime(item.selection.run)>referenceTime(group?.selection.run??''));
        pendingGroups=changed?latest:undefined;updateActions();
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
        const fieldPromise=updateLoader.load(current);
        const [field,description,nextPoint]=await Promise.all([fieldPromise,json<unknown>(current.collection,signal),
            !newRun&&oldPosition?pointValue(current,oldPosition,signal):Promise.resolve(undefined)]);
        signal.throwIfAborted();
        if(owner!==map||oldSelection!==selected)return;
        candidate=await prepareLayer(field,owner,signal);
        signal.throwIfAborted();if(owner!==map||oldSelection!==selected)return;
        pointController.abort();replaceLayer(candidate);
        data=field;metadata=description;selected=current;displayed=current;timeState='ready';group=target;index=targetIndex;
        if(mode!=='mercator'&&!candidate.context)candidate.context=new LocalContext(map,coverage(mode==='orthographic'),mode);
        groups=catalogueSnapshot;pendingGroups=undefined;runControls();timeControls();selectionDetails();
        point=nextPoint;if(newRun){position=undefined;pointCollapsed=false;}
        candidate.setPalette(alternate);renderPoint('');updateActions();
        updateMessage('Публикация обновлена по вашему запросу.');layout();
    }catch(error){if(!transaction.signal.aborted)
        updateMessage('Не удалось принять обновление. Текущая выборка сохранена. Повторите попытку.');
    }finally{
        signal.removeEventListener('abort',abortField);
        if(candidate&&candidate!==layer&&owner.getLayer(candidate.id))owner.removeLayer(candidate.id);
        // A newer transaction may already own staging resources.
        if(stagedLayer===candidate){stagedLayer=undefined;stagedMap=undefined;}
        if(transaction===updateController){updateBusy=false;updateLoader.cancel();}
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
        runControls();setGroup(groups[0]);control('run').value=groups[0].key;
    }catch(error){notice((error as Error).name==='AbortError'?'Загрузка отменена.':'Сервис прогнозов недоступен. Откройте настройки и повторите загрузку.');}
}
addEventListener('pagehide',()=>{clearInterval(poll);cancelTime();cancelUpdate();catalogueController.abort();++viewVersion;++selectionVersion;data=undefined;loader.cancel();pointController.abort();bootController.abort();cancelAnimationFrame(inertia);ownedCanvas=undefined;releaseLayer();map?.remove();});
// Read-only numerical evidence surface, enabled solely by an explicit validation URL.
function numericalView(){
    if(!layer?.ready||lost)return undefined;
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
    Object.assign(window,{captureWeatherEvidence:(samples=false)=>({ready:Boolean(layer?.ready&&layer.fieldVisible&&!lost&&timeState==='ready'),mode,selected,displayed,time_state:timeState,position,point,
        view:samples?numericalView():undefined,transfer_bytes:data?.bytes,load_ms:data?.load_ms,
        synthetic_masks:samples&&layer?.ready&&!lost?layer.syntheticMasks():undefined,
        managed_bytes:!lost?layer?.checkBudget():undefined,context_lost:lost,renderer_error:rendererError,
        first_complete_ms:firstCompleteMs,render_frames_ms:[...frames],render_times_ms:[...renderTimes],warm_switch_ms:warmSwitchMs,
        upload_timings:layer?.uploadTimings,screen_pick:screenPick})});
}
palette();layout();void boot();
