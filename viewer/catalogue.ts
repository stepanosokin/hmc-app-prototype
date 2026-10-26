import type {Selection,PublishedGroup} from './selection.js';
import {referenceTime} from './selection.ts';

type Template=Omit<Selection,'selection'|'revision'|'valid_time'|'native_display'|'collection'|'point'|'wms'|'state'> & {native_version:number};
interface Batch {template:number;key:string;valid_time:string;interval?:Selection['interval'];selection?:string}
interface Revision {revision:string;completeness:string;batches:number[]}
export interface CompactCatalogue {version:'compact/1';templates:Template[];batches:Batch[];revisions:Revision[]}

/** Shared discovery metadata, with at most four materialized forecast groups.
 * Eviction only releases cache ownership: an active series keeps its own array.
 */
export function compactGroups(body:CompactCatalogue,validationFixtures=false):PublishedGroup[]{
    if(body.version!=='compact/1'||body.batches.length>8192||body.revisions.length>1024)throw Error('Некорректный каталог прогнозов.');
    const cache=new Map<string,(Selection|null)[]>(),groups:PublishedGroup[]=[];
    const template=(index:number)=>{const value=body.templates[index];if(!value)throw Error('Некорректный показатель каталога.');return value;};
    const batch=(index:number)=>{const value=body.batches[index];if(!value)throw Error('Некорректная выборка каталога.');return value;};
    const windKey=(t:Template,time:string)=>JSON.stringify([t.model,t.run,t.wind_pair,t.level,t.native_grid_sha256,t.member,t.uv_relative_to_grid,time]);
    for(const root of body.revisions){
        const sourceGroups=new Map<string,number[]>(),partners=new Map<string,number>();
        const synthetic=root.batches.some(index=>{const fixture=template(batch(index).template).fixture;return fixture&&fixture!=='actual';});
        if(synthetic&&!validationFixtures)continue;
        for(const index of root.batches){
            const b=batch(index),t=template(b.template);
            if(t.fixture&&t.fixture!=='actual'&&!(validationFixtures&&['overlap','correction'].includes(t.fixture)))continue;
            if(!(t.field==='T_G:surface:0'&&t.units==='K'||t.field_profile==='grib2-fields/1'&&/^GRIB2:[0-9a-f]{64}$/.test(t.field)))continue;
            const groupKey=JSON.stringify([t.model,t.run,t.field,t.level,t.native_grid_sha256,t.member]);
            if(!sourceGroups.has(groupKey))sourceGroups.set(groupKey,[]);
            sourceGroups.get(groupKey)!.push(index);
            if(t.wind_axis==='v'&&t.units==='m s**-1')partners.set(windKey(t,b.valid_time),index);
        }
        const materialize=(index:number,paired=true):Selection=>{
            const b=batch(index),t=template(b.template),selection=b.selection??root.revision+'.'+b.key;
            const {native_version,...identity}=t;
            const wms='/gis/v1/runs/'+encodeURIComponent(t.run)+'/revisions/'+root.revision+
                (t.field_profile?'/fields/'+t.field.replace(/^GRIB2:/,''):'')+'/wms';
            const result:Selection={...identity,selection,revision:root.revision,valid_time:b.valid_time,interval:b.interval??null,
                state:'published',completeness:root.completeness,collection:'/ogc/collections/'+selection,point:'/api/v1/point',wms,
                native_display:'/api/v1/selections/'+selection+'/display/'+native_version+'/native.json'};
            if(paired&&t.wind_axis==='u'&&t.units==='m s**-1'&&/^[0-9a-f]{64}$/.test(t.wind_pair??'')){
                const partner=partners.get(windKey(t,b.valid_time));
                if(partner!==undefined)result.wind_v=materialize(partner,false);
            }
            return result;
        };
        for(const indices of sourceGroups.values()){
            indices.sort((a,b)=>batch(a).valid_time.localeCompare(batch(b).valid_time));
            const corrected=indices.find(index=>template(batch(index).template).fixture==='correction');
            const selection=materialize(corrected??indices[0]),start=Date.parse(batch(indices[0]).valid_time),end=Date.parse(batch(indices.at(-1)!).valid_time);
            if(!Number.isFinite(start)||!Number.isFinite(end)||end-start>31*86400000)throw Error('Некорректный диапазон сроков прогноза.');
            const key=JSON.stringify([selection.model,selection.run,selection.revision,selection.field,selection.level,selection.native_grid_sha256,selection.member]);
            groups.push({key,selection,start,get times(){
                let times=cache.get(key);
                if(!times){
                    times=Array.from({length:Math.floor((end-start)/3600000)+1},()=>null as Selection|null);
                    for(const index of indices){const offset=(Date.parse(batch(index).valid_time)-start)/3600000;
                        if(Number.isInteger(offset))times[offset]=materialize(index);}
                    cache.set(key,times);
                }
                cache.delete(key);cache.set(key,times);
                while(cache.size>4)cache.delete(cache.keys().next().value!);
                return times;
            }});
        }
    }
    if(groups.length>4096)throw Error('Каталог превышает лимит 4096 групп прогнозов.');
    return groups.reverse().sort((a,b)=>referenceTime(b.selection.run).localeCompare(referenceTime(a.selection.run)));
}
