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
    max_i10fg:['wind','Порывы ветра','Максимальные порывы ветра','Порывы'],
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

export function legendNumber(value:number,source:Selection){
    if(source.units==='kg kg**-1'&&['q','2sh'].includes(source.field_short_name??''))
        return new Intl.NumberFormat('ru-RU',{maximumSignificantDigits:3,useGrouping:false}).format(value);
    return fieldNumber(value,source.units??'unknown');
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
        if(s.model!==current.selection.model||s.wind_axis==='u'||s.wind_axis==='v')continue;
        const previous=fields.get(s.field);
        const priority=(g:PublishedGroup)=>g.selection.run===current.selection.run?(g.selection.revision===current.selection.revision?2:1):0;
        if(!previous||priority(candidate)>priority(previous))fields.set(s.field,candidate);
    }
    return [...fields.values()].map(target=>({target,...fieldPresentation(target.selection)})).sort((a,b)=>
        order.indexOf(a.id)-order.indexOf(b.id)||a.section.localeCompare(b.section,'ru')||a.label.localeCompare(b.label,'ru'));
}

/** Short captions preserve the scientific distinctions hidden by pictograms. */
export function fieldTile(source:Selection){
    const presentation=fieldPresentation(source),short=source.field_short_name??'';
    const variants:Record<string,string>={min_2t:'мин',max_2t:'макс',sot:'почва','2d':'роса',
        prmsl:'море',sp:'пов.',q:'уд.', '2sh':'уд.','2r':'отн.','10v':'V',max_i10fg:'порывы',
        tp:'сумма',cp:'конв.',lsp:'крупн.',lsrr:'крупн. · инт.',crr:'конв. · инт.',
        lsfwe:'крупн. · снег',csfwe:'конв. · снег',tgrp:'крупа',sde:'высота',sd:'вод. экв.'};
    const bound=(s:NonNullable<Selection['field_surfaces']>[number])=>s.type===1?'пов.':
        s.type===100&&s.value!==null?fieldNumber(s.value/100,'hPa')+' гПа':
        s.type===106&&s.value!==null?fieldNumber(s.value,'m')+' м':
        'GRIB '+s.type+': '+(s.value===null?'?':s.value);
    const surfaces=source.field_surfaces;
    const level=surfaces?.length===2&&surfaces[1].type!==255?bound(surfaces[0])+' — '+bound(surfaces[1]):
        source.field==='T_G:surface:0'||source.field_level_type==='surface'?'пов.':
        source.field_level_type==='meanSea'?'море':source.field_level_type==='heightAboveGround'?source.level+' м':
        source.field_level_type==='isobaricInhPa'?source.level+' гПа':'ур. '+source.level;
    const hours=source.interval?(Date.parse(source.interval.end)-Date.parse(source.interval.start))/3600000:0;
    const interval=Number.isFinite(hours)&&hours>0?'за '+new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(hours)+' ч':'';
    const icon=presentation.id==='other'?(short==='vis'?'visibility':'other'):presentation.id;
    const variant=variants[short]??(presentation.id==='other'&&short!=='vis'?(source.field_label??'Другое').replace(/^Поле GRIB /,'GRIB '):'');
    return {icon,variant,level,interval,
        label:[presentation.label,interval,fieldUnits(source.units)].filter(Boolean).join(' · ')};
}

/** Match the nearest available time used when switching to another field. */
export function fieldAtTime(target:PublishedGroup,time:number){
    let nearest=target.selection,distance=Infinity;
    for(const source of target.times){
        if(!source)continue;
        const delta=Math.abs(Date.parse(source.valid_time)-time);
        if(delta<distance){nearest=source;distance=delta;}
    }
    return nearest;
}

