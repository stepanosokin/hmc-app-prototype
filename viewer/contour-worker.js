import '/vendor/proj4.js';
import {NativeContours,nativeBlockRange} from './contour-grid.js';
import {screenProjector,projectedPieces,lineLength,simplifyLine,smoothLine,packScreenLine,projectedNativeWindow} from './contour-geometry.js';

let engine,configuration,curves,bytes,started,project,batches,batch,summary,scanning,low,high,scanned;
function beginBatch(){
    const data=configuration;
    engine=new NativeContours(data.metadata,data.profile,emit,{maxBytes:8*1024**2,window:data.nativeWindow,levels:batches[batch]});
    self.postMessage({type:'block',index:0});
}
function emit(level,native){
    for(const original of projectedPieces(native,project,configuration.view)){
        if(lineLength(original)<60)continue;
        const precise=smoothLine(simplifyLine(original)),packed=packScreenLine(precise,configuration.view.width,configuration.view.height),{points}=packed;
        bytes+=points.byteLength+64;
        if(bytes>4*1024**2-8192)throw Error('Превышен бюджет геометрии изолиний');
        curves.push({level,...packed});
    }
}
self.onmessage=({data})=>{
    try{
        if(data.type==='start'){
            configuration=data;curves=[];bytes=0;started=performance.now();
            project=screenProjector(data.metadata,data.view);
            const [ny,nx]=data.metadata.grid.shape_yx;
            const full=[0,0,nx-2,ny-2],fullView=data.nativeWindow?.every((v,i)=>v===full[i]);
            data.nativeWindow=fullView?full:projectedNativeWindow(data.metadata,data.view,project);
            // Determine levels from the numeric mask and native values. A colour
            // range may be clipped, fixed or absent and is never a numeric bound.
            scanning=true;low=Infinity;high=-Infinity;scanned=0;
            self.postMessage({type:'block',index:0});
        }else if(data.type==='block'){
            if(scanning){
                const range=nativeBlockRange(configuration.metadata,data.index,data.buffer,configuration.nativeWindow);
                low=Math.min(low,range.low);high=Math.max(high,range.high);scanned+=range.count;
                if(data.index+1<configuration.count){self.postMessage({type:'block',index:data.index+1});return;}
                const {factor,offset,step}=configuration.profile;
                const first=Math.ceil((low*factor+offset)/step),last=Math.floor((high*factor+offset)/step);
                batches=[];for(let level=first;level<=last;level+=8)batches.push([level,Math.min(last,level+7)]);
                if(!batches.length)batches.push([0,-1]);batch=0;scanning=false;
                summary={cells:0,segments:0,paths:0,peak_working_bytes:0,numeric_samples:[],level_batches:batches.length,native_value_range:scanned?[low,high]:null,scanned_nodes:scanned};
                beginBatch();return;
            }
            engine.addBlock(data.index,data.buffer);
            if(data.index+1<configuration.count)self.postMessage({type:'block',index:data.index+1});
            else{
                const part=engine.finish();
                for(const key of ['cells','segments','paths'])summary[key]+=part[key];
                summary.peak_working_bytes=Math.max(summary.peak_working_bytes,part.peak_working_bytes);
                summary.numeric_samples.push(...part.numeric_samples.slice(0,Math.max(0,16-summary.numeric_samples.length)));
                if(++batch<batches.length){beginBatch();return;}
                const stats=summary;stats.native_window=configuration.nativeWindow;
                for(const sample of stats.numeric_samples)sample.screen=sample.intersections.map(xy=>project(...xy)??null);
                self.postMessage({type:'result',curves,bytes,stats,elapsed_ms:performance.now()-started},curves.map(c=>c.points.buffer));
                engine=undefined;curves=undefined;configuration=undefined;
            }
        }
    }catch(error){self.postMessage({type:'error',message:error instanceof Error?error.message:'Не удалось построить изолинии'});self.close();}
};
