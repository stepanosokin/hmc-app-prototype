import {NativeLayer} from './native-layer.js';
import type {FieldData} from './field.js';
import {LocalContext} from './local-context.js';

/** MapLibre custom layer over the accepted one-pass native-cell GPU kernel. */
export class WeatherLayer extends NativeLayer {
    staged=false;
    failure:unknown;
    alternatePalette=false;
    context: LocalContext | undefined;
    declare uploadTimings: {index:number;decode_ms:number;upload_submit_ms:number}[] | undefined;
    private pendingUploads: {index:number;bytes:ArrayBuffer}[]=[];
    private uploadFrame=0;
    private uploaded=0;
    constructor(data: FieldData,mode: string,projection: unknown,center: number[]){
        super(data.blocks,mode,projection,data.metadata,center);
        Object.assign(this.cacheIdentity,{encoding:data.metadata.encoding,units:data.metadata.units,stored_size:data.metadata.stored_size});
    }
    onAdd(map: any,gl: WebGL2RenderingContext){
        if(!(gl instanceof WebGL2RenderingContext)||
            (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT)?.precision??0)<23)
            throw Error('Требуется WebGL 2 с высокой точностью шейдеров.');
        super.onAdd(map,gl);
        this.ready=false;
        const upload=()=>{
            this.uploadFrame=0;
            const next=this.pendingUploads.shift();
            if(!next)return;
            try{
                super.uploadBlock(next.index,next.bytes);
                this.ready=++this.uploaded===18;
                if(this.ready)map.triggerRepaint();
                else this.uploadFrame=requestAnimationFrame(upload);
            }catch(error){this.failure=error;this.ready=false;this.pendingUploads=[];map.fire('error',{error});}
        };
        this.uploadFrame=requestAnimationFrame(upload);
    }
    // Yield between real decode/upload operations so selection changes can retire
    // this layer before any further texture writes. Never render a partial field.
    uploadBlock(index:number,bytes:ArrayBuffer){this.pendingUploads.push({index,bytes});}
    render(gl:WebGL2RenderingContext){if(!this.staged)super.render(gl);}
    async prepared(signal:AbortSignal){
        while(!this.ready){
            signal.throwIfAborted();if(this.failure)throw this.failure;
            await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        }
        signal.throwIfAborted();
    }
    onRemove(map:any,gl:WebGL2RenderingContext){
        cancelAnimationFrame(this.uploadFrame);this.uploadFrame=0;this.pendingUploads=[];
        this.ready=false;this.blocks=[];super.onRemove(map,gl);
    }
    setPalette(alternate: boolean){this.alternatePalette=alternate;this.map?.triggerRepaint();}
}
