import type {Selection,PublishedGroup} from './selection.js';
import {json,PublicationExpired} from './field.ts';
export interface Position {lng:number;lat:number}
export interface PointResult {
    selection:string;run:string;revision:string;valid_time:string;field:string;
    units:string;value:number|null;reason:string|null;spatial_selection:string;source:unknown;
    cell:{row:number;column:number;lon:number;lat:number}|null;
}
export async function pointValue(current:Selection,position:Position,signal:AbortSignal):Promise<PointResult>{
    const query=new URLSearchParams({selection:current.selection,run:current.run,revision:current.revision,
        valid_time:current.valid_time,layer:current.field,lon:String(position.lng),lat:String(position.lat),
        crs:'http://www.opengis.net/def/crs/OGC/1.3/CRS84'});
    const result=await json<PointResult>('/api/v1/point?'+query,signal);signal.throwIfAborted();
    if(['selection','run','revision','valid_time','field'].some(key=>result[key as keyof PointResult]!==current[key as keyof Selection])||
        result.spatial_selection!=='nearest-native-cell'||result.units!=='K'||
        !(result.value===null&&['outside_coverage','native_nodata'].includes(result.reason??'')||
          typeof result.value==='number'&&Number.isFinite(result.value)&&result.reason===null))
        throw Error('Несогласованное значение точки.');
    return result;
}
export type EntryState='loading'|'missing'|'value'|'outside_coverage'|'native_nodata'|'error';
export interface SeriesEntry {time:string;selection:Selection|null;state:EntryState;result?:PointResult}
/** One pinned series, one request at a time. No cross-point or historical cache. */
export class PointSeries {
    entries:SeriesEntry[]=[];key='';expired=false;busy=false;requests=0;elapsedMs=0;
    private controller=new AbortController();
    private position:Position|undefined;
    private work:Promise<void>=Promise.resolve();
    private read:typeof pointValue;
    private changed:()=>void;
    constructor(read=pointValue,changed=()=>{}){this.read=read;this.changed=changed;}
    clear(){this.controller.abort();this.controller=new AbortController();this.entries=[];this.key='';this.position=undefined;
        this.busy=false;this.expired=false;this.requests=0;this.elapsedMs=0;}
    load(group:PublishedGroup,position:Position):Promise<void>{
        const key=JSON.stringify([position.lng,position.lat,...group.times.map(s=>s&&[
            s.selection,s.model,s.run,s.revision,s.field,s.level,s.native_grid_sha256,s.member,s.valid_time])]);
        if(key===this.key)return this.work;
        this.clear();this.key=key;this.position={...position};
        this.entries=group.times.map((selection,i)=>({selection,time:new Date(group.start+i*3600000).toISOString(),state:selection?'loading':'missing'}));
        // Catalogue spans are already bounded to 31 days; retain at most 745 scalar entries.
        if(this.entries.length>745)throw Error('Слишком длинный прогнозный ряд.');
        this.work=this.fetchEntries();return this.work;
    }
    retry():Promise<void>{
        if(this.busy||this.expired)return this.work;
        for(const entry of this.entries)if(entry.state==='error')entry.state='loading';
        this.work=this.fetchEntries();return this.work;
    }
    expire(){this.controller.abort();this.expired=true;this.busy=false;
        for(const entry of this.entries){entry.result=undefined;if(entry.selection)entry.state='error';}
        this.changed();}
    private async fetchEntries(){
        const owner=this.controller,signal=owner.signal,position=this.position!,start=performance.now();
        this.busy=true;this.changed();
        try{for(const entry of this.entries){
            signal.throwIfAborted();if(entry.state!=='loading'||!entry.selection)continue;
            try{
                this.requests++;
                const result=await this.read(entry.selection,position,signal);
                signal.throwIfAborted();entry.result=result;
                entry.state=result.value===null?result.reason as 'outside_coverage'|'native_nodata':'value';
            }catch(error){
                if(signal.aborted)return;
                if(error instanceof PublicationExpired){this.expire();return;}
                entry.state='error';
            }
            this.changed();
        }}catch(error){if(!signal.aborted)throw error;}
        finally{if(owner===this.controller){this.busy=false;this.elapsedMs+=performance.now()-start;this.changed();}}
    }
}
