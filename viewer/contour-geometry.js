import {nativePosition} from './source-crs.js';
import {laeaRfDefinition} from './laea-rf.js';

export function mapWidthKm(view,inverse){
    let width=0,previous;
    for(let i=0;i<=128;i++){
        const xy=[(view.width*i/128-view.origin[0])/view.scale,(view.origin[1]-view.height/2)/view.scale];
        let geo;
        try{geo=view.mode==='hmc:orthographic'&&Math.hypot(...xy)>6378137?undefined:inverse(xy);}catch{}
        if(!geo?.every(Number.isFinite)||Math.abs(geo[1])>90||view.mode==='EPSG:3576'&&geo[1]<45){previous=undefined;continue;}
        if(previous){
            const r=Math.PI/180,a=previous[1]*r,b=geo[1]*r,dl=(geo[0]-previous[0])*r;
            const q=Math.sin((b-a)/2)**2+Math.cos(a)*Math.cos(b)*Math.sin(dl/2)**2;
            width+=2*6371.0088*Math.asin(Math.sqrt(Math.max(0,Math.min(1,q))));
        }
        previous=geo;
    }
    return width||view.width/Math.abs(view.scale)/1000;
}
export function nativeViewWindow(metadata,view,inverse){
    const [ny,nx]=metadata.grid.shape_yx,[west,south]=metadata.grid.outer_cell_edges_wsen,[dx,dy]=metadata.grid.spacing_degrees_xy;
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    const sample=(x,y)=>{
        try{
            const xy=[(x-view.origin[0])/view.scale,(view.origin[1]-y)/view.scale];
            if(view.mode==='hmc:orthographic'&&Math.hypot(...xy)>6378137)return;
            const geo=inverse(xy);if(!geo?.every(Number.isFinite)||Math.abs(geo[1])>90)return;
            const native=nativePosition(metadata.source_crs,geo),column=(native[0]-west)/dx-.5,row=(native[1]-south)/dy-.5;
            if(!Number.isFinite(column+row))return;
            x0=Math.min(x0,column);x1=Math.max(x1,column);y0=Math.min(y0,row);y1=Math.max(y1,row);
        }catch{}
    };
    for(let row=0;row<=16;row++)for(let col=0;col<=16;col++)sample(view.width*col/16,view.height*row/16);
    for(let i=0;i<=128;i++){sample(view.width*i/128,0);sample(view.width*i/128,view.height);sample(0,view.height*i/128);sample(view.width,view.height*i/128);}
    // Conservative native halo around the inverse viewport, including curved borders.
    // A disconnected/singular view without inverse samples falls back to the full grid.
    if(!Number.isFinite(x0+y0+x1+y1))return [0,0,nx-2,ny-2];
    return [Math.max(0,Math.floor(x0)-64),Math.max(0,Math.floor(y0)-64),Math.min(nx-2,Math.ceil(x1)+64),Math.min(ny-2,Math.ceil(y1)+64)];
}
export function projectedNativeWindow(metadata,view,project){
    const [ny,nx]=metadata.grid.shape_yx,full=[0,0,nx-2,ny-2];
    // Sparse inverse samples cannot bound a disconnected native footprint.
    // Scan every projected cell instead, retaining only two rows of coordinates.
    let previous=new Float64Array(nx*2),current=new Float64Array(nx*2);
    previous.fill(NaN);let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(let row=0;row<ny;row++){
        current.fill(NaN);
        for(let col=0;col<nx;col++){
            const p=project(col,row);if(p){current[col*2]=p[0];current[col*2+1]=p[1];}
            if(!row||!col)continue;
            let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
            for(const [line,index] of [[previous,col-1],[previous,col],[current,col-1],[current,col]]){
                const x=line[index*2],y=line[index*2+1];if(!Number.isFinite(x+y))continue;
                left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
            }
            if(left<=view.width+24&&right>=-24&&top<=view.height+24&&bottom>=-24){
                x0=Math.min(x0,col-1);x1=Math.max(x1,col);y0=Math.min(y0,row-1);y1=Math.max(y1,row);
            }
        }
        [previous,current]=[current,previous];
    }
    // Empty or singular views conservatively retain the full native footprint.
    if(!Number.isFinite(x0+y0+x1+y1))return full;
    return [Math.max(0,x0-64),Math.max(0,y0-64),Math.min(nx-2,x1+64),Math.min(ny-2,y1+64)];
}

