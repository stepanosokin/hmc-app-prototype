import {FieldLoader,json,PublicationExpired,type FieldData,type NativeMetadata} from './field.js';
import type {PublishedGroup,Selection} from './selection.js';
import {pointValue,type Position} from './series.js';
import {nativePosition} from './source-crs.js';
import {earthComponents,WindArrows} from './wind.js';
import {windAtTime,windGroups,windLevel,windValue,windVariant} from './wind-values.js';

export interface WindEntry {time:string;state:'loading'|'missing'|'value'|'error'|'outside_coverage'|'native_nodata';speed?:number;direction?:number|null}
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
    private loader=new FieldLoader();
    private serial=0;
    private key='';
    private field:FieldData|undefined;
    private arrows:WindArrows|undefined;
    private reservation=0;
    private pointController=new AbortController();
    private pointKey='';
    private map:any;
    private host:(()=>any)|undefined;
    private shown=true;
    private allowFrame=true;
    private canvasSize='';
    private frame=()=>{
        const host=this.host?.();
        if(!this.shown||!this.enabled||!this.arrows||!host?.ready){this.arrows?.clear();return;}
        const size=this.map.getCanvas().width+','+this.map.getCanvas().height;
        if(size!==this.canvasSize){
            try{this.admit(0);this.canvasSize=size;}catch(error){
                this.arrows.remove();this.arrows=undefined;this.field=undefined;this.state='error';this.status=this.failureStatus(error);this.ui();return;
            }
        }
        if(this.resumeOnReady&&this.state==='ready'&&this.allowFrame){this.paused=false;this.resumeOnReady=false;this.ui();}
        this.arrows.draw(host.geometry(),host.projection,host.center,host.mode,this.paused);
        if(!document.hidden&&!this.paused)this.map?.triggerRepaint();
    };
    constructor(private changed:()=>void,private admit:(bytes:number)=>void){
        document.getElementById('windPause')!.onclick=()=>{
            this.paused=!this.paused;this.resumeOnReady=false;this.ui();this.map?.triggerRepaint();
        };
        document.getElementById('windToggle')!.onclick=()=>{this.enabled=!this.enabled;this.refresh();};
        (document.getElementById('windLevel') as HTMLSelectElement).onchange=e=>{
            if(this.paused)this.resumeOnReady=true;
            this.level=(e.target as HTMLSelectElement).value||undefined;this.initialized=true;this.levelLabel='';this.refresh();
        };
        document.getElementById('windRetry')!.onclick=()=>{this.key='';this.pointKey='';this.refresh();};
    }
    mount(map:any,host:()=>any){
        if(this.paused)this.resumeOnReady=true;
        this.unmount();this.map=map;this.host=host;map.on('render',this.frame);
        if(this.field){this.arrows=new WindArrows(this.field);this.arrows.attach(map.getCanvasContainer());}
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
        if(!this.initialized&&available.length){
            const near=available.find(g=>g.selection.field_level_type==='heightAboveGround'&&Number(g.selection.level)===10);
            this.level=near?windVariant(near.selection):available.length===1?windVariant(available[0].selection):undefined;
            this.initialized=true;
        }
        this.group=available.find(g=>windVariant(g.selection)===this.level);
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
        if(this.pointKey&&!this.pointKey.startsWith((this.group?.key??'!')+'|'))this.clearPoints();
        this.ui();
        if(!current)return;
        void (async()=>{
            try{
                const blocks=current.display_blocks??64;
                if(!Number.isInteger(blocks)||blocks<1||blocks>64)throw Error('Некорректный размер поля ветра');
                const canvas=this.map?.getCanvas();
                const bytes=blocks*332820*2+2*1024**2+(canvas?.width??0)*(canvas?.height??0)*4+8192*64;
                this.admit(bytes);this.reservation=bytes;
                const field=await this.loader.load(current);
                if(serial!==this.serial)return;
                this.reservation=0;this.field=field;this.canvasSize='';this.admit(0);this.state='ready';
                this.status=field.metadata.all_nodata||field.wind?.metadata.all_nodata?'Нет данных ветра · '+this.levelLabel:'Ветер · '+this.levelLabel+' · частицы по потоку';
                if(this.map){this.arrows=new WindArrows(field);this.arrows.attach(this.map.getCanvasContainer());this.map.triggerRepaint();}
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
        document.getElementById('windRetry')!.hidden=this.state!=='error'&&![...this.entries.values()].some(e=>e.state==='error');
        this.changed();
    }
    clearPoints(){this.pointController.abort();this.pointController=new AbortController();this.entries.clear();this.pointKey='';}
    points(position:Position|undefined){
        if(!this.enabled||!this.group||!position){if(this.pointKey){this.clearPoints();this.ui();}return;}
        const group=this.group,key=group.key+'|'+position.lng+','+position.lat;
        if(key===this.pointKey)return;
        this.clearPoints();this.pointKey=key;
        const signal=this.pointController.signal;
        const times=group.times;
        for(let i=0;i<times.length;i++){const time=new Date(group.start+i*3600000).toISOString();this.entries.set(time,{time,state:times[i]?.wind_v?'loading':'missing'});}
        void (async()=>{
            try{
                const first=times.find(s=>s?.wind_v);if(!first)return;
                const metadata=this.field?.metadata??await json<NativeMetadata>(first.native_display,signal);
                if(metadata.identity.native_grid_sha256!==first.native_grid_sha256||typeof metadata.uv_relative_to_grid!=='boolean'||
                    !metadata.source_crs||metadata.grid.shape_yx.length!==2)throw Error('Несогласованная геометрия ветра');
                for(let i=0;i<times.length;i++){
                    signal.throwIfAborted();const current=times[i],entry=this.entries.get(new Date(group.start+i*3600000).toISOString())!;
                    if(!current?.wind_v)continue;
                    try{
                        const [u,v]=await Promise.all([pointValue(current,position,signal),pointValue(current.wind_v,position,signal)]);
                        signal.throwIfAborted();
                        if(u.value===null||v.value===null){entry.state=u.reason==='outside_coverage'||v.reason==='outside_coverage'?'outside_coverage':'native_nodata';}
                        else{
                            if(!u.cell||!v.cell||u.cell.row!==v.cell.row||u.cell.column!==v.cell.column)throw Error('Разные ячейки U/V');
                            const [w,s]=metadata.grid.outer_cell_edges_wsen,[dx,dy]=metadata.grid.spacing_degrees_xy;
                            const xy=[w+(u.cell.column+.5)*dx,s+(u.cell.row+.5)*dy],geographic=nativePosition(metadata.source_crs,xy,true);
                            if(typeof current.uv_relative_to_grid!=='boolean')throw Error('Не задана ориентация компонент');
                            const earth=earthComponents(u.value,v.value,{...metadata,uv_relative_to_grid:current.uv_relative_to_grid},xy,geographic,p=>nativePosition(metadata.source_crs,p,true));
                            if(!earth)throw Error('Не определено направление ветра');
                            Object.assign(entry,windValue(earth.east,earth.north),{state:'value'});
                        }
                    }catch(error){if(signal.aborted)return;if(error instanceof PublicationExpired)throw error;entry.state='error';}
                    this.ui();
                }
            }catch(error){if(signal.aborted)return;
                if(error instanceof PublicationExpired){
                    this.releaseFrame();this.state='error';this.status=this.failureStatus(error);
                    for(const entry of this.entries.values()){entry.state='error';delete entry.speed;delete entry.direction;}
                }else for(const entry of this.entries.values())if(entry.state==='loading')entry.state='error';
                this.ui();
            }
        })();
    }
    evidence(){return {enabled:this.enabled,paused:this.paused,resume_pending:this.resumeOnReady,level:this.level,label:this.levelLabel,state:this.state,status:this.status,
        selection:this.key,bytes:this.bytes(),failure:this.failure,point_entries:[...this.entries.values()],arrows:this.arrows?.evidence()};}
    dispose(){this.serial++;this.loader.cancel();this.clearPoints();this.unmount();this.field=undefined;this.reservation=0;}
}
