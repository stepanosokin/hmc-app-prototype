import type {Selection,PublishedGroup} from './selection.js';
import {json,PublicationExpired} from './field.ts';
import type {NativeMetadata} from './field.js';
import {nativePosition} from './source-crs.js';
import {earthComponents} from './wind.ts';
import {windValue} from './wind-values.ts';
export interface Position {lng:number;lat:number}
export interface PointResult {
    selection:string;run:string;revision:string;valid_time:string;field:string;
    units:string;value:number|null;reason:string|null;spatial_selection:string;source:unknown;
    cell:{row:number;column:number;lon:number;lat:number}|null;
    identity:Record<string,unknown>;temporal_selection:string;
}
// Includes bounded scalar/provenance storage and parsing scratch for one response.
export const SERIES_BUDGET=16*1024**2;
export async function pointValue(current:Selection,position:Position,signal:AbortSignal):Promise<PointResult>{
    const query=new URLSearchParams({selection:current.selection,run:current.run,revision:current.revision,
        valid_time:current.valid_time,layer:current.field,lon:String(position.lng),lat:String(position.lat),
        crs:'http://www.opengis.net/def/crs/OGC/1.3/CRS84'});
    const result=await json<PointResult>('/api/v1/point?'+query,signal);signal.throwIfAborted();
    if(!isPointResult(result,current))throw Error('Несогласованное значение точки.');
    return result;
}
function isPointResult(result:PointResult,current:Selection){
    return !(JSON.stringify(result).length>8192||!matches(result,current)||
        ['run','revision','valid_time','field'].some(key=>result[key as keyof PointResult]!==current[key as keyof Selection])||
        result.spatial_selection!=='nearest-native-cell'||result.temporal_selection!=='exact');
}
type Component=Pick<PointResult,'selection'|'units'|'value'|'reason'|'cell'|'identity'>;
function matches(result:Component,current:Selection){
    return result.identity&&
        ['model','run','revision','field','level','native_grid_sha256','member','valid_time'].every(key=>result.identity[key]===current[key as keyof Selection])&&
        result.selection===current.selection&&result.units===current.units&&
        (result.value===null&&['outside_coverage','native_nodata'].includes(result.reason??'')||
         typeof result.value==='number'&&Number.isFinite(result.value)&&result.reason===null);
}
export type EntryState='loading'|'missing'|'value'|'outside_coverage'|'native_nodata'|'error';
export interface SeriesEntry {time:string;selection:Selection|null;state:EntryState;result?:PointResult}
interface Sample<T> {status:'sampled'|'error';result?:T}
interface WindSample {
    time:string;status:'sampled'|'missing'|'error';u?:Sample<Component>;v?:Sample<Component>;
}
export interface WindEntry {time:string;state:EntryState;speed?:number;direction?:number|null}
interface Forecast {
    scalar:(Sample<PointResult>&{time:string})[];
    wind?:WindSample[];
    source_crs?:NativeMetadata['source_crs'];
    next?:string;
}
export async function forecastPoints(scalar:Selection,wind:Selection|undefined,position:Position,signal:AbortSignal,from?:string):Promise<Forecast>{
    const query=new URLSearchParams({selection:scalar.selection,lon:String(position.lng),lat:String(position.lat)});
    if(wind?.wind_v){query.set('wind_u',wind.selection);query.set('wind_v',wind.wind_v.selection);}
    if(from)query.set('from',from.replace('.000Z','Z'));
    return json<Forecast>('/api/v1/point-series?'+query,signal,4*1024**2,1);
}

const sampleState=(result:Component):EntryState=>result.value!==null?'value':
    result.reason==='outside_coverage'?'outside_coverage':'native_nodata';
const timeKey=(time:string)=>Date.parse(time);
const entryTime=(group:PublishedGroup,i:number)=>new Date(group.start+i*3600000).toISOString();