export function nativeContourTransform(spec){
    const values=spec?.configuration?.values;
    const sphereZero=spec&&[0,1].includes(spec.template)&&spec.datum_mode==='explicit-geocentric'&&
        spec.semi_major_m===spec.semi_minor_m&&values?.coordinate_height_m===0&&values.geocentric_translation_m.every(v=>v===0);
    if(!spec)return xy=>nativePosition(undefined,xy,true);
    if(!sphereZero)return xy=>nativePosition(spec,xy,true);
    const r=Math.PI/180,pm=spec.prime_meridian_degrees??values.prime_meridian_degrees;
    const pole=spec.template===1?-spec.rotation.south_lat*r:0,lon0=spec.template===1?spec.rotation.south_lon*r:0;
    const sin=Math.sin(pole),cos=Math.cos(pole),angle=spec.template===1?-spec.rotation.angle*r:0;
    return xy=>{
        let lon=xy[0]*r,phi=xy[1]*r;
        if(spec.template===1){const l=lon-angle,p=phi;
            lon=lon0+Math.atan2(Math.cos(p)*Math.sin(l),sin*Math.cos(p)*Math.cos(l)-cos*Math.sin(p));
            phi=Math.asin(Math.max(-1,Math.min(1,sin*Math.sin(p)+cos*Math.cos(p)*Math.cos(l))));}
        lon+=pm*r;
        return [Math.atan2(Math.sin(lon),Math.cos(lon))/r,Math.atan2(Math.sin(phi),(1-.0066943799901413165)*Math.cos(phi))/r];
    };
}

