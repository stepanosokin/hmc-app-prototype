import type {Selection,PublishedGroup} from './selection.js';

const kinds:Record<string,[string,string,string,string]>={
    T_G:['temperature','Температура','Температура','Основные показатели'],
    t:['temperature','Температура','Температура','Основные показатели'],
    '2t':['temperature','Температура','Температура','Основные показатели'],
    min_2t:['temperature','Температура','Минимальная температура','За интервал'],
    max_2t:['temperature','Температура','Максимальная температура','За интервал'],
    sot:['temperature','Температура','Температура почвы','Почва'],
    '2d':['temperature','Температура','Точка росы','Точка росы'],
    prmsl:['pressure','Давление','Давление на уровне моря','Уровень моря'],
    sp:['pressure','Давление','Давление у поверхности','Поверхность'],
    q:['humidity','Влажность','Удельная влажность','Удельная влажность'],
    '2sh':['humidity','Влажность','Удельная влажность','Удельная влажность'],
    '2r':['humidity','Влажность','Относительная влажность','Относительная влажность'],
    '10u':['wind','Ветер','Ветер','Скорость и направление'],
    '10v':['wind','Ветер','Компонента V ветра','Компоненты'],
    max_i10fg:['wind','Ветер','Максимальные порывы ветра','Порывы'],
    tp:['precipitation','Осадки','Суммарные осадки','Количество осадков'],
    cp:['precipitation','Осадки','Конвективные осадки','Количество осадков'],
    lsp:['precipitation','Осадки','Крупномасштабные осадки','Количество осадков'],
    lsrr:['precipitation','Осадки','Интенсивность крупномасштабного дождя','Интенсивность'],
    crr:['precipitation','Осадки','Интенсивность конвективного дождя','Интенсивность'],
    lsfwe:['precipitation','Осадки','Водный эквивалент крупномасштабного снегопада','Снегопад'],
    csfwe:['precipitation','Осадки','Водный эквивалент конвективного снегопада','Снегопад'],
    tgrp:['precipitation','Осадки','Снежная крупа','Снегопад'],
    sde:['snow','Снег','Высота снежного покрова','Снежный покров'],
    sd:['snow','Снег','Водный эквивалент снежного покрова','Снежный покров'],
    ccl:['cloud','Облачность','Облачность','Слои облачности'],
    vis:['other','Другое','Видимость','Видимость']
};
const order=['temperature','pressure','humidity','wind','precipitation','cloud','snow','other'];
export function fieldUnits(units:string){return ({'m s**-1':'м/с',Pa:'Па','kg kg**-1':'кг/кг','kg m**-2':'кг/м²',
    'kg m**-2 s**-1':'кг/(м²·с)',m:'м',unknown:'единицы не определены'} as Record<string,string>)[units]??units;}
export function fieldNumber(value:number,units:string){
    if(units==='K')return value.toFixed(2);
    const magnitude=Math.abs(value);
    return new Intl.NumberFormat('ru-RU',{maximumSignificantDigits:6,useGrouping:false,
        notation:magnitude>0&&(magnitude<.0001||magnitude>=1e8)?'scientific':'standard'}).format(value);
}

export function fieldPresentation(source:Selection){
    if(source.field==='T_G:surface:0')return {id:'temperature',group:'Температура',section:'Основные показатели',label:'Температура поверхности'};
    const kind=kinds[source.field_short_name??''];
    if(!kind)return {id:'other',group:'Другое',section:'Прочие показатели',label:source.field_label??'Неизвестный показатель GRIB'};
    const [id,group,base,section]=kind;
    const surfaces=source.field_surfaces;
    if(surfaces?.length===2&&surfaces[1].type!==255){
        const label=(s:typeof surfaces[number])=>s.type===1?'поверхность':s.type===100&&s.value!==null?
            fieldNumber(s.value/100,'hPa')+' гПа':
            'тип GRIB '+s.type+' (масштаб '+s.scale_factor+', значение '+(s.scaled_value===4294967295?'не задано':s.scaled_value)+')';
        const bounds=surfaces.every(s=>s.type===100&&s.value!==null)?
            fieldNumber(surfaces[0].value!/100,'hPa')+'–'+fieldNumber(surfaces[1].value!/100,'hPa')+' гПа':
            label(surfaces[0])+' — '+label(surfaces[1]);
        return {id,group,section,label:base+' · слой '+bounds};
    }
    const type=source.field_level_type;
    const level=type==='heightAboveGround'?'на высоте '+source.level+' м':
        type==='surface'?'поверхность':type==='meanSea'?'уровень моря':
        type==='isobaricLayer'?'изобарический слой · уровень '+source.level:'уровень '+source.level+' · тип не определён';
    let label=base+' · '+level;
    if(source.field_short_name==='prmsl'||source.field_short_name==='sp')label=base;
    else if(base==='Температура'&&type==='surface')label='Температура поверхности';
    else if(type==='heightAboveGround')label=base+' '+level;
    return {id,group,section,label};
}