/** The scalar and optional wind series share a request and one cancellation owner. */
export class PointSeries {
    entries:SeriesEntry[]=[];key='';expired=false;busy=false;requests=0;elapsedMs=0;
    windEntries:WindEntry[]=[];
    private controller=new AbortController();
    private position:Position|undefined;
    private scalar:Selection|undefined;
    private windGroup:PublishedGroup|undefined;
    private windAnchor:Selection|undefined;
    private next: number|undefined;
    private work:Promise<void>=Promise.resolve();
    private read:typeof forecastPoints;
    private changed:()=>void;
    constructor(read=forecastPoints,changed=()=>{}){this.read=read;this.changed=changed;}
    clear(){
        this.cancel();this.entries=[];this.key='';this.position=undefined;this.scalar=undefined;
        this.windGroup=undefined;this.windAnchor=undefined;this.windEntries=[];this.next=undefined;
        this.expired=false;this.requests=0;this.elapsedMs=0;
    }
    private cancel(){this.controller.abort();this.controller=new AbortController();this.busy=false;}
    load(group:PublishedGroup,position:Position,wind?:PublishedGroup,initial?:PointResult):Promise<void>{
        const key=JSON.stringify([position.lng,position.lat,...group.times.map(s=>s&&[
            s.selection,s.model,s.run,s.revision,s.field,s.level,s.native_grid_sha256,s.member,s.valid_time])]);
        const windAnchor=wind?.times.find(s=>s?.wind_v)??undefined;
        const sameScalar=key===this.key;
        if(sameScalar&&(this.expired||this.windAnchor?.selection===windAnchor?.selection))return this.work;
        if(group.times.length>745||(wind?.times.length??0)>745)throw Error('Слишком длинный прогнозный ряд.');
        if(!sameScalar){
            this.clear();this.key=key;this.position={...position};this.scalar=group.selection;
            this.entries=group.times.map((selection,i)=>({selection,time:entryTime(group,i),state:selection?'loading':'missing'}));
            const seeded=initial&&this.entries.find(entry=>entry.selection?.selection===initial.selection);
            if(seeded){seeded.result=initial;seeded.state=sampleState(initial);}
        }else{this.cancel();this.next=undefined;}
        this.windAnchor=windAnchor;this.windGroup=windAnchor?wind:undefined;
        this.windEntries=this.windGroup?.times.map((s,i)=>({time:entryTime(this.windGroup!,i),state:s?.wind_v?'loading':'missing'}))??[];
        this.work=this.fetchEntries();return this.work;
    }
    retry():Promise<void>{
        if(this.busy||this.expired)return this.work;
        const failed=[...this.entries,...this.windEntries].filter(entry=>entry.state==='error');
        if(!failed.length)return this.work;
        for(const entry of failed)entry.state='loading';
        this.windEntries=[...this.windEntries];
        const cutoff=this.next,deferred=cutoff===undefined?[]:failed.filter(entry=>timeKey(entry.time)>=cutoff);
        const candidates=deferred.length?deferred:failed;
        const first=candidates.reduce((earliest,entry)=>entry.time<earliest?entry.time:earliest,candidates[0].time);
        this.work=this.fetchEntries(first);return this.work;
    }
    expire(){this.cancel();this.expired=true;
        for(const entry of this.entries){entry.result=undefined;if(entry.selection)entry.state='error';}
        this.windEntries=this.windEntries.map(({time,state})=>({time,state:state==='missing'?'missing':'error'}));
        this.changed();}
    private async fetchEntries(from?:string){
        const owner=this.controller,signal=owner.signal,position=this.position!,start=performance.now();
        const pending=this.entries.filter(entry=>entry.state==='loading');
        if(!pending.length&&!this.windEntries.some(entry=>entry.state==='loading')){this.changed();return;}
        this.busy=true;this.changed();
        try{
            signal.throwIfAborted();
            this.requests++;
            const reply=await this.read(this.scalar!,this.windAnchor,position,signal,from);
            signal.throwIfAborted();
            const next=reply.next?timeKey(reply.next):NaN;
            this.next=Number.isFinite(next)?next:undefined;
            const byTime=new Map(reply.scalar.map(row=>[timeKey(row.time),row]));
            for(const entry of pending){
                const sample=byTime.get(timeKey(entry.time));
                if(entry.selection&&sample?.status==='sampled'&&sample.result&&isPointResult(sample.result,entry.selection)){
                    entry.result=sample.result;entry.state=sampleState(sample.result);
                }else entry.state='error';
            }
            const wind=new Map(reply.wind?.map(row=>[timeKey(row.time),row]));
            this.windEntries=this.windEntries.map((entry,i)=>entry.state==='loading'?
                windPoint(entry.time,this.windGroup?.times[i],wind.get(timeKey(entry.time)),reply.source_crs):entry);
        }catch(error){
            if(signal.aborted)return;
            if(error instanceof PublicationExpired){this.expire();return;}
            for(const entry of pending)if(entry.state==='loading')entry.state='error';
            this.windEntries=this.windEntries.map(entry=>entry.state==='loading'?{...entry,state:'error'}:entry);
        }
        finally{if(owner===this.controller){this.busy=false;this.elapsedMs+=performance.now()-start;this.changed();}}
    }
}

function windPoint(time:string,selection:Selection|null|undefined,sample:WindSample|undefined,
                   source_crs:NativeMetadata['source_crs']):WindEntry{
    const u=sample?.u?.result,v=sample?.v?.result;
    if(sample?.status==='missing')return {time,state:'missing'};
    if(sample?.status!=='sampled'||!selection?.wind_v||!u||!v||!matches(u,selection)||!matches(v,selection.wind_v))
        return {time,state:'error'};
    if(u.value===null||v.value===null)return {time,state:
        u.reason==='outside_coverage'||v.reason==='outside_coverage'?'outside_coverage':'native_nodata'};
    const gridRelative=selection.uv_relative_to_grid;
    if(!u.cell||!v.cell||u.cell.row!==v.cell.row||u.cell.column!==v.cell.column||
        u.cell.lon!==v.cell.lon||u.cell.lat!==v.cell.lat||typeof gridRelative!=='boolean'||gridRelative&&!source_crs)
        return {time,state:'error'};
    try{
        const xy=[u.cell.lon,u.cell.lat];
        const inverse=(p:number[])=>nativePosition(source_crs,p,true);
        const earth=earthComponents(u.value,v.value,{source_crs,uv_relative_to_grid:gridRelative},xy,
            gridRelative?inverse(xy):xy,inverse);
        return earth?{time,state:'value',...windValue(earth.east,earth.north)}:{time,state:'error'};
    }catch{return {time,state:'error'};}
}