export function screenProjector(metadata,view){
    const definition=view.mode==='hmc:orthographic'?`+proj=ortho +lat_0=${view.center[1]} +lon_0=${view.center[0]} +x_0=0 +y_0=0 +R=6378137 +units=m`:
        view.mode==='hmc:laea-rf'?laeaRfDefinition:'+proj=laea +lat_0=90 +lon_0=90 +x_0=0 +y_0=0 +datum=WGS84 +units=m';
    const operation=view.mode==='mercator'?undefined:proj4('EPSG:4326',definition);
    const geographic=nativeContourTransform(metadata.source_crs);
    const [west,south]=metadata.grid.outer_cell_edges_wsen,[dx,dy]=metadata.grid.spacing_degrees_xy;
    return (x,y)=>{
        const geo=geographic([west+(x+.5)*dx,south+(y+.5)*dy]);
        if(!geo.every(Number.isFinite))return;
        if(view.mode==='EPSG:3576'&&geo[1]<45)return;
        if(view.mode==='hmc:orthographic'){
            const r=Math.PI/180,p=geo[1]*r,c=view.center[1]*r;
            if(Math.sin(p)*Math.sin(c)+Math.cos(p)*Math.cos(c)*Math.cos((geo[0]-view.center[0])*r)<=0)return;
        }
        let xy;
        if(!operation){
            if(Math.abs(geo[1])>=85.05112878)return;
            xy=[6378137*geo[0]*Math.PI/180,6378137*Math.log(Math.tan(Math.PI/4+geo[1]*Math.PI/360))];
        }else xy=operation.forward(geo);
        if(!xy.every(Number.isFinite))return;
        return [view.origin[0]+xy[0]*view.scale,view.origin[1]-xy[1]*view.scale,geo[0]];
    };
}
export function lineLength(points){let n=0;for(let i=2;i<points.length;i+=2)n+=Math.hypot(points[i]-points[i-2],points[i+1]-points[i-1]);return n;}
export function simplifyLine(points,tolerance=.3){
    if(points.length<=4)return points.slice();
    const keep=new Uint8Array(points.length/2),stack=[0,points.length-2];keep[0]=keep[keep.length-1]=1;
    while(stack.length){
        const end=stack.pop(),start=stack.pop(),ax=points[start],ay=points[start+1],vx=points[end]-ax,vy=points[end+1]-ay,vv=vx*vx+vy*vy;
        let best=tolerance*tolerance,at=-1;
        for(let i=start+2;i<end;i+=2){
            const t=vv?Math.max(0,Math.min(1,((points[i]-ax)*vx+(points[i+1]-ay)*vy)/vv)):0;
            const d=(points[i]-ax-t*vx)**2+(points[i+1]-ay-t*vy)**2;
            if(d>best){best=d;at=i;}
        }
        if(at!==-1){keep[at/2]=1;stack.push(start,at,at,end);}
    }
    const out=[];for(let i=0;i<points.length;i+=2)if(keep[i/2])out.push(points[i],points[i+1]);return out;
}
export function smoothLine(points,radius=.6){
    if(points.length<=4)return points.slice();
    const closed=Math.hypot(points[0]-points.at(-2),points[1]-points.at(-1))<1e-8;
    const n=points.length/2-(closed?1:0),out=closed?[]:[points[0],points[1]];
    for(let i=closed?0:1;i<(closed?n:n-1);i++){
        const p=(i+n-1)%n,q=(i+1)%n,x=points[2*i],y=points[2*i+1];
        const ux=points[2*p]-x,uy=points[2*p+1]-y,vx=points[2*q]-x,vy=points[2*q+1]-y;
        const u=Math.hypot(ux,uy),v=Math.hypot(vx,vy);if(!u||!v)continue;
        const a=Math.min(.25,radius/u),b=Math.min(.25,radius/v);
        for(const t of [0,.5,1])out.push(x+(1-t)**2*a*ux+t*t*b*vx,y+(1-t)**2*a*uy+t*t*b*vy);
    }
    if(closed)out.push(out[0],out[1]);else out.push(points.at(-2),points.at(-1));
    return out;
}
export function packScreenLine(precise,width,height){
    const quantum=Math.max(1/64,2**Math.ceil(Math.log2((Math.max(width,height)+48)/65535)));
    const packed=quantum<=.125,offset=packed?-24:0;
    const points=packed?new Uint16Array(precise.length):new Float32Array(precise.length),scale=packed?quantum:1;
    for(let i=0;i<precise.length;i++){
        const value=(precise[i]-offset)/scale;
        if(packed&&(value<-.001||value>65535.001))throw Error('Координаты изолинии вне экранного окна');
        points[i]=packed?Math.round(value):value;
    }
    for(let i=0;i<points.length;i+=2)if(Math.hypot(points[i]*scale+offset-precise[i],points[i+1]*scale+offset-precise[i+1])>.09)
        throw Error('Превышена точность экранной геометрии изолиний');
    return {points,quantum:scale,offset};
}
export function projectedPieces(native,project,view){
    const pieces=[];let current=[],previous;
    const add=p=>{
        if(!p||view.mode==='mercator'&&previous&&Math.abs(p[2]-previous[2])>180){if(current.length>=4)pieces.push(current);current=[];previous=undefined;}
        if(p){current.push(p[0],p[1]);previous=p;}
    };
    // Subdivide native edges, never join across the horizon, CRS discontinuity or NoData component.
    let previousProjection;
    for(let i=0;i<native.length;i+=2){
        const x=native[i],y=native[i+1];
        const projection=project(x,y);
        if(i){
            const a=previousProjection,b=projection;
            const count=a&&b?Math.min(256,Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/8))):8;
            for(let j=1;j<count;j++)add(project(native[i-2]+(x-native[i-2])*j/count,native[i-1]+(y-native[i-1])*j/count));
        }
        add(projection);previousProjection=projection;
    }
    if(current.length>=4)pieces.push(current);
    return pieces.flatMap(p=>clipScreenLine(p,view.width,view.height));
}
export function clipScreenLine(points,width,height,margin=24){
    const out=[];let part=[];
    const flush=()=>{if(part.length>=4)out.push(part);part=[];};
    for(let i=2;i<points.length;i+=2){
        const x=points[i-2],y=points[i-1],dx=points[i]-x,dy=points[i+1]-y;
        let low=0,high=1,valid=true;
        for(const [p,q] of [[-dx,x+margin],[dx,width+margin-x],[-dy,y+margin],[dy,height+margin-y]]){
            if(p===0){if(q<0)valid=false;continue;}
            const t=q/p;if(p<0)low=Math.max(low,t);else high=Math.min(high,t);
        }
        if(!valid||low>high){flush();continue;}
        const ax=x+low*dx,ay=y+low*dy,bx=x+high*dx,by=y+high*dy;
        if(part.length&&Math.hypot(part.at(-2)-ax,part.at(-1)-ay)>1e-7)flush();
        if(!part.length)part.push(ax,ay);part.push(bx,by);
        if(high<1)flush();
    }
    flush();return out;
}
