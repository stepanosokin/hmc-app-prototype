import coastline from './coastline-data.js';
import {clippedLine} from './geometry.js';

/** Geographic reference above the raster and below weather annotations. */
export class CoastlineOverlay {
    constructor(admit,fail){
        this.admit=admit;
        this.canvas=document.createElement('canvas');
        this.canvas.className='coastline';this.canvas.setAttribute('aria-hidden','true');
        this.frame=()=>{try{this.render();}catch(error){this.canvas.width=0;this.canvas.height=0;fail(error);}};
    }
    mount(map,host){
        this.unmount();this.map=map;this.host=host;
        const mode=host().mode;
        this.lines=mode==='EPSG:3576'||mode==='hmc:laea-rf'?{
            type:'MultiLineString',coordinates:coastline.coordinates.flatMap(line=>
                clippedLine(line,mode==='EPSG:3576'?[90,90]:[90,60],mode==='EPSG:3576'?45:179.9999).geometry.coordinates)
        }:coastline;
        map.getCanvasContainer().append(this.canvas);map.on('render',this.frame);
    }
    unmount(){
        this.map?.off('render',this.frame);this.map=undefined;this.host=undefined;
        this.canvas.remove();this.canvas.width=0;this.canvas.height=0;this.last='';
    }
    bytes(){return this.canvas.width*this.canvas.height*4;}
    theme(light){this.light=light;this.last='';this.map?.triggerRepaint();}
    render(){
        const host=this.host?.();if(!host)return;
        const g=host.geometry(),width=this.map.getContainer().clientWidth,height=this.map.getContainer().clientHeight;
        if(!width||!height)return;
        const dpr=g.width/width,origin=g.origin.map(v=>v/dpr),scale=g.scale/dpr;
        const key=JSON.stringify([origin,scale,width,height,host.center,this.light]);
        if(this.last===key)return;this.last=key;
        this.admit(width*height*4-this.bytes());
        if(this.canvas.width!==width)this.canvas.width=width;
        if(this.canvas.height!==height)this.canvas.height=height;
        const ctx=this.canvas.getContext('2d');ctx.clearRect(0,0,width,height);
        let projection;
        if(host.mode==='hmc:orthographic')projection=d3.geoOrthographic().rotate([-host.center[0],-host.center[1]])
            .translate(origin).scale(6378137*scale).clipAngle(90).precision(.5);
        else if(host.mode==='mercator')projection=d3.geoMercator().translate(origin).scale(6378137*scale).precision(.5);
        else projection=d3.geoTransform({point(lon,lat){
            const p=host.projection.forward([lon,lat]);
            this.stream.point(origin[0]+p[0]*scale,origin[1]-p[1]*scale);
        }});
        const path=d3.geoPath(projection,ctx);
        ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();
        if(host.mode==='mercator'){
            // Repeat geographic lines with the basemap's wrapped worlds.
            const world=2*Math.PI*6378137*scale;
            const first=Math.ceil((-origin[0]-world/2)/world),last=Math.floor((width-origin[0]+world/2)/world);
            for(let copy=first;copy<=last;copy++){
                projection.translate([origin[0]+copy*world,origin[1]]);path(this.lines);
            }
        }else path(this.lines);
        ctx.strokeStyle=this.light?'rgba(255,255,255,.85)':'rgba(255,255,255,.65)';ctx.lineWidth=2.4;ctx.stroke();
        ctx.strokeStyle='#343e43';ctx.lineWidth=1;ctx.stroke();
    }
}
