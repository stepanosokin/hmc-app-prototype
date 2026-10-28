import type {PointSeries,SeriesEntry} from './series.js';
import type {WindEntry} from './wind-overlay.js';
import {windBarb,windDescription} from './wind-values.js';
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
    private plot=document.createElement('div');
    private windLabel=document.createElement('small');
    private windEntries=new Map<string,WindEntry>();
    private windEnabled=false;
    private width=264;
    private format:(value:number,units:string)=>string=String;
    constructor(privateChoose:(index:number)=>void){
        this.element.className='pointChart realPointChart';this.caption.textContent='Прогноз выбранной точки';
        this.range.type='range';this.range.min='0';this.range.step='1';this.range.setAttribute('aria-label','Просмотреть срок графика');
        this.range.oninput=()=>{this.preview=Number(this.range.value);this.describe();};
        this.range.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();privateChoose(this.preview);}};
        this.select.textContent='Выбрать этот срок';this.select.onclick=()=>privateChoose(this.preview);
        this.retry.textContent='Повторить ошибки ряда';this.retry.onclick=()=>void this.series?.retry();
        const locate=(event:PointerEvent|MouseEvent)=>{
            const rect=this.svg.getBoundingClientRect(),count=this.series?.entries.length??0;
            this.preview=Math.max(0,Math.min(count-1,Math.round(((event.clientX-rect.left)/rect.width*this.width-12)/(this.width-24)*(count-1))));
            this.range.value=String(this.preview);this.describe();
        };
        this.svg.addEventListener('pointermove',locate);
        this.svg.addEventListener('click',event=>{if(this.series?.expired)return;locate(event);privateChoose(this.preview);});
        this.plot.className='pointPlot';this.plot.append(this.svg);
        this.element.append(this.caption,this.status,this.windLabel,this.plot,this.range,this.tooltip,this.select,this.retry);
    }
    setWind(entries:Map<string,WindEntry>,enabled:boolean,label:string,status:string){
        this.windEntries=entries;this.windEnabled=enabled;
        this.windLabel.hidden=!enabled;this.windLabel.textContent='Ветер · '+label+' · флажки в узлах · «откуда»'+(status?'. '+status:'');
        this.windLabel.title='Короткое перо — 5 узлов, полное — 10, треугольник — 50. Точная скорость в подписи — м/с.';
    }
    update(series:PointSeries,selected:number,format:(value:number,units:string)=>string){
        const changed=this.key!==series.key||this.selected!==selected;this.key=series.key;
        this.series=series;this.selected=selected;this.format=format;
        if(changed||!this.element.isConnected)this.preview=selected;
        const entries=series.entries,values=entries.flatMap(e=>e.result?.value!=null?[e.result.value]:[]);
        const low=Math.min(...values),high=Math.max(...values),span=Math.max(1e-30,Math.abs(low)*1e-6,high-low);
        this.width=this.windEnabled?Math.max(264,entries.length*28+24):264;
        const offset=this.windEnabled?50:0;
        this.svg.setAttribute('viewBox',`0 0 ${this.width} ${110+offset}`);
        this.svg.style.width=this.width+'px';this.svg.style.height=(110+offset)+'px';
        const x=(i:number)=>12+i/Math.max(1,entries.length-1)*(this.width-24);
        const y=(v:number)=>88+offset-(v-low)/span*68;
        const nodes:Element[]=[];let path='';
        if(this.windEnabled)for(const [i,entry] of entries.entries()){
            const wind=this.windEntries.get(entry.time);
            if(wind?.state==='value'&&wind.speed!==undefined){
                const barb=windBarb(wind.speed);
                if(wind.direction===null||barb.calm)nodes.push(svgElement('circle',{cx:x(i),cy:27,r:3,fill:'none',stroke:'currentColor'}));
                else{
                    const g=svgElement('g',{transform:`translate(${x(i)} 27) rotate(${wind.direction})`});
                    const symbol=svgElement('g',{transform:barb.transform});
                    symbol.append(svgElement('path',{d:barb.shaft+barb.feathers,fill:'none',stroke:'currentColor','stroke-width':1.1,'vector-effect':'non-scaling-stroke'}),svgElement('path',{d:barb.pennants,fill:'currentColor'}));g.append(symbol);
                    const title=svgElement('title',{});title.textContent=entry.time+' · '+windDescription({speed:wind.speed,direction:wind.direction??null});g.append(title);nodes.push(g);
                }
            }else{const label=svgElement('text',{x:x(i),y:30,'text-anchor':'middle'});label.textContent=wind?.state==='loading'?'…':wind?.state==='error'?'!':'—';nodes.push(label);}
        }
        for(const [i,entry] of entries.entries()){
            if(entry.state!=='value'||entry.result?.value==null){path='';continue;}
            const next=`${x(i)},${y(entry.result.value)}`;
            if(path)nodes.push(svgElement('path',{d:`M${path} L${next}`,class:'forecastLine'}));
            nodes.push(svgElement('circle',{cx:x(i),cy:y(entry.result.value),r:i===selected?4:2,class:i===selected?'selectedValue':'seriesValue'}));
            path=next;
        }
        nodes.push(svgElement('line',{x1:x(selected),x2:x(selected),y1:8,y2:94+offset,class:'nowLine'}));
        const ticks:readonly (readonly [number,string])[]=this.windEnabled?entries.map((_,i)=>[i,'middle'] as const):[[0,'start'],[entries.length-1,'end']];
        for(const [i,anchor] of ticks){
            if(!entries[i])continue;
            const label=svgElement('text',{x:x(i),y:108+offset,'text-anchor':anchor});label.textContent=entries[i].time.slice(11,this.windEnabled?13:16)+(this.windEnabled?'':' UTC');nodes.push(label);
        }
        this.svg.replaceChildren(...nodes);
        if(changed&&this.windEnabled)this.plot.scrollLeft=Math.max(0,x(selected)-this.plot.clientWidth/2);
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
        const description=utc(entry.time)+' · '+(entry.result?.value!=null?this.format(entry.result.value,entry.result.units):labels[entry.state]);
        const wind=this.windEntries.get(entry.time);
        const windText=!this.windEnabled?'':wind?.state==='value'&&wind.speed!==undefined?' · '+windDescription({speed:wind.speed,direction:wind.direction??null}):' · Ветер: '+(wind?labels[wind.state]||'Нет данных':'Нет данных');
        this.tooltip.textContent=description+windText+(this.preview===this.selected?' · выбран':'');
        this.range.setAttribute('aria-valuetext',description+windText);
    }
}
