// Local geographic context shares the weather layer's projected plane.
// Geographic clipping precedes projection; forecast values remain on WebGL2.
import {laeaRfId,laeaRq,laeaD} from './laea-rf.js';
import {clippedLand} from './geometry.js';
export class LocalContext {
    constructor(map,coverage,mode) {
        this.water='#314d5b';this.landColor='#52615e';
        this.map=map;this.coverage=coverage;this.mode=mode;
        this.canvas=document.createElement('canvas');
        Object.assign(this.canvas.style,{position:'absolute',inset:'0',pointerEvents:'none',zIndex:'0'});
        this.canvas.dataset.role='local-basemap';
        map.getContainer().prepend(this.canvas);
        Object.assign(map.getCanvasContainer().style,{position:'absolute',inset:'0',zIndex:'1'});
        this.land=mode==='orthographic'?{type:'MultiPolygon',coordinates:window.land}:clippedLand(mode==='laea-rf'?[90,60]:[90,90],mode==='laea-rf'?179.9999:45);
        this.projection=d3.geoOrthographic().clipAngle(90).precision(.5);
        this.laea=proj4('EPSG:4326',mode==='laea-rf'?laeaRfId:'EPSG:3576');
        this.context=this.canvas.getContext('2d');
        this.path=d3.geoPath(this.projection,this.context);
    }
    render(view,center) {
        this.view=view;
        const canvas=this.canvas,ctx=this.context;
        const key=JSON.stringify([view,center]);
        if(key===this.last)return;this.last=key;
        if(canvas.width!==view.width)canvas.width=view.width;
        if(canvas.height!==view.height)canvas.height=view.height;
        if(this.mode==='orthographic')this.projection.rotate([-center[0],-center[1]]).translate(view.origin).scale(6378137*view.scale);
        else{
            const laea=this.laea;
            this.projection=d3.geoTransform({point(lon,lat){const p=laea.forward([lon,lat]);
                this.stream.point(view.origin[0]+p[0]*view.scale,view.origin[1]-p[1]*view.scale);}});
            this.path=d3.geoPath(this.projection,ctx);
        }
        canvas.style.width=this.map.getContainer().clientWidth+'px';
        canvas.style.height=this.map.getContainer().clientHeight+'px';
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle='#293f4c';ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.beginPath();
        if(this.mode==='orthographic')this.path({type:'Sphere'});
        else if(this.mode==='laea-rf')ctx.ellipse(view.origin[0],view.origin[1],2*laeaRq*laeaD*view.scale,2*laeaRq/laeaD*view.scale,0,0,Math.PI*2);
        else ctx.arc(view.origin[0],view.origin[1],Math.abs(this.laea.forward([90,45])[1])*view.scale,0,Math.PI*2);
        ctx.fillStyle=this.water;ctx.fill();
        ctx.beginPath();this.path(this.land);ctx.fillStyle=this.landColor??'#52615e';ctx.fill();
        ctx.beginPath();this.path(this.coverage);ctx.strokeStyle='#ffffff';
        ctx.lineWidth=1.5*canvas.width/this.map.getContainer().clientWidth;ctx.stroke();
    }
    project(point){
        if(this.mode==='orthographic')return this.projection(point);
        const p=this.laea.forward(point),g=this.view;
        return [g.origin[0]+p[0]*g.scale,g.origin[1]-p[1]*g.scale];
    }
    remove(){this.canvas.remove();}
}