export function modelFields(groups:PublishedGroup[],current:PublishedGroup){
    const fields=new Map<string,PublishedGroup>();
    for(const candidate of groups){
        const s=candidate.selection;
        if(s.model!==current.selection.model)continue;
        if(s.wind_axis==='v'&&groups.some(g=>g.selection.model===s.model&&g.selection.wind_v?.field===s.field))continue;
        const previous=fields.get(s.field);
        const priority=(g:PublishedGroup)=>g.selection.run===current.selection.run?(g.selection.revision===current.selection.revision?2:1):0;
        if(!previous||priority(candidate)>priority(previous))fields.set(s.field,candidate);
    }
    return [...fields.values()].map(target=>({target,...fieldPresentation(target.selection)})).sort((a,b)=>
        order.indexOf(a.id)-order.indexOf(b.id)||a.section.localeCompare(b.section,'ru')||a.label.localeCompare(b.label,'ru'));
}

/** Owns only field controls. Publication and time selection stay with the viewer. */
export class FieldPicker {
    private root=document.getElementById('fieldGroups')!;
    private buttons=document.getElementById('fieldButtons')!;
    private menu=document.getElementById('fieldMenu')!;
    private open='';
    private fields:ReturnType<typeof modelFields>=[];
    private current:PublishedGroup|undefined;
    private groups:PublishedGroup[]|undefined;
    private choose:(target:PublishedGroup)=>void;
    constructor(choose:(target:PublishedGroup)=>void){
        this.choose=choose;
        document.addEventListener('pointerdown',event=>{if(!this.root.contains(event.target as Node))this.close();});
        document.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.open){event.stopImmediatePropagation();this.close(true);}},true);
        addEventListener('resize',()=>this.layout());this.buttons.addEventListener('scroll',()=>this.layout());
    }
    update(groups:PublishedGroup[],current:PublishedGroup|undefined){
        if(this.groups===groups&&this.current===current)return;
        this.groups=groups;this.current=current;this.close();
        if(!current){this.buttons.replaceChildren();return;}
        this.fields=modelFields(groups,current);
        const seen=new Set<string>(),buttons:HTMLButtonElement[]=[];
        for(const field of this.fields){
            if(seen.has(field.id))continue;seen.add(field.id);
            const button=document.createElement('button');button.id='field-group-'+field.id;
            button.textContent=field.group;button.setAttribute('aria-controls','fieldMenu');button.setAttribute('aria-expanded','false');
            button.setAttribute('aria-pressed',String(field.id===fieldPresentation(current.selection).id));
            button.onclick=()=>this.open===field.id?this.close():this.show(field.id);
            buttons.push(button);
        }
        this.buttons.replaceChildren(...buttons);this.layout();
    }
    close(focus=false){
        const button=document.getElementById('field-group-'+this.open);
        button?.setAttribute('aria-expanded','false');this.open='';this.menu.hidden=true;
        if(focus)button?.focus();
    }
    private show(id:string){
        this.close();this.open=id;
        document.getElementById('field-group-'+id)!.setAttribute('aria-expanded','true');
        const title=document.createElement('h2');title.textContent=this.fields.find(f=>f.id===id)!.group;
        const close=document.createElement('button');close.textContent='Закрыть';close.className='fieldMenuClose';close.onclick=()=>this.close(true);
        const content:HTMLElement[]=[title,close];let previous='';
        for(const field of this.fields.filter(f=>f.id===id)){
            if(field.section!==previous){const heading=document.createElement('h3');heading.textContent=field.section;content.push(heading);previous=field.section;}
            const button=document.createElement('button');button.className='fieldOption';button.dataset.field=field.target.selection.field;
            button.setAttribute('aria-pressed',String(field.target.key===this.current?.key));
            const label=document.createElement('span');label.textContent=field.label;
            const units=document.createElement('small');units.textContent=fieldUnits(field.target.selection.units);button.append(label,units);
            button.onclick=()=>{this.close(true);this.choose(field.target);};content.push(button);
        }
        this.menu.replaceChildren(...content);this.menu.hidden=false;this.layout();
    }
    layout(){
        const rail=this.buttons.getBoundingClientRect(),timeline=document.getElementById('timelinePanel')!.getBoundingClientRect();
        const legend=document.getElementById('legendPanel')!.getBoundingClientRect();
        const bottom=Math.min(timeline.top-10,legend.right>rail.left&&legend.top>rail.top?legend.top-10:timeline.top-10);
        this.buttons.style.maxHeight=Math.max(40,bottom-rail.top)+'px';
        if(!this.open)return;
        const button=document.getElementById('field-group-'+this.open)!.getBoundingClientRect();
        this.menu.style.right=(innerWidth-rail.left+8)+'px';this.menu.style.maxHeight=Math.max(80,timeline.top-24)+'px';
        this.menu.style.top=Math.max(10,Math.min(button.top,timeline.top-this.menu.offsetHeight-12))+'px';
    }
}
