import type {FieldData} from './field.js';
import {nativePosition} from './source-crs.js';
import {WindTrails,trailBytes,TRAIL_DECAY_SECONDS,TRAIL_SEGMENTS} from './wind-trails.ts';

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
interface Arrow {x:number;y:number;dx:number;dy:number;valid:boolean;retiring:boolean;fade:number;age:number;trailStart:number;hasTrail:boolean}
type WindProjection={forward:(xy:number[])=>number[];inverse:(xy:number[])=>number[]};

const PARTICLE_LIFETIME_SECONDS=6.8;
const PARTICLE_FADE_FRACTION=.2;
const PARTICLE_PLACEMENT_ATTEMPTS=8;
const particleCount=(width:number,height:number)=>Math.min(8192,Math.max(1,Math.round(width*height/(1440*900)*2400)));
const particleBytes=(count:number)=>count*64+trailBytes(count);
/** Reserve particle histories before allocating them, including a future resize. */
export function windParticleBytes(cssWidth:number,cssHeight:number){return particleBytes(particleCount(cssWidth,cssHeight));}
/** Backing store and retained composited image for the wind canvas. */
export function windCanvasBytes(width:number,height:number){return width*height*8;}

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
    private gl:WebGL2RenderingContext|undefined;
    private trails:WindTrails|undefined;
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
    attach(container:HTMLElement,repaint?:()=>void){
        const canvas=document.createElement('canvas');this.canvas=canvas;canvas.className='windArrows';
        canvas.setAttribute('aria-hidden','true');
        Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});
        canvas.addEventListener('webglcontextlost',event=>{
            if(this.canvas!==canvas)return;
            event.preventDefault();this.trails=undefined;this.viewKey='';this.last=0;
        });
        canvas.addEventListener('webglcontextrestored',()=>{if(this.canvas===canvas)repaint?.();});
        container.append(canvas);
        this.arrows=[];
    }
    bytes(width:number,height:number){
        const css=this.canvas?.getBoundingClientRect();
        const count=Math.max(this.arrows.length,particleCount(css?.width??0,css?.height??0));
        return (this.field.wind?.blocks.reduce((n,b)=>n+b.byteLength,0)??0)+windCanvasBytes(width,height)+particleBytes(count);
    }
    clear(){
        this.trails?.clear();
        for(const arrow of this.arrows){arrow.hasTrail=false;arrow.trailStart=0;}
        this.last=0;
    }
    draw(view:Geometry,projection:WindProjection,center:number[],mode:string,paused=false){
        const canvas=this.canvas;if(!canvas)return false;
        const css=canvas.getBoundingClientRect();
        if(!view.width||!view.height||!css.width||!css.height)return false;
        if(canvas.width!==view.width||canvas.height!==view.height){canvas.width=view.width;canvas.height=view.height;}
        const gl=this.gl??canvas.getContext('webgl2',{antialias:false,depth:false,preserveDrawingBuffer:true});
        if(!gl)throw Error('WebGL 2 недоступен для следов ветра.');
        this.gl=gl;
        if(gl.isContextLost())return false;
        const count=particleCount(css.width,css.height);
        if(count!==this.arrows.length){
            this.trails?.dispose();this.trails=undefined;this.viewKey='';
            this.arrows=Array.from({length:count},()=>({x:Math.random(),y:Math.random(),dx:0,dy:0,valid:false,retiring:false,fade:0,age:Math.random(),trailStart:0,hasTrail:false}));
        }
        const trails=this.trails??=new WindTrails(gl,count,PARTICLE_LIFETIME_SECONDS);
        const key=JSON.stringify([view.width,view.height,view.origin,view.scale,center,mode]);
        const moved=key!==this.viewKey;this.viewKey=key;
        if(moved){
            this.viewChanges++;trails.clear();
            for(const arrow of this.arrows){arrow.valid=false;arrow.retiring=false;arrow.fade=0;arrow.trailStart=0;arrow.hasTrail=false;}
        }
        const now=performance.now(),dt=!paused&&this.last?Math.min(.05,(now-this.last)/1000):0;this.last=now;this.frames++;
        const geographic=(x:number,y:number)=>projection.inverse([(x*view.width-view.origin[0])/view.scale,(view.origin[1]-y*view.height)/view.scale]);
        const visible=(p:number[])=>{
            if(!p.every(Number.isFinite)||Math.abs(p[1])>90||mode==='EPSG:3576'&&p[1]<45)return false;
            if(mode!=='hmc:orthographic')return true;
            const rad=Math.PI/180;
            return Math.sin(p[1]*rad)*Math.sin(center[1]*rad)+Math.cos(p[1]*rad)*Math.cos(center[1]*rad)*Math.cos((p[0]-center[0])*rad)>0;
        };
        this.display={projection,center:[...center],mode,visible};
        if(paused&&!moved&&this.frames>1)return true;
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
            arrow.age=age;arrow.trailStart=trails.frame;arrow.hasTrail=false;arrow.retiring=false;arrow.fade=0;
            // Independent uniform coordinates avoid lattice patterns and bands.
            // Reject gaps and the hidden hemisphere with bounded retries.
            for(let attempt=0;attempt<PARTICLE_PLACEMENT_ATTEMPTS;attempt++){
                arrow.x=Math.random();arrow.y=Math.random();
                if(updateVelocity(arrow))return;
            }
        };
        const retire=(arrow:Arrow)=>{
            arrow.valid=false;arrow.retiring=true;arrow.fade=0;
            // Keep existing pixels in their valid location; fade before reusing history.
        };
        // Stagger the bounded source sampling; draw every actual map frame.
        for(let i=0;i<(moved?this.arrows.length:Math.ceil(this.arrows.length/8));i++){
            const arrow=this.arrows[this.cursor++%this.arrows.length];
            if(arrow.retiring)continue;
            if(!updateVelocity(arrow)){
                if(arrow.hasTrail)retire(arrow);else respawn(arrow,moved?Math.random():0);
            }
        }
        this.paints++;
        trails.begin();
        const dpr=canvas.width/css.width;
        for(let index=0;index<this.arrows.length;index++){
            const arrow=this.arrows[index];
            arrow.age+=dt/PARTICLE_LIFETIME_SECONDS;
            if(arrow.retiring)arrow.fade+=dt/(PARTICLE_LIFETIME_SECONDS*PARTICLE_FADE_FRACTION);
            if(arrow.age>=1||arrow.retiring&&arrow.fade>=1)respawn(arrow);
            if(arrow.valid){
                const previousX=arrow.x*view.width,previousY=arrow.y*view.height;
                arrow.x+=arrow.dx*dt*dpr/view.width;arrow.y+=arrow.dy*dt*dpr/view.height;
                const p=geographic(arrow.x,arrow.y);
                if(arrow.x<0||arrow.x>1||arrow.y<0||arrow.y>1||!visible(p)||!sampleWind(this.field,nativePosition(this.field.metadata.source_crs,p)))retire(arrow);
                else{
                    const x=arrow.x*view.width,y=arrow.y*view.height,length=Math.hypot(arrow.dx,arrow.dy);
                    const dx=arrow.dx/length,dy=arrow.dy/length;
                    trails.segment(index,dt?previousX:x-dx*3*dpr,dt?previousY:y-dy*3*dpr,x,y,arrow.age);
                    arrow.hasTrail=true;
                }
            }
            // Smoothstep reaches zero with zero slope before history is reused.
            const remaining=Math.max(0,Math.min(1,(1-arrow.age)/PARTICLE_FADE_FRACTION,1-arrow.fade));
            const opacity=remaining*remaining*(3-2*remaining);
            trails.particle(index,arrow.age,arrow.hasTrail?opacity:0,arrow.trailStart);
        }
        trails.draw(view.width,view.height,dpr,dt);
        return true;
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
        return {style:'particles-with-trails',particle_lifetime_seconds:PARTICLE_LIFETIME_SECONDS,particle_fade_seconds:PARTICLE_LIFETIME_SECONDS*PARTICLE_FADE_FRACTION,retiring:this.arrows.filter(a=>a.retiring).length,placement_attempts:PARTICLE_PLACEMENT_ATTEMPTS,trail_decay_seconds:TRAIL_DECAY_SECONDS,trail_lifecycle:'particle-owned',trail_segment_limit:TRAIL_SEGMENTS,frames:this.frames,paints:this.paints,view_changes:this.viewChanges,arrows:this.arrows.length,visible:this.arrows.filter(a=>a.valid).length,vectors,
            identity:this.field.metadata.identity,display_mode:this.display?.mode,display_center:this.display?.center,
            orientation:this.field.metadata.uv_relative_to_grid?'grid':'geographic',scope:'U/V directions; display-speed animation, not forecast trajectories'};
    }
    remove(){
        this.trails?.dispose();this.trails=undefined;
        this.gl?.getExtension('WEBGL_lose_context')?.loseContext();this.gl=undefined;
        this.canvas?.remove();this.canvas=undefined;this.arrows=[];this.display=undefined;
        this.field={...this.field,blocks:[],wind:undefined};
    }
}
