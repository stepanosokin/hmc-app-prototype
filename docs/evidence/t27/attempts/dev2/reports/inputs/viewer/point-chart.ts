import type {PointSeries,SeriesEntry} from './series.js';
const labels={loading:'Загрузка',missing:'Срок отсутствует',outside_coverage:'Вне покрытия',native_nodata:'Нет данных в нативной ячейке',error:'Ошибка запроса',value:''};
const utc=(time:string)=>new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',dateStyle:'short',timeStyle:'short'}).format(new Date(time))+' UTC';
const svgElement=(tag:string,attributes:Record<string,string|number>)=>{
    const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [name,value] of Object.entries(attributes))node.setAttribute(name,String(value));return node;
};
/** Keyboard range previews values; Enter, Space or the button explicitly selects time. */
export class PointChart {
    readonly element=document.createElement('figure');
    private caption=document.createElement('figcaption');
    private status=document.createElement('p');
    private svg=svgElement('svg',{viewBox:'0 0 264 110',role:'img','aria-label':'Прогнозный ряд. Разрывы означают отсутствие значения.'});
    private range=document.createElement('input');
    private tooltip=document.createElement('output');
    private select=document.createElement('button');
    private retry=document.createElement('button');
    private series:PointSeries|undefined;
    private selected=0;
    private preview=0;
    private key='';
    private format=(value:number)=>String(value);
    constructor(privateChoose:(index:number)=>void){
        this.element.className='pointChart realPointChart';this.caption.textContent='Прогноз выбранной точки';
        this.range.type='range';this.range.min='0';this.range.step='1';this.range.setAttribute('aria-label','Просмотреть срок графика');
        this.range.oninput=()=>{this.preview=Number(this.range.value);this.describe();};
        this.range.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();privateChoose(this.preview);}};
        this.select.textContent='Выбрать этот срок';this.select.onclick=()=>privateChoose(this.preview);
        this.retry.textContent='Повторить ошибки ряда';this.retry.onclick=()=>void this.series?.retry();
        const locate=(event:PointerEvent|MouseEvent)=>{
            const rect=this.svg.getBoundingClientRect(),count=this.series?.entries.length??0;
            this.preview=Math.max(0,Math.min(count-1,Math.round(((event.clientX-rect.left)/rect.width*264-12)/240*(count-1))));
            this.range.value=String(this.preview);this.describe();
        };
        this.svg.addEventListener('pointermove',locate);
        this.svg.addEventListener('click',event=>{locate(event);privateChoose(this.preview);});
        this.element.append(this.caption,this.status,this.svg,this.range,this.tooltip,this.select,this.retry);
    }
    update(series:PointSeries,selected:number,format:(value:number)=>string){
        const changed=this.key!==series.key||this.selected!==selected;this.key=series.key;
        this.series=series;this.selected=selected;this.format=format;
        if(changed||!this.element.isConnected)this.preview=selected;
        const entries=series.entries,values=entries.flatMap(e=>e.result?.value!=null?[e.result.value]:[]);
        const low=Math.min(...values),high=Math.max(...values),span=Math.max(1,high-low);
        const x=(i:number)=>12+i/Math.max(1,entries.length-1)*240;
        const y=(v:number)=>88-(v-low)/span*68;
        const nodes:Element[]=[];let path='';
        for(const [i,entry] of entries.entries()){
            if(entry.state!=='value'||entry.result?.value==null){path='';continue;}
            const next=`${x(i)},${y(entry.result.value)}`;
            if(path)nodes.push(svgElement('path',{d:`M${path} L${next}`,class:'forecastLine'}));
            nodes.push(svgElement('circle',{cx:x(i),cy:y(entry.result.value),r:i===selected?4:2,class:i===selected?'selectedValue':'seriesValue'}));
            path=next;
        }
        nodes.push(svgElement('line',{x1:x(selected),x2:x(selected),y1:8,y2:94,class:'nowLine'}));
        for(const [i,anchor] of [[0,'start'],[entries.length-1,'end']] as const){
            if(!entries[i])continue;
            const label=svgElement('text',{x:x(i),y:108,'text-anchor':anchor});label.textContent=entries[i].time.slice(11,16)+' UTC';nodes.push(label);
        }
        this.svg.replaceChildren(...nodes);
        const successes=entries.filter(e=>e.result).length,errors=entries.filter(e=>e.state==='error').length;
        this.status.textContent=series.expired?'Публикация истекла. Перевыберите публикацию.':
            series.busy?`Загрузка ряда: ${successes} из ${entries.filter(e=>e.selection).length}`:
            errors?`${successes?'Частичный ряд':'Не удалось загрузить ряд'} · ошибок: ${errors}`:'Ближайшая нативная ячейка · весь опубликованный прогноз';
        this.retry.hidden=!errors||series.expired;this.retry.disabled=series.busy;
        this.range.max=String(Math.max(0,entries.length-1));this.range.value=String(this.preview);
        this.range.disabled=series.expired||!entries.length;this.select.disabled=this.range.disabled;
        this.describe();
    }
    private describe(){
        const entry:SeriesEntry|undefined=this.series?.entries[this.preview];if(!entry)return;
        const description=utc(entry.time)+' · '+(entry.result?.value!=null?this.format(entry.result.value):labels[entry.state]);
        this.tooltip.textContent=description+(this.preview===this.selected?' · выбран':'');
        this.range.setAttribute('aria-valuetext',description);
    }
}
