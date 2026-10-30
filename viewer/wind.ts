import type {FieldData} from './field.js';
import {nativePosition} from './source-crs.js';

function sample(field:FieldData,xy:number[]):number|undefined{
    const grid=field.metadata.grid,[west,south,east,north]=grid.outer_cell_edges_wsen,[ny,nx]=grid.shape_yx;
    if(!xy.every(Number.isFinite)||xy[0]<west||xy[0]>=east||xy[1]<south||xy[1]>=north)return;
    const [dx,dy]=grid.spacing_degrees_xy;
    const x=Math.max(0,Math.min(nx-1,(xy[0]-west)/dx-.5)),y=Math.max(0,Math.min(ny-1,(xy[1]-south)/dy-.5));
    const left=Math.floor(x),bottom=Math.floor(y),fx=x-left,fy=y-bottom;
    let result=0;
    for(const [column,row,weight] of [[left,bottom,(1-fx)*(1-fy)],[Math.min(left+1,nx-1),bottom,fx*(1-fy)],
        [left,Math.min(bottom+1,ny-1),(1-fx)*fy],[Math.min(left+1,nx-1),Math.min(bottom+1,ny-1),fx*fy]]){
        if(weight===0)continue;
        const block=field.blocks[Math.floor(row/256)*(field.metadata.columns[1]+1)+Math.floor(column/256)];
        const index=(row%256+1)*258+column%256+1;
        if(!block||new Uint8Array(block,258*258*4)[index]!==1)return;
        const value=new Float32Array(block,0,258*258)[index];
        if(!Number.isFinite(value))return;
        result+=value*weight;
    }
    return result;
}

/** One native bilinear sample per component; any weighted nodata is a gap. */
export function sampleWind(field:FieldData,xy:number[]):{u:number;v:number}|undefined{
    if(!field.wind)return;
    const u=sample(field,xy),v=sample(field.wind,xy);
    return u===undefined||v===undefined?undefined:{u,v};
}

/** Rotate physical components using the two local source-grid axis directions. */
export function earthWind(field:FieldData,xy:number[],geographic:number[],inverse:(xy:number[])=>number[]){
    const wind=sampleWind(field,xy);if(!wind)return;
    return earthComponents(wind.u,wind.v,field.metadata,xy,geographic,inverse);
}

export function earthComponents(u:number,v:number,metadata:FieldData['metadata'],xy:number[],geographic:number[],inverse:(xy:number[])=>number[]){
    if(!Number.isFinite(u)||!Number.isFinite(v))return;
    if(!metadata.uv_relative_to_grid)return {east:u,north:v};
    const speed=Math.hypot(u,v);if(speed===0)return {east:0,north:0};
    const step=(metadata.source_crs?.template??0)<2?1e-5:1;
    const phi=geographic[1]*Math.PI/180,e2=.0066943799901413165;
    const northMetric=(1-e2)/(1-e2*Math.sin(phi)**2); // WGS84 M/N
    const axis=(x:number,y:number)=>{
        const p=inverse([x,y]),east=(((p[0]-geographic[0]+540)%360)-180)*Math.cos(phi),north=(p[1]-geographic[1])*northMetric;
        const length=Math.hypot(east,north);return length>1e-12?[east/length,north/length]:undefined;
    };
    const x=axis(xy[0]+step,xy[1]),y=axis(xy[0],xy[1]+step);if(!x||!y)return;
    const east=x[0]*u+y[0]*v,north=x[1]*u+y[1]*v,length=Math.hypot(east,north);
    if(length<1e-12)return;
    // The declared sphere/WGS84 coordinate bridge transports orientation;
    // its angular scale distortion must not change physical metres/second.
    return {east:east*speed/length,north:north*speed/length};
}

interface Geometry {width:number;height:number;origin:number[];scale:number}
interface Arrow {x:number;y:number;dx:number;dy:number;valid:boolean;age:number}
type WindProjection={forward:(xy:number[])=>number[];inverse:(xy:number[])=>number[]};

const PARTICLE_LIFETIME_SECONDS=1.7;
const PARTICLE_PLACEMENT_ATTEMPTS=8;

