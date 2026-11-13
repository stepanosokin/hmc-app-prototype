import {referenceTime,type Selection,type PublishedGroup} from './selection.js';
import {nativeToWgs} from './native-layer.js';
import {nativePosition} from './source-crs.js';
import {fieldPresentation} from './fields.js';
import {displaySpec} from './display-units.js';
import type {Position} from './series.js';

export interface SourceDescription {
    source_crs?: unknown;
    identity?:{revision:string;valid_time:string};
    source?:{name?:string};
}
type State='loading'|'ready'|'missing'|'error'|'expired'|'withdrawn';
const element=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
/** WMS pins the latest catalogue; point/metadata describe the selected forecast. */
export class SourceSettings {
    private wms='';
    private wmsLoad:Promise<string>|undefined;
    private status(text:string){
        element('copyStatus').textContent=text;
        element('wmsQuickStatus').textContent=text;
    }
    private async loadWms(fresh=false):Promise<string>{
        if(this.wms&&!fresh)return this.wms;
        if(!this.wmsLoad)this.wmsLoad=(async()=>{
            const response=await fetch('/gis/v1/wms?SERVICE=WMS&REQUEST=GetCapabilities');
            if(!response.ok)throw Error('Общий WMS временно недоступен. Повторите копирование.');
            const xml=new DOMParser().parseFromString(await response.text(),'application/xml');
            const resource=xml.querySelector('Request > GetCapabilities OnlineResource');
            const href=resource?.getAttributeNS('http://www.w3.org/1999/xlink','href');
            if(!href)throw Error('Не удалось получить общую ссылку WMS.');
            const url=new URL(href,location.origin);
            if(url.origin!==location.origin||url.pathname!=='/gis/v1/wms'||!url.searchParams.has('snapshot'))throw Error('Некорректная общая ссылка WMS.');
            // Keep only the advertised immutable reference, suitable for QGIS' URL field.
            url.search=new URLSearchParams({snapshot:url.searchParams.get('snapshot')!}).toString();
            this.wms=url.href;
            const input=element<HTMLInputElement>('wmsUrl'),link=element<HTMLAnchorElement>('wmsLink');
            input.value=this.wms;input.disabled=false;link.href=this.wms;link.setAttribute('aria-disabled','false');
            for(const id of ['wmsCopy','wmsQuickCopy'])element<HTMLButtonElement>(id).disabled=false;
            return this.wms;
        })();
        try{return await this.wmsLoad;}finally{this.wmsLoad=undefined;}
    }
    constructor(){
        for(const kind of ['wms','api']){
            element(kind+'Copy').onclick=async()=>{
                const input=element<HTMLInputElement>(kind+'Url');
                this.status(kind==='wms'?'Получение общей ссылки WMS…':'');
                let url=input.value;
                try{if(kind==='wms')url=await this.loadWms(true);}
                catch{this.status('Не удалось получить общую ссылку WMS. Повторите копирование.');return;}
                try{await navigator.clipboard.writeText(url);if(input.value===url)this.status('Адрес скопирован.');}
                catch{if(input.value===url){if(element('drawer').hidden)element<HTMLButtonElement>('settings').click();input.focus();input.select();this.status('Выделите и скопируйте адрес вручную.');}}
            };
        }
        element('wmsQuickCopy').onclick=()=>element<HTMLButtonElement>('wmsCopy').click();
    }
    update(group:PublishedGroup,index:number,current:Selection|undefined,position:Position|undefined,
        description:SourceDescription|undefined,state:State,shown:Selection|undefined,
        bounds:number[]|undefined,format:(time:string)=>string,temperatureUnit='C'){
        const source=group.selection,time=new Date(group.start+index*3600000).toISOString();
        const units=displaySpec(source,temperatureUnit).unit;
        const title=fieldPresentation(source).label;
        element('sourceDescription').textContent=source.model+' · '+title+'. '+(source.wind_v?'Карта: частицы по потоку U/V и цветная скорость ветра. Ряд точки: компонента U ветра.':'Значение точки — ближайшая нативная ячейка; отображение — билинейная интерполяция.');
        element('sourceUnitsInfo').textContent='Общий WMS содержит последние опубликованные расчёты. Выберите указанный слой в группе модели. Ссылка закрепляет каталог при получении. Для нового прогноза скопируйте новую ссылку, замените URL подключения QGIS и добавьте слой заново. API — за выбранным сроком и точкой. Единицы отображения: '+units+'.';
        const matching=current&&description?.identity?.revision===current.revision&&description.identity.valid_time===current.valid_time?description:undefined;
        const complete=source.completeness==='complete'?'полный':source.completeness==='partial'?'неполный':'неизвестна';
        const unavailable=state==='expired'||state==='withdrawn';
        const status={loading:'Загрузка',ready:'Срок опубликован',missing:'Срок отсутствует',error:'Ошибка загрузки',expired:'Публикация истекла',withdrawn:'Публикация снята'}[state];
        const rows=[['Источник',source.model],['Поле',title+(source.wind_v?' · ряд: компонента U':'')],
            ['Расчёт',format(referenceTime(source.run))],['Выбранный срок',format(time)],
            ['Редакция',source.revision.slice(0,12)],['Доступность',status],
            ['Полнота',complete],['Опубликовано сроков',String(group.times.filter(Boolean).length)],
            ['Возраст расчёта',Math.max(0,Math.floor((Date.now()-Date.parse(referenceTime(source.run)))/3600000))+' ч'],
            ['Числовой метод','Ближайшая нативная ячейка · точный срок · '+units]];
        if(current?.interval)rows.push(['Интервал',format(current.interval.start)+' — '+format(current.interval.end)+' · код статистической операции '+current.interval.statistical_process]);
        if(matching?.source?.name)rows.push(['Файл источника',matching.source.name]);
        if(shown&&shown.selection!==current?.selection)rows.push(['Показан прежний кадр',
            (shown.field_label??'Температура поверхности')+' · '+shown.units+' · расчёт '+format(referenceTime(shown.run))+' · срок '+format(shown.valid_time)+' · редакция '+shown.revision.slice(0,12)]);
        const nodes:HTMLElement[]=[];
        for(const [label,value] of rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;nodes.push(dt,dd);}
        element('metadata').replaceChildren(...nodes);
        element('linkSelection').textContent='Модель: '+source.model+' · Слой: '+title+', '+source.units;
        let api='';
        const wms=this.wms;
        if(!wms&&!this.wmsLoad)void this.loadWms().catch(()=>this.status('Не удалось получить общую ссылку WMS. Повторите копирование.'));
        // Default sample uses the published native coverage, converted to geographic coordinates.
        const sample=bounds?nativePosition(matching?.source_crs,[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2],true):undefined;
        const point=position??(sample?{lng:sample[0],lat:sample[1]}:undefined);
        if(current&&point&&!unavailable){
            const url=new URL(current.point,location.origin);
            url.search=new URLSearchParams({selection:current.selection,run:current.run,revision:current.revision,
                valid_time:current.valid_time,layer:current.field,lon:String(point.lng),lat:String(point.lat),
                crs:'http://www.opengis.net/def/crs/OGC/1.3/CRS84'}).toString();api=url.href;
        }
        element('linkPoint').textContent=unavailable?status+'. Перевыберите публикацию.':!current?'Срок отсутствует — запрос точки недоступен.':point?
            (position?'Выбранная точка: ':'Пример — центр покрытия: ')+point.lat.toFixed(4)+'° с. ш., '+point.lng.toFixed(4)+'° в. д. · '+format(time)+' · '+units:'Для примера дождитесь загрузки покрытия или выберите точку на карте.';
        for(const [kind,url] of [['wms',wms],['api',api]]){
            const link=element<HTMLAnchorElement>(kind+'Link'),input=element<HTMLInputElement>(kind+'Url');
            if(input.value!==url)element('copyStatus').textContent='';
            input.value=url;input.disabled=!url;element<HTMLButtonElement>(kind+'Copy').disabled=!url;
            if(url)link.href=url;else link.removeAttribute('href');link.setAttribute('aria-disabled',String(!url));
        }
        // Discovery can be retried even when the first request failed.
        for(const id of ['wmsCopy','wmsQuickCopy'])element<HTMLButtonElement>(id).disabled=false;
        const technical=element<HTMLAnchorElement>('metadataLink');
        if(current&&!unavailable)technical.href=new URL(current.collection,location.origin).href;else technical.removeAttribute('href');
        technical.hidden=!current||unavailable;
    }
}
