export interface Selection {
    selection: string; model: string; run: string; revision: string; field: string;
    level: string; valid_time: string; units: string; state: string; fixture?: string;
    completeness?: string; native_display: string; collection: string; point: string;
    field_profile?: string; field_label?: string; interval?:{start:string;end:string;statistical_process:number}|null;
    field_short_name?:string;field_level_type?:string;
    field_surfaces?:{type:number;scale_factor:number;scaled_value:number;value:number|null}[];
    display_blocks?: number; wind_axis?: 'u'|'v'; wind_pair?: string; uv_relative_to_grid?: boolean; wind_v?:Selection;
    native_grid_sha256: string; member: string | null; wms: string;
}
export interface PublishedGroup {key: string; selection: Selection; times: (Selection|null)[]; start: number}
export const referenceTime=(run: string)=>run.slice(run.lastIndexOf('/')+1);

/** Catalogue ordering preserves publication order, including corrected revisions. */
export function publishedGroups(selections: Selection[],validationFixtures=false): PublishedGroup[] {
    const groups=new Map<string,PublishedGroup>();
    const syntheticRevisions=new Set(selections.filter(item=>item.fixture&&item.fixture!=='actual').map(item=>item.revision));
    for(const source of selections){
        const partner=source.wind_axis==='u'&&source.units==='m s**-1'&&/^[0-9a-f]{64}$/.test(source.wind_pair??'')?selections.find(other=>other.state==='published'&&other.wind_axis==='v'&&other.units===source.units&&other.wind_pair===source.wind_pair&&
            ['model','run','revision','level','valid_time','native_grid_sha256','member','uv_relative_to_grid'].every(key=>other[key as keyof Selection]===source[key as keyof Selection])):undefined;
        const item=partner?{...source,wind_v:partner,field_label:'Ветер — движущиеся стрелки (ряд точки: компонента U)'}:source;
        if(!validationFixtures&&syntheticRevisions.has(item.revision))continue;
        if(item.state!=='published'||!(item.field==='T_G:surface:0'&&item.units==='K'||item.field_profile==='grib2-fields/1'&&/^GRIB2:[0-9a-f]{64}$/.test(item.field))||
            item.fixture&&item.fixture!=='actual'&&!(validationFixtures&&['overlap','correction'].includes(item.fixture)))continue;
        const key=JSON.stringify([item.model,item.run,item.revision,item.field,item.level,item.native_grid_sha256,item.member]);
        if(!groups.has(key))groups.set(key,{key,selection:item,times:[],start:0});
        // A revision can inherit real batches while other times are corrected.
        // Label the entire validation revision, regardless of catalogue ordering.
        if(item.fixture==='correction')groups.get(key)!.selection=item;
        groups.get(key)!.times.push(item);
    }
    return [...groups.values()].reverse().sort((a,b)=>
        referenceTime(b.selection.run).localeCompare(referenceTime(a.selection.run))).map(group=>{
        const times=group.times.filter((x):x is Selection=>x!==null).sort((a,b)=>a.valid_time.localeCompare(b.valid_time));
        group.start=Date.parse(times[0].valid_time);
        const end=Date.parse(times[times.length-1].valid_time);
        if(!Number.isFinite(group.start)||!Number.isFinite(end)||end-group.start>31*86400000)
            throw Error('Некорректный диапазон сроков прогноза.');
        const byTime=new Map(times.map(item=>[Date.parse(item.valid_time),item]));
        group.times=Array.from({length:Math.floor((end-group.start)/3600000)+1},(_,i)=>byTime.get(group.start+i*3600000)??null);
        return group;
    });
}