export function screenVelocity(p:number[],wind:{east:number;north:number},projection:WindProjection){
    const speed=Math.hypot(wind.east,wind.north);
    if(speed<.05||Math.abs(p[1])>89.9)return;
    const phi=p[1]*Math.PI/180,e2=.0066943799901413165,q=1-e2*Math.sin(phi)**2;
    const n=6378137/Math.sqrt(q),m=6378137*(1-e2)/q**1.5,rad=180/Math.PI;
    // A one-metre physical tangent step; WGS84 east/north radii differ.
    const start=projection.forward(p),end=projection.forward([p[0]+wind.east/speed/(n*Math.cos(phi))*rad,p[1]+wind.north/speed/m*rad]);
    const dx=end[0]-start[0],dy=start[1]-end[1],length=Math.hypot(dx,dy);
    if(!Number.isFinite(length)||length<1e-10)return;
    return {dx:dx/length*Math.min(80,speed*3),dy:dy/length*Math.min(80,speed*3)};
}

/** Bounded decorative advection: direction/speed come from U/V, never trajectories. */
export class WindArrows {
    private canvas:HTMLCanvasElement|undefined;
    private arrows:Arrow[]=[];
    private last=0;
    private cursor=0;
    private frames=0;
    private viewKey='';
    private paints=0;
    private viewChanges=0;
    private field:FieldData;
    private display:{projection:WindProjection;center:number[];mode:string;visible:(p:number[])=>boolean}|undefined;
    constructor(field:FieldData){this.field=field;}
    attach(container:HTMLElement){
        this.canvas=document.createElement('canvas');this.canvas.className='windArrows';
        this.canvas.setAttribute('aria-hidden','true');
        Object.assign(this.canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});
        container.append(this.canvas);
        this.arrows=[];
    }
    bytes(width:number,height:number){return (this.field.wind?.blocks.reduce((n,b)=>n+b.byteLength,0)??0)+width*height*4+this.arrows.length*64;}
    clear(){this.canvas?.getContext('2d')?.clearRect(0,0,this.canvas.width,this.canvas.height);this.last=0;}
    draw(view:Geometry,projection:WindProjection,center:number[],mode:string,paused=false){
        const canvas=this.canvas;if(!canvas)return;
        if(canvas.width!==view.width||canvas.height!==view.height){canvas.width=view.width;canvas.height=view.height;}
        const ctx=canvas.getContext('2d');if(!ctx)return;
        const css=canvas.getBoundingClientRect(),count=Math.min(8192,Math.max(1,Math.round(css.width*css.height/(1440*900)*2400)));
        if(count!==this.arrows.length)this.arrows=Array.from({length:count},()=>({x:Math.random(),y:Math.random(),dx:0,dy:0,valid:false,age:Math.random()}));
        const key=JSON.stringify([view.width,view.height,view.origin,view.scale,center,mode]);
        const moved=key!==this.viewKey;this.viewKey=key;
        if(moved){this.viewChanges++;ctx.clearRect(0,0,canvas.width,canvas.height);for(const arrow of this.arrows)arrow.valid=false;}
        const now=performance.now(),dt=!paused&&this.last?Math.min(.05,(now-this.last)/1000):0;this.last=now;this.frames++;
        const geographic=(x:number,y:number)=>projection.inverse([(x*view.width-view.origin[0])/view.scale,(view.origin[1]-y*view.height)/view.scale]);
        const visible=(p:number[])=>{
            if(!p.every(Number.isFinite)||Math.abs(p[1])>90||mode==='EPSG:3576'&&p[1]<45)return false;
            if(mode!=='hmc:orthographic')return true;
            const rad=Math.PI/180;
            return Math.sin(p[1]*rad)*Math.sin(center[1]*rad)+Math.cos(p[1]*rad)*Math.cos(center[1]*rad)*Math.cos((p[0]-center[0])*rad)>0;
        };
        this.display={projection,center:[...center],mode,visible};
        const updateVelocity=(arrow:Arrow)=>{
            arrow.valid=false;
            const p=geographic(arrow.x,arrow.y);
            if(!visible(p))return false;
            const xy=nativePosition(this.field.metadata.source_crs,p);
            const wind=earthWind(this.field,xy,p,q=>nativePosition(this.field.metadata.source_crs,q,true));
            if(!wind)return false;
            const velocity=screenVelocity(p,wind,projection);if(!velocity)return false;
            arrow.dx=velocity.dx;arrow.dy=velocity.dy;arrow.valid=true;
            return true;
        };
        const respawn=(arrow:Arrow,age=0)=>{
            arrow.age=age;
            // Independent uniform coordinates avoid lattice patterns and bands.
            // Reject gaps and the hidden hemisphere with bounded retries.
            for(let attempt=0;attempt<PARTICLE_PLACEMENT_ATTEMPTS;attempt++){
                arrow.x=Math.random();arrow.y=Math.random();
                if(updateVelocity(arrow))return;
            }
        };
        // Stagger the bounded source sampling; draw every actual map frame.
        for(let i=0;i<(moved?this.arrows.length:Math.ceil(this.arrows.length/8));i++){
            const arrow=this.arrows[this.cursor++%this.arrows.length];
            if(!updateVelocity(arrow))respawn(arrow,moved?Math.random():0);
        }
        if(paused&&!moved&&this.frames>1)return;
        this.paints++;
        ctx.save();ctx.globalAlpha=1;ctx.globalCompositeOperation='destination-in';ctx.fillStyle=`rgba(0,0,0,${Math.exp(-dt/1.25)})`;
        ctx.fillRect(0,0,canvas.width,canvas.height);ctx.restore();
        const dpr=canvas.width/canvas.getBoundingClientRect().width;
        for(const arrow of this.arrows){
            arrow.age+=dt/PARTICLE_LIFETIME_SECONDS;
            if(arrow.age>1||arrow.x<0||arrow.x>1||arrow.y<0||arrow.y>1)respawn(arrow);
            if(!arrow.valid)continue;
            const previousX=arrow.x*view.width,previousY=arrow.y*view.height;
            arrow.x+=arrow.dx*dt*dpr/view.width;arrow.y+=arrow.dy*dt*dpr/view.height;
            const p=geographic(arrow.x,arrow.y);
            if(!visible(p)||!sampleWind(this.field,nativePosition(this.field.metadata.source_crs,p))){arrow.valid=false;continue;}
            const x=arrow.x*view.width,y=arrow.y*view.height,length=Math.hypot(arrow.dx,arrow.dy);
            const dx=arrow.dx/length,dy=arrow.dy/length;
            ctx.globalAlpha=Math.min(1,arrow.age*5,(1-arrow.age)*5)*.65;
            // Particles have no arrowheads; motion and fading trails show airflow.
            ctx.beginPath();ctx.moveTo(dt?previousX:x-dx*3*dpr,dt?previousY:y-dy*3*dpr);ctx.lineTo(x,y);
            ctx.lineCap='round';ctx.strokeStyle='#eef6ff';ctx.lineWidth=.65*dpr;ctx.stroke();
        }
        ctx.globalAlpha=1;
    }
    evidence(){
        const grid=this.field.metadata.grid,[ny,nx]=grid.shape_yx,[w,s]=grid.outer_cell_edges_wsen,[dx,dy]=grid.spacing_degrees_xy;
        const vectors=[.25,.5,.75].flatMap(fx=>[.3,.7].map(fy=>{
            const column=Math.floor(nx*fx),row=Math.floor(ny*fy),xy=[w+(column+.5)*dx,s+(row+.5)*dy];
            const geographic=nativePosition(this.field.metadata.source_crs,xy,true);
            const earth=earthWind(this.field,xy,geographic,p=>nativePosition(this.field.metadata.source_crs,p,true));
            return {row,column,xy,geographic,components:sampleWind(this.field,xy),
                earth,display_visible:this.display?.visible(geographic),
                screen:earth&&this.display?.visible(geographic)?screenVelocity(geographic,earth,this.display.projection):undefined};
        }));
        return {style:'particles-with-trails',particle_lifetime_seconds:PARTICLE_LIFETIME_SECONDS,placement_attempts:PARTICLE_PLACEMENT_ATTEMPTS,trail_decay_seconds:1.25,frames:this.frames,paints:this.paints,view_changes:this.viewChanges,arrows:this.arrows.length,visible:this.arrows.filter(a=>a.valid).length,vectors,
            identity:this.field.metadata.identity,display_mode:this.display?.mode,display_center:this.display?.center,
            orientation:this.field.metadata.uv_relative_to_grid?'grid':'geographic',scope:'U/V directions; display-speed animation, not forecast trajectories'};
    }
    remove(){this.canvas?.remove();this.canvas=undefined;this.arrows=[];this.display=undefined;this.field={...this.field,blocks:[],wind:undefined};}
}
