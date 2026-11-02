import '/vendor/proj4.js';
import {NativeContours} from '/build/contour-grid.js';
import {screenProjector,projectedPieces,lineLength} from '/build/contour-geometry.js';
import {gaussianSurface,contourSurface} from './surface.js';

let configuration,grid,started;
self.onmessage=({data})=>{
    try{
        if(data.type==='start'){
            configuration=data;started=performance.now();
            const [height,width]=data.metadata.grid.shape_yx;
            if(width*height>2*1024**2)throw Error('Слишком большая сетка для сглаживания в прототипе');
            grid={width,height,values:new Float32Array(width*height),valid:new Uint8Array(width*height)};
            self.postMessage({type:'block',index:0});return;
        }
        if(data.type!=='block')return;
        const {metadata,profile,view,count}=configuration,columns=metadata.columns[1]+1;
        const values=new Float32Array(data.buffer,0,258*258),valid=new Uint8Array(data.buffer,258*258*4);
        const x0=data.index%columns*256,y0=Math.floor(data.index/columns)*256;
        for(let y=0;y<Math.min(256,grid.height-y0);y++)for(let x=0;x<Math.min(256,grid.width-x0);x++){
            const a=(y+1)*258+x+1,b=(y0+y)*grid.width+x0+x;grid.values[b]=values[a];grid.valid[b]=valid[a];
        }
        if(data.index+1<count){self.postMessage({type:'block',index:data.index+1});return;}
        const begin=performance.now();grid=gaussianSurface(grid);
        const surface=contourSurface(metadata,grid),project=screenProjector(surface.metadata,view),curves=[];
        const filterMs=performance.now()-begin;let bytes=0,low=Infinity,high=-Infinity;
        for(let i=0;i<grid.values.length;i++)if(grid.valid[i]){low=Math.min(low,grid.values[i]);high=Math.max(high,grid.values[i]);}
        const first=Math.ceil((low*profile.factor+profile.offset)/profile.step),last=Math.floor((high*profile.factor+profile.offset)/profile.step);
        // Bound both arithmetic and graph growth independently of colour scale metadata.
        if(last-first>10000)throw Error('Слишком много уровней сглаженных изолиний');
        const summary={cells:0,segments:0,paths:0,peak_working_bytes:0,numeric_samples:[],surface:{method:'gaussian-1.2-contiguous-mask + positive cubic B-spline',subdivision:surface.subdivision,shape_yx:surface.metadata.grid.shape_yx,filter_ms:filterMs,postprocess:'none; Float64 screen coordinates'}};
        for(let start=first;start<=last;start+=8){
            const engine=new NativeContours(surface.metadata,profile,(level,native)=>{
                for(const line of projectedPieces(native,project,view)){
                    if(lineLength(line)<60)continue;
                    const points=Float64Array.from(line);bytes+=points.byteLength+64;
                    if(bytes>4*1024**2-8192)throw Error('Превышен бюджет геометрии изолиний');
                    curves.push({level,points,quantum:1,offset:0});
                }
            },{maxBytes:8*1024**2,levels:[start,Math.min(last,start+7)]});
            for(let i=0;i<surface.count;i++)engine.addBlock(i,surface.block(i));
            const stats=engine.finish();for(const key of ['cells','segments','paths'])summary[key]+=stats[key];
            summary.peak_working_bytes=Math.max(summary.peak_working_bytes,stats.peak_working_bytes+grid.values.byteLength+grid.valid.byteLength);
        }
        self.postMessage({type:'result',curves,bytes,stats:summary,elapsed_ms:performance.now()-started},curves.map(c=>c.points.buffer));
        configuration=undefined;grid=undefined;
    }catch(error){self.postMessage({type:'error',message:error instanceof Error?error.message:'Не удалось сгладить поверхность'});self.close();}
};
