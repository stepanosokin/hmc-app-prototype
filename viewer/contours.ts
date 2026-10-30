import type {FieldData} from './field.js';
import type {Selection} from './selection.js';
import {contourProfile} from './display-units.js';
import {lineLength,mapWidthKm,nativeViewWindow} from './contour-geometry.js';

interface View {origin:number[];scale:number;width:number;height:number;center:number[];mode:string}
type Points=Float32Array|Float64Array|Uint16Array;
interface Curve {level:number;points:Points;length:number;quantum:number;offset:number}
interface Frame {key:string;view:View;curves:Curve[];bytes:number;stats:unknown;elapsed_ms:number}
const BUILD_RESERVATION=13*1024**2,CACHE_LIMIT=4*1024**2;
function at(points:Points,distance:number,quantum=1){
    for(let i=2;i<points.length;i+=2){const dx=points[i]-points[i-2],dy=points[i+1]-points[i-1],n=Math.hypot(dx,dy)*quantum;
        if(distance<=n)return [points[i-2]+dx*distance/(n||1),points[i-1]+dy*distance/(n||1)];distance-=n;}
    return [points[points.length-2],points[points.length-1]];
}
/** One bounded, cancellable native-cell worker; no raster pixels or extra HTTP requests. */
export class ContourOverlay {
    enabled=true;
    private field:FieldData|undefined;
    private selection:Selection|undefined;
    private map:any;
    private host:(()=>any)|undefined;
    private canvas=document.createElement('canvas');
    private worker:Worker|undefined;
    private reservation=0;
    private serial=0;
    private timer:ReturnType<typeof setTimeout>|undefined;
    private requested='';
    private cache=new Map<string,Frame>();
    private shown:Frame|undefined;
    private light=false;
    private state='missing';
    private message='Нет поля для изолиний';
    private profile:ReturnType<typeof contourProfile>|undefined;
    private view:View|undefined;
    private labels:unknown[]=[];
    private cacheHits=0;
    private drawMs=0;
    private color='#000000';
    private failure='';
    private drawnKey='';
    private widthKey='';
    private widthKm=0;
    constructor(private admit:(bytes:number)=>void,private temperatureUnit:()=>string){
        this.canvas.className='fieldContours';this.canvas.setAttribute('aria-hidden','true');
        document.getElementById('contourToggle')!.onclick=()=>{
            this.enabled=!this.enabled;
            if(!this.enabled){this.cancel();this.clear();this.state='disabled';}else this.requested='';
            this.ui();this.map?.triggerRepaint();
        };
        document.getElementById('contourRetry')!.onclick=()=>{
            this.requested='';this.state='loading';this.message='Построение изолиний…';this.ui();this.map?.triggerRepaint();
        };
    }
    bytes(){return this.canvas.width*this.canvas.height*4+[...this.cache.values()].reduce((n,f)=>n+f.bytes,0)+this.reservation;}
    private cancel(){clearTimeout(this.timer);this.timer=undefined;this.worker?.terminate();this.worker=undefined;this.reservation=0;this.serial++;}
    private clear(){this.canvas.getContext('2d')?.clearRect(0,0,this.canvas.width,this.canvas.height);this.labels=[];this.drawnKey='';}
    private reset(){this.cancel();this.cache.clear();this.shown=undefined;this.requested='';this.drawnKey='';this.clear();}
    cancelBuilding(){this.cancel();this.requested='';}
    update(field:FieldData|undefined,selection:Selection|undefined){
        if(field?.metadata.selection!==this.field?.metadata.selection||Boolean(field)!==Boolean(this.field)){
            this.reset();this.field=field;this.selection=selection;
            this.profile=undefined;
            this.failure='';
            this.state=field?'loading':'missing';this.message=field?'Построение изолиний…':'Нет поля для изолиний';
        }else this.selection=selection;
        this.ui();
    }
    theme(light:boolean){this.light=light;this.color=light?'#707070':'#000000';this.map?.triggerRepaint();}
    mount(map:any,host:()=>any){this.unmount();this.map=map;this.host=host;map.getCanvasContainer().append(this.canvas);map.on('render',this.frame);}
    unmount(){this.reset();if(this.map)this.map.off('render',this.frame);this.map=undefined;this.host=undefined;this.canvas.remove();this.canvas.width=0;this.canvas.height=0;}
    private ui(){
        const button=document.getElementById('contourToggle')!,legend=document.getElementById('contourLegend')!;
        button.setAttribute('aria-pressed',String(this.enabled));button.textContent='Изолинии';
        const p=this.profile;
        const units=p?.temperature&&this.temperatureUnit()==='K'?'K':p?.unit;
        legend.textContent=!this.enabled?'Изолинии выключены':['ready','empty'].includes(this.state)&&p?
            `${p.noun} проведены через ${p.step} ${units}${this.state==='empty'?' · '+this.message:''}${p.note?' · '+p.note:''}`:
            this.message+(p?.note?' · '+p.note:'');
        document.getElementById('contourRetry')!.hidden=this.state!=='error'||!this.enabled;
    }
    private frame=()=>{
        const host=this.host?.();
        if(!host?.ready||!host.fieldVisible||!this.field||!this.selection||!this.enabled){this.clear();return;}
        if(this.field.metadata.portrayal_baseline||this.selection.wind_v){this.clear();this.message='Для векторного слоя изолинии не применяются';this.state='missing';this.ui();return;}
        try{
            const g=host.geometry(),width=this.map.getContainer().clientWidth,height=this.map.getContainer().clientHeight,dpr=g.width/width;
            const view:View={origin:g.origin.map((v:number)=>v/dpr),scale:g.scale/dpr,width,height,center:[...host.center],mode:host.mode};
            const widthKey=JSON.stringify(view);
            if(widthKey!==this.widthKey){this.widthKm=mapWidthKm(view,(xy:number[])=>host.projection.inverse(xy));this.widthKey=widthKey;}
            const profile=contourProfile(this.selection,this.widthKm);
            if(!profile.step){this.clear();this.message='Для показателя не задан шаг изолиний';this.state='missing';this.ui();return;}
            this.profile=profile;this.view=view;
            if(this.field.metadata.all_nodata){this.clear();this.state='empty';this.message='Нет данных для изолиний';this.ui();return;}
            if(this.canvas.width!==width||this.canvas.height!==height){
                this.admit(width*height*4-this.canvas.width*this.canvas.height*4);this.canvas.width=width;this.canvas.height=height;
            }
            const key=JSON.stringify([this.field.metadata.selection,profile.step,view.mode,view.center,view.origin.map(v=>Math.round(v*100)/100),view.scale.toPrecision(10),width,height]);
            const cached=this.cache.get(key);
            if(cached){if(this.requested!==key){this.cancel();this.requested=key;}if(this.shown!==cached)this.cacheHits++;this.shown=cached;this.failure='';this.state=cached.curves.length?'ready':'empty';this.message='Нет изолиний с выбранным шагом';this.ui();}
            else if(key!==this.requested){
                this.cancel();this.requested=key;this.state='loading';this.message='Построение изолиний…';this.ui();
                const serial=this.serial;
                const projection=host.projection;
                this.timer=setTimeout(()=>this.build(key,view,serial,(xy:number[])=>projection.inverse(xy)),100);
            }
            this.draw(view);
        }catch(error){this.fail(error);}
    };
    private build(key:string,view:View,serial:number,inverse:(xy:number[])=>number[]){
        if(serial!==this.serial||!this.field||!this.profile)return;
        try{
            try{this.admit(BUILD_RESERVATION);}catch{
                // The shared renderer/point-series budget takes priority over a
                // disposable contour cache. Release its actual owners first.
                this.cache.clear();this.shown=undefined;this.clear();this.admit(BUILD_RESERVATION);
            }
            this.reservation=BUILD_RESERVATION;
            const field=this.field,profile=this.profile;
            const worker=new Worker(new URL('./contour-worker.js',import.meta.url),{type:'module'});this.worker=worker;
            worker.onerror=()=>{if(serial===this.serial)this.fail(Error('Ошибка фонового построения изолиний'));};
            worker.onmessage=({data:result})=>{
                if(serial!==this.serial||this.field!==field)return;
                if(result.type==='block'){
                    const source=field.blocks[result.index];
                    if(!source){this.fail(Error('Нативный блок недоступен'));return;}
                    const buffer=source.slice(0);worker.postMessage({type:'block',index:result.index,buffer},[buffer]);
                }else if(result.type==='error')this.fail(Error(result.message));
                else if(result.type==='result'){
                    worker.terminate();this.worker=undefined;this.reservation=0;
                    const frame:Frame={...result,key,view,bytes:result.bytes+8192,curves:result.curves.map((c:Curve)=>({...c,length:lineLength(c.points)*c.quantum}))};
                    frame.curves.sort((a,b)=>b.length-a.length);
                    while(this.cache.size&&(this.cache.size>=8||[...this.cache.values()].reduce((n,f)=>n+f.bytes,0)+frame.bytes>CACHE_LIMIT))this.cache.delete(this.cache.keys().next().value!);
                    this.admit(frame.bytes);this.cache.set(key,frame);this.shown=frame;this.failure='';this.state=frame.curves.length?'ready':'empty';this.message='Нет изолиний с выбранным шагом';this.ui();this.map?.triggerRepaint();
                }
            };
            const nativeWindow=nativeViewWindow(field.metadata,view,inverse);
            worker.postMessage({type:'start',metadata:field.metadata,profile,view,count:field.blocks.length,nativeWindow});
        }catch(error){this.fail(error);}
    }
    private fail(error:unknown){this.cancel();this.clear();this.shown=undefined;this.state='error';this.failure=String(error);
        const message=error instanceof Error?error.message:'';
        this.message=/^[А-ЯЁ]/.test(message)?message:'Не удалось построить изолинии. Повторите попытку.';this.ui();}
    private draw(view:View){
        const frame=this.shown;
        const boxes=[...document.querySelectorAll<HTMLElement>('.panel,.mapLabel,#pointCard,#drawer')].filter(e=>e.checkVisibility()).map(e=>e.getBoundingClientRect());
        const font=getComputedStyle(document.body).fontFamily;
        const drawKey=JSON.stringify([frame?.key,view,this.color,this.temperatureUnit(),font,this.state,boxes.map(b=>[b.x,b.y,b.width,b.height])]);
        if(this.drawnKey===drawKey)return;
        const start=performance.now(),ctx=this.canvas.getContext('2d')!;this.clear();
        this.drawnKey=drawKey;
        if(!frame||frame.view.mode!==view.mode||view.mode==='hmc:orthographic'&&frame.view.center.join(',')!==view.center.join(','))return;
        const ratio=view.scale/frame.view.scale;
        // Enlarging old simplified geometry would enlarge its pixel error as well.
        if(ratio>1.001)return;
        const occupied:number[][]=[],used=new Set<number>();
        ctx.strokeStyle=this.color;ctx.fillStyle=this.color;ctx.lineWidth=1;ctx.font=getComputedStyle(document.body).font;
        ctx.font='12px '+font;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineCap='round';
        ctx.beginPath();const texts:{x:number;y:number;angle:number;text:string}[]=[];
        for(const curve of frame.curves){
            if(curve.length*Math.abs(ratio)<60)continue;
            const points=curve.points,total=curve.length;
            const {quantum,offset}=curve;
            const transform=(p:number[])=>[view.origin[0]+(p[0]*quantum+offset-frame.view.origin[0])*ratio,view.origin[1]+(p[1]*quantum+offset-frame.view.origin[1])*ratio];
            let label:{x:number;y:number;angle:number;text:string;low:number;high:number}|undefined;
            if(this.labels.length<6&&!used.has(curve.level)&&this.state==='ready')for(const fraction of [.5,.32,.68]){
                const value=curve.level+(this.profile?.temperature&&this.temperatureUnit()==='K'?273.15:0);
                const text=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2,useGrouping:false}).format(value),w=ctx.measureText(text).width+8;
                const distance=total*fraction,p=transform(at(points,distance,quantum)),a=transform(at(points,Math.max(0,distance-w/Math.abs(ratio)/2),quantum)),b=transform(at(points,Math.min(total,distance+w/Math.abs(ratio)/2),quantum));
                if(Math.hypot(b[0]-a[0],b[1]-a[1])<w*.85)continue;
                const box=[p[0]-w/2-4,p[1]-w/2-4,p[0]+w/2+4,p[1]+w/2+4];
                if(box[0]<10||box[1]<10||box[2]>view.width-10||box[3]>view.height-10)continue;
                if(occupied.some(q=>box[0]<q[2]&&box[2]>q[0]&&box[1]<q[3]&&box[3]>q[1])||boxes.some(q=>box[0]<q.right&&box[2]>q.left&&box[1]<q.bottom&&box[3]>q.top))continue;
                label={x:p[0],y:p[1],angle:Math.atan2(b[1]-a[1],b[0]-a[0]),text,low:distance-w/Math.abs(ratio)/2,high:distance+w/Math.abs(ratio)/2};
                occupied.push(box);used.add(curve.level);break;
            }
            const stroke=(low:number,high:number)=>{
                if(high<=low)return;
                const first=transform(low===0?[points[0],points[1]]:at(points,low,quantum));ctx.moveTo(first[0],first[1]);let distance=0;
                for(let i=2;i<points.length;i+=2){distance+=Math.hypot(points[i]-points[i-2],points[i+1]-points[i-1])*quantum;
                    if(distance>low&&distance<high)ctx.lineTo(view.origin[0]+(points[i]*quantum+offset-frame.view.origin[0])*ratio,view.origin[1]+(points[i+1]*quantum+offset-frame.view.origin[1])*ratio);}
                const last=transform(high===total?[points[points.length-2],points[points.length-1]]:at(points,high,quantum));ctx.lineTo(last[0],last[1]);
            };
            if(label){stroke(0,label.low);stroke(label.high,total);texts.push(label);
                this.labels.push({level:curve.level,x:label.x,y:label.y,angle:label.angle,text:label.text,gap:[label.low,label.high]});}
            else stroke(0,total);
        }
        ctx.stroke();for(const label of texts){ctx.save();ctx.translate(label.x,label.y);ctx.rotate(label.angle);ctx.fillText(label.text,0,0);ctx.restore();}
        this.drawMs=performance.now()-start;
    }
    evidence(){return {enabled:this.enabled,state:this.state,message:this.message,selection:this.field?.metadata.selection,profile:this.profile,
        labels:this.labels,bytes:this.bytes(),worker_active:Boolean(this.worker),cache_entries:this.cache.size,cache_hits:this.cacheHits,
        curves:this.shown?.curves.length,stats:this.shown?.stats,build_ms:this.shown?.elapsed_ms,draw_ms:this.drawMs,color:this.color,view:this.view,width_km:this.widthKm,failure:this.failure,
        native_grid:this.field?.metadata.grid,encoding_max_abs_error:this.field?.metadata.encoding_max_abs_error};}
    dispose(){this.unmount();this.field=undefined;this.selection=undefined;}
}
