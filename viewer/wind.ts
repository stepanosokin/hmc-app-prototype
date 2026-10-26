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
    if(!field.metadata.uv_relative_to_grid)return {east:wind.u,north:wind.v};
    const step=(field.metadata.source_crs?.template??0)<2?1e-5:1;
    const axis=(x:number,y:number)=>{
        const p=inverse([x,y]),east=(((p[0]-geographic[0]+540)%360)-180)*Math.cos(geographic[1]*Math.PI/180),north=p[1]-geographic[1];
        const length=Math.hypot(east,north);return length>1e-12?[east/length,north/length]:undefined;
    };
    const x=axis(xy[0]+step,xy[1]),y=axis(xy[0],xy[1]+step);if(!x||!y)return;
    return {east:x[0]*wind.u+y[0]*wind.v,north:x[1]*wind.u+y[1]*wind.v};
}

interface Geometry {width:number;height:number;origin:number[];scale:number}
interface Arrow {x:number;y:number;dx:number;dy:number;valid:boolean;age:number}
type WindProjection={forward:(xy:number[])=>number[];inverse:(xy:number[])=>number[]};

function screenVelocity(p:number[],wind:{east:number;north:number},projection:WindProjection){
    const speed=Math.hypot(wind.east,wind.north);
    if(speed<.05||Math.abs(p[1])>89.9)return;
    const start=projection.forward(p),end=projection.forward([p[0]+wind.east*.001/Math.cos(p[1]*Math.PI/180),p[1]+wind.north*.001]);
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
    private field:FieldData;
    private display:{projection:WindProjection;center:number[];mode:string;visible:(p:number[])=>boolean}|undefined;
    constructor(field:FieldData){this.field=field;}
    attach(container:HTMLElement){
        this.canvas=document.createElement('canvas');this.canvas.className='windArrows';
        this.canvas.setAttribute('aria-hidden','true');
        Object.assign(this.canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});
        container.append(this.canvas);
        this.arrows=Array.from({length:192},(_,i)=>({x:((i*73)%193)/193,y:((i*107)%197)/197,dx:0,dy:0,valid:false,age:i/192}));
    }
    bytes(width:number,height:number){return (this.field.wind?.blocks.reduce((n,b)=>n+b.byteLength,0)??0)+width*height*4+192*64;}
    clear(){this.canvas?.getContext('2d')?.clearRect(0,0,this.canvas.width,this.canvas.height);this.last=0;}
    draw(view:Geometry,projection:WindProjection,center:number[],mode:string){
        const canvas=this.canvas;if(!canvas)return;
        if(canvas.width!==view.width||canvas.height!==view.height){canvas.width=view.width;canvas.height=view.height;}
        const ctx=canvas.getContext('2d');if(!ctx)return;
        const now=performance.now(),dt=this.last?Math.min(.05,(now-this.last)/1000):0;this.last=now;this.frames++;
        const geographic=(x:number,y:number)=>projection.inverse([(x*view.width-view.origin[0])/view.scale,(view.origin[1]-y*view.height)/view.scale]);
        const visible=(p:number[])=>{
            if(!p.every(Number.isFinite)||Math.abs(p[1])>90||mode==='EPSG:3576'&&p[1]<45)return false;
            if(mode!=='hmc:orthographic')return true;
            const rad=Math.PI/180;
            return Math.sin(p[1]*rad)*Math.sin(center[1]*rad)+Math.cos(p[1]*rad)*Math.cos(center[1]*rad)*Math.cos((p[0]-center[0])*rad)>0;
        };
        this.display={projection,center:[...center],mode,visible};
        // Stagger the bounded source sampling; draw every actual map frame.
        for(let i=0;i<24;i++){
            const arrow=this.arrows[this.cursor++%this.arrows.length],p=geographic(arrow.x,arrow.y);arrow.valid=false;
            if(!visible(p))continue;
            const xy=nativePosition(this.field.metadata.source_crs,p);
            const wind=earthWind(this.field,xy,p,q=>nativePosition(this.field.metadata.source_crs,q,true));
            if(!wind)continue;
            const velocity=screenVelocity(p,wind,projection);if(!velocity)continue;
            arrow.dx=velocity.dx;arrow.dy=velocity.dy;arrow.valid=true;
        }
        ctx.clearRect(0,0,canvas.width,canvas.height);
        const dpr=canvas.width/canvas.getBoundingClientRect().width;
        for(const arrow of this.arrows){
            arrow.age+=dt*.3;
            if(arrow.age>1||arrow.x<0||arrow.x>1||arrow.y<0||arrow.y>1){arrow.x=(arrow.x+.381966)%1;arrow.y=(arrow.y+.618034)%1;arrow.age=0;arrow.valid=false;}
            if(!arrow.valid)continue;
            arrow.x+=arrow.dx*dt*dpr/view.width;arrow.y+=arrow.dy*dt*dpr/view.height;
            const p=geographic(arrow.x,arrow.y);
            if(!visible(p)||!sampleWind(this.field,nativePosition(this.field.metadata.source_crs,p)))continue;
            const x=arrow.x*view.width,y=arrow.y*view.height,length=Math.hypot(arrow.dx,arrow.dy);
            const dx=arrow.dx/length,dy=arrow.dy/length;
            ctx.globalAlpha=Math.min(1,arrow.age*5,(1-arrow.age)*5)*.9;
            ctx.beginPath();ctx.moveTo(x-dx*10*dpr,y-dy*10*dpr);ctx.lineTo(x,y);
            ctx.moveTo(x-dx*5*dpr-dy*3*dpr,y-dy*5*dpr+dx*3*dpr);ctx.lineTo(x,y);
            ctx.lineTo(x-dx*5*dpr+dy*3*dpr,y-dy*5*dpr-dx*3*dpr);
            ctx.strokeStyle='#243947';ctx.lineWidth=3*dpr;ctx.stroke();ctx.strokeStyle='#ffffff';ctx.lineWidth=1.3*dpr;ctx.stroke();
        }
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
        return {frames:this.frames,arrows:this.arrows.length,visible:this.arrows.filter(a=>a.valid).length,vectors,
            identity:this.field.metadata.identity,display_mode:this.display?.mode,display_center:this.display?.center,
            orientation:this.field.metadata.uv_relative_to_grid?'grid':'geographic',scope:'U/V directions; display-speed animation, not forecast trajectories'};
    }
    remove(){this.canvas?.remove();this.canvas=undefined;this.arrows=[];this.display=undefined;this.field={...this.field,blocks:[],wind:undefined};}
}
