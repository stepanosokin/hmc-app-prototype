import {FieldLoader,PublicationExpired,DISPLAY_LEVEL,displayBlockBound,type FieldData} from './field.js';
import type {PublishedGroup,Selection} from './selection.js';
import type {WindEntry} from './series.js';
import {WindArrows,windCanvasBytes,windParticleBytes} from './wind.js';
import {windAtTime,windGroups,windLevel,windVariant} from './wind-values.js';

/** Independent overlay owns one U/V pair and a compact, pinned point series. */
export class WindOverlay {
    enabled=true;
    paused=false;
    private resumeOnReady=false;
    private selectionKey='';
    level:string|undefined;
    levelLabel='';
    status='';
    entries=new Map<string,WindEntry>();
    state='missing';
    private failure:string|undefined;
    private failureStatus(error:unknown){
        this.failure=String(error);
        if(error instanceof PublicationExpired)return 'Публикация ветра истекла';
        if(error instanceof Error&&error.message.includes('бюджет'))return 'Недостаточно ресурсов для ветра. Уменьшите размер карты или выключите ветер.';
        return 'Не удалось загрузить ветер. Повторите попытку.';
    }
    private initialized=false;
    private groups:PublishedGroup[]=[];
    private source:Selection|undefined;
    private group:PublishedGroup|undefined;
    private time=0;
    private loader=new FieldLoader(false,DISPLAY_LEVEL);
    private serial=0;
    private key='';
    private field:FieldData|undefined;
    private arrows:WindArrows|undefined;
    private reservation=0;
    private points:WindEntry[]|undefined;
    private map:any;
    private host:(()=>any)|undefined;
    private shown=true;
    private allowFrame=true;
    private canvasSize='';
    private frame=()=>{
        const host=this.host?.();
        if(!this.shown||!this.enabled||!this.arrows||!host?.ready){this.arrows?.clear();return;}
        const canvas=this.map.getCanvas(),css=canvas.getBoundingClientRect();
        const size=[canvas.width,canvas.height,css.width,css.height].join(',');
        try{
            if(size!==this.canvasSize){
                this.admit(0);this.canvasSize=size;
            }
            if(this.resumeOnReady&&this.state==='ready'&&this.allowFrame){this.paused=false;this.resumeOnReady=false;this.ui();}
            const drawn=this.arrows.draw(host.geometry(),host.projection,host.center,host.mode,this.paused);
            if(drawn&&!document.hidden&&!this.paused)this.map.triggerRepaint();
        }catch(error){
            this.arrows.remove();this.arrows=undefined;this.field=undefined;this.state='error';this.status=this.failureStatus(error);this.ui();return;
        }
    };
    constructor(private changed:()=>void,private admit:(bytes:number)=>void,retryPoints=()=>{}){
        document.getElementById('windPause')!.onclick=()=>{
            this.paused=!this.paused;this.resumeOnReady=false;this.ui();this.map?.triggerRepaint();
        };
        document.getElementById('windToggle')!.onclick=()=>{this.enabled=!this.enabled;this.refresh();};
        (document.getElementById('windLevel') as HTMLSelectElement).onchange=e=>{
            if(this.paused)this.resumeOnReady=true;
            this.level=(e.target as HTMLSelectElement).value||undefined;this.initialized=true;this.levelLabel='';this.refresh();
        };
        document.getElementById('windRetry')!.onclick=()=>{
            if(this.state==='error'){this.key='';this.refresh();}
            retryPoints();
        };
    }
    mount(map:any,host:()=>any){
        if(this.paused)this.resumeOnReady=true;
        this.unmount();this.map=map;this.host=host;map.on('render',this.frame);
        if(this.field){this.arrows=new WindArrows(this.field);this.arrows.attach(map.getCanvasContainer(),()=>map.triggerRepaint());}
        map.triggerRepaint();
    }
    unmount(){this.map?.off('render',this.frame);this.arrows?.remove();this.arrows=undefined;this.map=undefined;this.host=undefined;}
    visible(shown:boolean){this.shown=shown;if(!shown)this.arrows?.clear();else this.map?.triggerRepaint();}
    releaseFrame(){
        if(this.paused)this.resumeOnReady=true;
        this.serial++;this.loader.cancel();this.reservation=0;this.key='';this.canvasSize='';
        this.arrows?.remove();this.arrows=undefined;this.field=undefined;
        this.state='missing';
        if(this.enabled){this.status='Ожидание выбранного поля · ветер '+this.levelLabel;this.ui();}
    }
    bytes(){const canvas=this.map?.getCanvas();return this.reservation+(this.field?this.field.blocks.reduce((n,b)=>n+b.byteLength,0)+
        (this.arrows?.bytes(canvas?.width??0,canvas?.height??0)??this.field.wind!.blocks.reduce((n,b)=>n+b.byteLength,0))+2*1024**2:0);}
    update(groups:PublishedGroup[],source:Selection|undefined,time:number,allowFrame=true){
        const key=source?.selection+'|'+time;
        if(key!==this.selectionKey&&this.paused)this.resumeOnReady=true;
        this.selectionKey=key;
        this.groups=groups;this.source=source;this.time=time;this.allowFrame=allowFrame;this.refresh();
    }
    private refresh(){
        const available=this.source?windGroups(this.groups,this.source):[];
        const previousGroup=this.group?.key;
        if(!this.initialized&&available.length){
            const near=available.find(g=>g.selection.field_level_type==='heightAboveGround'&&Number(g.selection.level)===10);
            this.level=near?windVariant(near.selection):available.length===1?windVariant(available[0].selection):undefined;
            this.initialized=true;
        }
        this.group=available.find(g=>windVariant(g.selection)===this.level);
        if(this.group?.key!==previousGroup)this.clearPoints();
        if(this.group)this.levelLabel=windLevel(this.group.selection);
        const select=document.getElementById('windLevel') as HTMLSelectElement;
        select.replaceChildren(new Option('Выберите уровень ветра',''),...available.map(g=>new Option(windLevel(g.selection),windVariant(g.selection))));
        if(this.level&&!this.group)select.append(new Option((this.levelLabel||'Выбранный уровень')+' · недоступен',this.level));
        select.value=this.level??'';select.disabled=!this.enabled;
        document.getElementById('windToggle')!.setAttribute('aria-pressed',String(this.enabled));
        const current=this.enabled&&this.allowFrame?windAtTime(this.group,this.time):undefined;
        const next=current?.selection??'';
        if(next&&next===this.key&&this.state!=='error'){this.ui();return;}
        this.key=next;this.serial++;const serial=this.serial;this.loader.cancel();this.reservation=0;
        this.failure=undefined;
        this.arrows?.remove();this.arrows=undefined;this.field=undefined;
        this.state=current?'loading':'missing';
        if(!this.enabled){this.clearPoints();this.status='Ветер выключен';}
        else if(!this.allowFrame)this.status='Ветер ожидает загрузки выбранного поля · '+this.levelLabel;
        else if(!available.length)this.status='Нет данных ветра для выбранного расчёта';
        else if(!this.level)this.status='Выберите уровень ветра';
        else if(!this.group)this.status='Ветер: '+(this.levelLabel||'выбранный уровень')+' недоступен';
        else this.status=current?'Загрузка ветра · '+this.levelLabel:'Нет данных ветра · '+this.levelLabel+' · выбранный срок';
        this.ui();
        if(!current)return;
        void (async()=>{
            try{
                const blocks=displayBlockBound(current);
                if(!Number.isInteger(blocks)||blocks<1||blocks>64)throw Error('Некорректный размер поля ветра');
                const canvas=this.map?.getCanvas();
                const css=canvas?.getBoundingClientRect();
                const bytes=blocks*332820*2+2*1024**2+windCanvasBytes(canvas?.width??0,canvas?.height??0)+windParticleBytes(css?.width??0,css?.height??0);
                this.admit(bytes);this.reservation=bytes;
                const field=await this.loader.load(current);
                if(serial!==this.serial)return;
                this.reservation=0;this.field=field;this.canvasSize='';this.admit(0);this.state='ready';
                this.status=field.metadata.all_nodata||field.wind?.metadata.all_nodata?'Нет данных ветра · '+this.levelLabel:'Ветер · '+this.levelLabel+' · частицы по потоку';
                if(this.map){
                    const map=this.map;
                    this.arrows=new WindArrows(field);this.arrows.attach(map.getCanvasContainer(),()=>map.triggerRepaint());map.triggerRepaint();
                }
                this.ui();
            }catch(error){if(serial!==this.serial)return;
                this.reservation=0;this.state='error';this.field=undefined;
                this.status=this.failureStatus(error);
                if(error instanceof PublicationExpired)this.clearPoints();this.ui();
            }
        })();
    }
    private ui(){
        const pause=document.getElementById('windPause') as HTMLButtonElement;
        pause.textContent=this.paused?'Продолжить':'Пауза';pause.setAttribute('aria-pressed',String(this.paused));
        pause.disabled=!this.enabled||this.state!=='ready';
        const message=document.getElementById('windStatus')!;
        if(message.textContent!==this.status)message.textContent=this.status;
        this.pointRetryStatus();
        this.changed();
    }
    private pointRetryStatus(){
        document.getElementById('windRetry')!.hidden=this.state!=='error'&&![...this.entries.values()].some(e=>e.state==='error');
    }
    get pointGroup(){return this.enabled?this.group:undefined;}
    clearPoints(){this.points=undefined;this.entries=new Map();}
    setPoints(points:WindEntry[]){
        if(this.points===points)return;
        this.points=points;
        this.entries=new Map(points.map(point=>[point.time,point]));
        this.pointRetryStatus();
    }
    evidence(){return {enabled:this.enabled,paused:this.paused,resume_pending:this.resumeOnReady,level:this.level,label:this.levelLabel,state:this.state,status:this.status,
        selection:this.key,bytes:this.bytes(),failure:this.failure,point_entries:[...this.entries.values()],arrows:this.arrows?.evidence()};}
    dispose(){this.serial++;this.loader.cancel();this.clearPoints();this.unmount();this.field=undefined;this.reservation=0;}
}