function fieldIcon(name:string){
    if(name==='other'){
        const icon=document.createElement('span');icon.className='fieldIcon fieldGlyph';icon.textContent='⋯';icon.setAttribute('aria-hidden','true');return icon;
    }
    const icon=document.createElement('img');icon.className='fieldIcon';icon.src='/vendor/field-icons/'+name+'.png';
    icon.alt='';icon.width=28;icon.height=28;icon.draggable=false;return icon;
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
    private time=0;
    private choose:(target:PublishedGroup)=>void;
    private hint=document.createElement('div');
    constructor(choose:(target:PublishedGroup)=>void){
        this.choose=choose;
        this.hint.id='fieldHint';this.hint.className='panel fieldHint';this.hint.hidden=true;this.hint.setAttribute('role','tooltip');this.root.append(this.hint);
        document.addEventListener('pointerdown',event=>{if(!this.root.contains(event.target as Node))this.close();});
        document.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.open){event.stopImmediatePropagation();this.close(true);}},true);
        addEventListener('resize',()=>this.layout());this.buttons.addEventListener('scroll',()=>this.layout());
    }
    update(groups:PublishedGroup[],current:PublishedGroup|undefined,time=current?.start??0){
        const same=this.groups===groups&&this.current===current;
        if(this.time!==time)this.close();this.time=time;
        if(same)return;
        this.groups=groups;this.current=current;this.close();
        if(!current){this.buttons.replaceChildren();return;}
        this.fields=modelFields(groups,current);
        const seen=new Set<string>(),buttons:HTMLButtonElement[]=[];
        for(const field of this.fields){
            if(seen.has(field.id))continue;seen.add(field.id);
            const button=document.createElement('button');button.id='field-group-'+field.id;
            const label=document.createElement('span');label.className='srOnly';label.textContent=field.group;
            button.append(fieldIcon(field.id==='other'?'other':field.id),label);button.title=field.group;
            button.setAttribute('aria-label',field.group);
            const hint=()=>{this.hint.textContent=field.group;this.hint.hidden=false;const rect=button.getBoundingClientRect();
                this.hint.style.right=(innerWidth-rect.left+8)+'px';this.hint.style.top=rect.top+'px';};
            button.onpointerenter=event=>{if(event.pointerType!=='touch')hint();};button.onfocus=hint;
            button.onpointerleave=button.onblur=()=>{this.hint.hidden=true;};
            button.setAttribute('aria-controls','fieldMenu');button.setAttribute('aria-expanded','false');
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
        this.hint.hidden=true;
    }
    private show(id:string){
        this.close();this.open=id;
        document.getElementById('field-group-'+id)!.setAttribute('aria-expanded','true');
        const title=document.createElement('h2');title.textContent=this.fields.find(f=>f.id===id)!.group;
        const close=document.createElement('button');close.textContent='Закрыть';close.className='fieldMenuClose';close.onclick=()=>this.close(true);
        const preview=document.createElement('p');preview.className='fieldPreview';preview.id='fieldPreview';
        const selected=this.current?fieldTile(fieldAtTime(this.current,this.time)).label:'';
        preview.textContent=selected?'Выбрано: '+selected:'Выберите показатель';
        const content:HTMLElement[]=[title,close,preview];let previous='',grid:HTMLElement;
        for(const field of this.fields.filter(f=>f.id===id)){
            if(field.section!==previous){const heading=document.createElement('h3');heading.textContent=field.section;
                grid=document.createElement('div');grid.className='fieldGrid';content.push(heading,grid);previous=field.section;}
            const button=document.createElement('button');button.className='fieldOption';button.dataset.field=field.target.selection.field;
            button.setAttribute('aria-pressed',String(field.target.key===this.current?.key));
            const tile=fieldTile(fieldAtTime(field.target,this.time));button.title=tile.label;button.setAttribute('aria-label',tile.label);
            const label=document.createElement('span');label.className='srOnly';label.textContent=field.label;
            const variant=document.createElement('b');variant.className='fieldVariant';variant.textContent=tile.variant;
            const level=document.createElement('span');level.className='fieldLevel';level.textContent=tile.level;
            const interval=document.createElement('small');interval.textContent=tile.interval;
            const units=document.createElement('small');units.textContent=fieldUnits(field.target.selection.units);
            button.append(fieldIcon(tile.icon),label,variant,level,...(tile.interval?[interval]:[]),units);
            button.onfocus=button.onpointerenter=()=>{preview.textContent=tile.label;};
            button.onclick=()=>{this.close(true);this.choose(field.target);};grid!.append(button);
        }
        this.menu.replaceChildren(...content);this.menu.hidden=false;this.layout();
    }
    layout(){
        const rail=this.buttons.getBoundingClientRect(),timeline=document.getElementById('timelinePanel')!.getBoundingClientRect();
        const legend=(document.getElementById('legendDock')??document.getElementById('legendPanel'))!.getBoundingClientRect();
        const bottom=Math.min(timeline.top-10,legend.right>rail.left&&legend.top>rail.top?legend.top-10:timeline.top-10);
        this.buttons.style.maxHeight=Math.max(40,bottom-rail.top)+'px';
        if(!this.open)return;
        const button=document.getElementById('field-group-'+this.open)!.getBoundingClientRect();
        this.menu.style.right=(innerWidth-rail.left+8)+'px';this.menu.style.maxHeight=Math.max(80,timeline.top-24)+'px';
        this.menu.style.top=Math.max(10,Math.min(button.top,timeline.top-this.menu.offsetHeight-12))+'px';
    }
}
