import type {PointSeries,SeriesEntry} from './series.js';
import type {WindEntry} from './series.js';
import {windBarb,windDescription} from './wind-values.js';
const labels={loading:'Загрузка',missing:'Нет данных',outside_coverage:'Вне покрытия',native_nodata:'Нет данных в нативной ячейке',error:'Ошибка запроса',value:''};
export interface PointChartRow {
    kind:'background'|'isolines'; label:string; series:PointSeries; format:(value:number,units:string)=>string;
}
export function pointReadingText(entry:SeriesEntry|undefined,format:PointChartRow['format'],pending=false){
    const result=entry?.result;
    return result?.value!=null?format(result.value,result.units):labels[entry?.state??(pending?'loading':'missing')];
}
const utc=(time:string)=>new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',dateStyle:'short',timeStyle:'short'}).format(new Date(time))+' UTC';
const svgElement=(tag:string,attributes:Record<string,string|number>)=>{
    const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [name,value] of Object.entries(attributes))node.setAttribute(name,String(value));return node;
};
type CachedBarb={speed:number;direction:number|null;calm:boolean;node:Element};
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
    private rows:(PointChartRow&{byTime:Map<string,SeriesEntry>})[]=[];
    private times:string[]=[];
    private timestamps:number[]=[];
    private selected=0;
    private preview=0;
    private key='';
    private plot=document.createElement('div');
    private windLabel=document.createElement('small');
    private windEntries=new Map<string,WindEntry>();
    private windEnabled=false;
    private windKey='';
    private width=264;
    private fullBuilds=0;
    private rebuildsWhileBusy=0;
    private buildMs=0;
    private barbs=new Map<string,CachedBarb>();
    private barbBuilds=0;
    private barbReuses=0;
    private rect:DOMRect|undefined;
    private describeFrame=0;
    private pointerEvents=0;
    private rectReads=0;
    private pointerDescribes=0;
    private invalidateRect=()=>{this.rect=undefined;};
    private resizeObserver=new ResizeObserver(this.invalidateRect);
    constructor(chooseTime:(time:number)=>void){
        const choose=()=>{
            const time=this.times[this.preview];
            if(time&&!this.expired&&this.canSelect(time))chooseTime(Date.parse(time));
        };
        this.element.className='pointChart realPointChart';this.caption.textContent='Прогноз выбранной точки';
        this.range.type='range';this.range.min='0';this.range.step='1';this.range.setAttribute('aria-label','Просмотреть срок графика');
        this.range.oninput=()=>{this.preview=Number(this.range.value);this.describe();};
        this.range.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose();}};
        this.select.textContent='Выбрать этот срок';this.select.onclick=choose;
        this.retry.textContent='Повторить ошибки ряда';this.retry.onclick=()=>{for(const row of this.rows)void row.series.retry();};
        const locate=(event:PointerEvent|MouseEvent)=>{
            // The box changes on resize, scroll or a new hover, not per pointermove;
            // reading it on every move would force layout.
            if(!this.rect){this.rect=this.svg.getBoundingClientRect();this.rectReads++;}
            const rect=this.rect,x=(event.clientX-rect.left)/rect.width*this.width;
            let first=0,last=this.times.length-1;
            while(first<last){
                const i=Math.floor((first+last)/2);
                if(x>(this.x(i)+this.x(i+1))/2)first=i+1;else last=i;
            }
            this.preview=first;
            this.range.value=String(this.preview);this.pointerEvents++;this.scheduleDescribe();
        };
        this.resizeObserver.observe(this.svg);
        this.svg.addEventListener('pointerenter',this.invalidateRect);
        window.addEventListener('scroll',this.invalidateRect,{capture:true,passive:true});
        this.svg.addEventListener('pointermove',locate);
        this.svg.addEventListener('click',event=>{locate(event);choose();});
        this.plot.className='pointPlot';this.plot.append(this.svg);
        this.element.append(this.caption,this.status,this.windLabel,this.plot,this.range,this.tooltip,this.select,this.retry);
    }
    setWind(entries:Map<string,WindEntry>,enabled:boolean,label:string,status:string,key=''){
        if(key!==this.windKey||!enabled&&this.windEnabled){
            this.windKey=key;
            this.svg.querySelectorAll('.windBarb,.windGap').forEach(node=>node.remove());
            this.barbs.clear();
        }
        this.windEntries=entries;this.windEnabled=enabled;
        this.windLabel.hidden=!enabled;this.windLabel.textContent='Ветер · '+label+' · флажки в узлах · «откуда»'+(status?'. '+status:'');
        this.windLabel.title='Короткое перо — 5 узлов, полное — 10, треугольник — 50. Точная скорость в подписи — м/с.';
    }
    private get expired(){return this.rows.some(row=>row.series.expired);}
    private canSelect(time:string){return this.rows.some(row=>row.byTime.get(time)?.selection);}
    private x(index:number){
        const start=this.timestamps[0],end=this.timestamps.at(-1)??start;
        return 12+(this.timestamps[index]-start)/Math.max(1,end-start)*(this.width-24);
    }
    clear(){
        this.rows=[];this.times=[];this.timestamps=[];this.key='';this.barbs.clear();this.svg.replaceChildren();
        this.tooltip.textContent='';this.element.remove();
    }
    update(rows:PointChartRow[],selectedTime:number){
        const instant=new Date(selectedTime).toISOString(),previous=this.times[this.preview];
        const key=JSON.stringify(rows.map(row=>[row.kind,row.series.key]));
        const changed=this.key!==key||this.times[this.selected]!==instant;
        if(this.key!==key){this.key=key;this.fullBuilds=0;this.rebuildsWhileBusy=0;this.buildMs=0;this.barbBuilds=0;this.barbReuses=0;this.barbs.clear();this.svg.replaceChildren();}
        this.rows=rows.map(row=>({...row,byTime:new Map(row.series.entries.map(entry=>[entry.time,entry]))}));
        this.times=[...new Set([instant,...this.rows.flatMap(row=>[...row.byTime.keys()])])].sort();
        this.timestamps=this.times.map(time=>Date.parse(time));
        this.selected=this.times.indexOf(instant);
        const preview=this.times.indexOf(previous);
        this.preview=changed||preview<0||!this.element.isConnected?this.selected:preview;
        // Keep a settled row visible during a retry or while the other row loads.
        if(rows.some(row=>row.series.busy)&&!rows.some(row=>!row.series.busy&&row.series.entries.length)){
            this.refreshMeta();return;
        }
        const start=performance.now();
        const times=this.times,selected=this.selected;
        const offset=this.windEnabled?50:0;
        this.svg.setAttribute('viewBox',`0 0 ${this.width} ${110+offset}`);
        const windScale=Math.min(1,(this.width-24)/Math.max(1,times.length-1)/24);
        const x=(i:number)=>this.x(i);
        const nodes:Element[]=[];
        const placeBarb=(node:Element,i:number,direction:number|null,calm:boolean)=>{
            if(calm){node.setAttribute('cx',String(x(i)));node.setAttribute('cy','27');node.setAttribute('r',String(3*windScale));}
            else node.setAttribute('transform',`translate(${x(i)} 27) rotate(${direction}) scale(${windScale})`);
        };
        if(this.windEnabled)for(const [i,time] of times.entries()){
            const wind=this.windEntries.get(time);
            if(wind?.state==='value'&&wind.speed!==undefined){
                const direction=wind.direction??null,cached=this.barbs.get(time);
                if(cached&&cached.speed===wind.speed&&cached.direction===direction){
                    // Positions depend on the slot count and width, but the symbol itself
                    // depends only on speed/direction. Reuse the built node and refresh
                    // only its placement.
                    placeBarb(cached.node,i,direction,cached.calm);nodes.push(cached.node);this.barbReuses++;continue;
                }
                const barb=windBarb(wind.speed),calm=direction===null||barb.calm,node=calm?svgElement('circle',{fill:'none',stroke:'currentColor'}):svgElement('g',{});
                node.classList.add('windBarb');
                placeBarb(node,i,direction,calm);
                if(!calm){
                    const symbol=svgElement('g',{transform:barb.transform});
                    symbol.append(svgElement('path',{d:barb.shaft+barb.feathers,fill:'none',stroke:'currentColor','stroke-width':1.1,'vector-effect':'non-scaling-stroke'}),svgElement('path',{d:barb.pennants,fill:'currentColor'}));node.append(symbol);
                    const title=svgElement('title',{});title.textContent=time+' · '+windDescription({speed:wind.speed,direction});node.append(title);
                }
                this.barbs.set(time,{speed:wind.speed,direction,calm,node});this.barbBuilds++;nodes.push(node);
            }else{const label=svgElement('text',{x:x(i),y:30,'text-anchor':'middle',class:'windGap'});label.textContent=wind?.state==='loading'?'…':wind?.state==='error'?'!':'—';nodes.push(label);}
        }
        const visibleTimes=new Set(times);
        for(const time of this.barbs.keys())if(!visibleTimes.has(time))this.barbs.delete(time);
        for(const row of this.rows){
            const plot=svgElement('g',{'data-point-layer':row.kind});
            const values=row.series.entries.flatMap(e=>e.result?.value!=null?[e.result.value]:[]);
            const low=Math.min(...values),span=Math.max(...values)-low;
            let previous='';
            for(const [i,time] of times.entries()){
                const value=row.byTime.get(time)?.result?.value;
                if(value==null){previous='';continue;}
                const cy=88+offset-(span?(value-low)/span:.5)*68;
                const next=`${x(i)},${cy}`;
                if(previous)plot.append(svgElement('path',{d:`M${previous} L${next}`,class:'forecastLine'}));
                plot.append(svgElement('circle',{cx:x(i),cy,r:i===selected?4:2,class:i===selected?'selectedValue':'seriesValue'}));
                previous=next;
            }
            nodes.push(plot);
        }
        nodes.push(svgElement('line',{x1:x(selected),x2:x(selected),y1:8,y2:94+offset,class:'nowLine'}));
        const tickCount=Math.min(this.windEnabled?6:2,times.length);
        for(let tick=0;tick<tickCount;tick++){
            const i=Math.round(tick/Math.max(1,tickCount-1)*(times.length-1)),last=tick===tickCount-1;
            const label=svgElement('text',{x:x(i),y:108+offset,'text-anchor':tick===0?'start':last?'end':'middle'});
            label.textContent=times[i].slice(11,16)+(last?' UTC':'');nodes.push(label);
        }
        this.svg.replaceChildren(...nodes);
        if(rows.some(row=>row.series.busy))this.rebuildsWhileBusy++;
        this.fullBuilds++;this.buildMs+=performance.now()-start;
        this.refreshMeta();
    }
    private refreshMeta(){
        const entries=this.rows.flatMap(row=>row.series.entries);
        const busy=this.rows.some(row=>row.series.busy);
        const successes=entries.filter(e=>e.result).length,errors=entries.filter(e=>e.state==='error').length;
        this.status.textContent=this.expired?'Публикация истекла. Перевыберите публикацию.':
            busy?`Загрузка ряда: ${successes} из ${entries.filter(e=>e.selection).length}`:
            errors?`${successes?'Частичный ряд':'Не удалось загрузить ряд'} · ошибок: ${errors}`:'Ближайшая нативная ячейка · весь опубликованный прогноз';
        this.retry.hidden=(!errors&&![...this.windEntries.values()].some(entry=>entry.state==='error'))||this.expired;this.retry.disabled=busy;
        this.range.max=String(Math.max(0,this.times.length-1));this.range.value=String(this.preview);
        this.range.disabled=this.expired||!entries.length;
        this.describe();
    }
    evidence(){return {key:this.key,full_builds:this.fullBuilds,rebuilds_while_busy:this.rebuildsWhileBusy,build_ms:this.buildMs,barb_builds:this.barbBuilds,barb_reuses:this.barbReuses,pointer_events:this.pointerEvents,pointer_rect_reads:this.rectReads,pointer_describes:this.pointerDescribes};}
    private scheduleDescribe(){
        if(this.describeFrame)return;
        this.describeFrame=requestAnimationFrame(()=>{this.describeFrame=0;this.pointerDescribes++;this.describe();});
    }
    private describe(){
        const time=this.times[this.preview];if(!time)return;
        const readings=this.rows.map(row=>(this.rows.length>1?row.label+' · ':'')+pointReadingText(row.byTime.get(time),row.format));
        const description=[utc(time),...readings].join(' · ');
        this.select.disabled=this.range.disabled||!this.canSelect(time);
        const wind=this.windEntries.get(time);
        const windText=!this.windEnabled?'':wind?.state==='value'&&wind.speed!==undefined?' · '+windDescription({speed:wind.speed,direction:wind.direction??null}):' · Ветер: '+(wind?labels[wind.state]||'Нет данных':'Нет данных');
        this.tooltip.textContent=description+windText+(this.preview===this.selected?' · выбран':'');
        this.range.setAttribute('aria-valuetext',description+windText);
    }
}
