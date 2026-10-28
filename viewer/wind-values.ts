import type {PublishedGroup,Selection} from './selection.js';

export const windVariant=(s:Selection)=>JSON.stringify([s.field_level_type,String(s.level),s.field_surfaces?.map(surface=>
    [surface.type,surface.value??[surface.scale_factor,surface.scaled_value]])??null]);
export function windLevel(s:Selection){
    const surface=s.field_surfaces?.[0];
    if(s.field_level_type==='heightAboveGround')return s.level+' м';
    if(surface?.type===100&&surface.value!==null)return new Intl.NumberFormat('ru-RU').format(surface.value/100)+' гПа';
    return s.field_level_type==='surface'?'Поверхность':'Уровень '+s.level;
}
export function windGroups(groups:PublishedGroup[],source:Selection){
    return groups.filter(g=>g.selection.wind_axis==='u'&&g.selection.units==='m s**-1'&&
        ['model','run','revision','member'].every(k=>g.selection[k as keyof Selection]===source[k as keyof Selection])&&g.times.some(s=>s?.wind_v));
}
export function windAtTime(group:PublishedGroup|undefined,time:number){
    if(!group)return;
    const offset=(time-group.start)/3600000;
    if(!Number.isInteger(offset))return;
    const u=group.times[offset];return u?.wind_v?u:undefined;
}
export function windValue(east:number,north:number){
    const speed=Math.hypot(east,north);
    return {speed,direction:speed<.05?null:(Math.atan2(-east,-north)*180/Math.PI+360)%360};
}
export function windDescription(value:{speed:number;direction:number|null}){
    const n=(v:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(v);
    if(value.direction===null)return 'Штиль · '+n(value.speed)+' м/с';
    const names=['С','СВ','В','ЮВ','Ю','ЮЗ','З','СЗ'];
    return names[Math.round(value.direction/45)%8]+', '+n(value.direction)+'° · '+n(value.speed)+' м/с';
}
/** Standard 5/10/50-knot feathers; the shaft points FROM, never along airflow. */
export function windBarb(speed:number){
    let knots=Math.round(speed*1.9438444924406/5)*5,offset=0,feathers='',pennants='';
    // The published physical range bounds size, but pathological inputs cannot
    // allocate arbitrarily many SVG segments.
    if(!Number.isFinite(speed)||speed<0||speed>200)return {shaft:'',feathers:'',pennants:'',calm:false,transform:'',radius:0};
    const calm=knots===0;
    while(knots>=50){pennants+=`M0 ${-13+offset}L8 ${-10+offset}L0 ${-7+offset}Z`;offset+=7;knots-=50;}
    while(knots>=10){feathers+=`M0 ${-13+offset}l7 3`;offset+=4;knots-=10;}
    if(knots>=5){feathers+=`M0 ${-13+offset+(offset?0:3)}l3.5 1.5`;offset+=4;}
    // Extend the shaft beyond every mark, then fit the complete symbol in a
    // 11px circle, including room for the stroke at the first/last time slot.
    // Rotation cannot clip it or cross into an adjacent time slot.
    const bottom=Math.max(11,-13+offset+2),centre=(bottom-13)/2;
    const radius=Math.hypot(8,(bottom+13)/2),scale=Math.min(1,11/radius);
    return {shaft:`M0 ${bottom}V-13`,feathers,pennants,calm,
        transform:`scale(${scale}) translate(0 ${-centre})`,radius:radius*scale};
}
