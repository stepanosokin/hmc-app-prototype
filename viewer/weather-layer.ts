import {NativeLayer} from './native-layer.js';
import type {FieldData} from './field.js';
import {LocalContext} from './local-context.js';
import {WindArrows} from './wind.js';
import {windSpeed} from './wind-speed.js';

/** MapLibre custom layer over the accepted one-pass native-cell GPU kernel. */
export class WeatherLayer extends NativeLayer {
    staged=false;
    fieldVisible=true;
    failure:unknown;
    alternatePalette=false;
    context: LocalContext | undefined;
    declare uploadTimings: {index:number;decode_ms:number;upload_submit_ms:number}[] | undefined;
    private pendingUploads: {index:number;bytes:ArrayBuffer}[]=[];
    private uploadFrame=0;
    private uploaded=0;
    private retainedWindBytes=0;
    wind:WindArrows|undefined;
    private hideWind=()=>this.wind?.clear();
    constructor(data: FieldData,mode: string,projection: unknown,center: number[]){
        const scalar=windSpeed(data);
        super(scalar.blocks,mode,projection,scalar.metadata,center);
        if(data.wind)this.retainedWindBytes=data.blocks.reduce((n,b)=>n+b.byteLength,0)+data.wind.blocks.reduce((n,b)=>n+b.byteLength,0);
        Object.assign(this.cacheIdentity,{encoding:data.metadata.encoding,units:data.metadata.units,stored_size:data.metadata.stored_size});
    }
    onAdd(map: any,gl: WebGL2RenderingContext){
        if(!(gl instanceof WebGL2RenderingContext)||
            (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT)?.precision??0)<23)
            throw Error('Требуется WebGL 2 с высокой точностью шейдеров.');
        if(this.wind){
            this.map=map;this.gl=gl;this.checkBudget();
            this.wind.attach(map.getCanvasContainer());
            map.getCanvas().addEventListener('webglcontextlost',this.hideWind);
            this.cacheIdentity.renderer_engine='native-uv-canvas-arrows/1';
            this.ready=true;map.triggerRepaint();return;
        }
        try{super.onAdd(map,gl);}catch(error){this.failure=error;this.onRemove(map,gl);throw error;}
        map.getCanvas().addEventListener('webglcontextlost',this.hideWind);
        this.ready=false;
        const upload=()=>{
            this.uploadFrame=0;
            const next=this.pendingUploads.shift();
            if(!next)return;
            try{
                super.uploadBlock(next.index,next.bytes);
                this.ready=++this.uploaded===this.blockCount;
                if(this.ready)map.triggerRepaint();
                else this.uploadFrame=requestAnimationFrame(upload);
            }catch(error){this.failure=error;this.ready=false;this.pendingUploads=[];map.fire('error',{error});}
        };
        this.uploadFrame=requestAnimationFrame(upload);
    }
    // Yield between real decode/upload operations so selection changes can retire
    // this layer before any further texture writes. Never render a partial field.
    uploadBlock(index:number,bytes:ArrayBuffer){this.pendingUploads.push({index,bytes});}
    render(gl:WebGL2RenderingContext){
        if(this.staged)return;
        if(this.fieldVisible&&this.wind){
            this.checkBudget();
            this.context?.render(this.geometry(),this.center);
            this.wind.draw(this.geometry(),this.projection,this.center,this.mode);
            if(!document.hidden)this.map.triggerRepaint();
        }
        else if(this.fieldVisible)super.render(gl);
        else{this.wind?.clear();this.context?.render(this.geometry(),this.center);}
    }
    checkBudget(){
        const canvas=this.map.getCanvas();
        const base=this.wind?this.blocks.reduce((n:number,b:ArrayBuffer)=>n+b.byteLength,0)+2*1024**2+canvas.width*canvas.height*(this.context?28:24):super.checkBudget();
        const total=base+(this.wind?.bytes(canvas.width,canvas.height)??0)+this.retainedWindBytes;
        if(total>128*1024**2)throw Error('Ветер превышает общий бюджет числовых ресурсов.');
        return total;
    }
    async prepared(signal:AbortSignal){
        while(!this.ready){
            signal.throwIfAborted();if(this.failure)throw this.failure;
            await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        }
        signal.throwIfAborted();
    }
    onRemove(map:any,gl:WebGL2RenderingContext){
        map.getCanvas().removeEventListener('webglcontextlost',this.hideWind);this.wind?.remove();this.wind=undefined;
        cancelAnimationFrame(this.uploadFrame);this.uploadFrame=0;this.pendingUploads=[];
        this.ready=false;this.blocks=[];
        if(this.program)super.onRemove(map,gl);else this.context?.remove();
    }
    setPalette(alternate: boolean){this.alternatePalette=alternate;this.map?.triggerRepaint();}
}
