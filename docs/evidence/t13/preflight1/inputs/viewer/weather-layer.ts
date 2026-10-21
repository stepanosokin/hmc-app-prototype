import {NativeLayer} from './native-layer.js';
import type {FieldData} from './field.js';
import {OrthographicContext} from './orthographic-context.js';

/** MapLibre custom layer over the accepted one-pass native-cell GPU kernel. */
export class WeatherLayer extends NativeLayer {
    alternatePalette=false;
    context: OrthographicContext | undefined;
    declare uploadTimings: {index:number;decode_ms:number;upload_submit_ms:number}[] | undefined;
    constructor(data: FieldData,mode: string,projection: unknown,center: number[]){
        super(data.blocks,mode,projection,data.metadata,center);
    }
    onAdd(map: any,gl: WebGL2RenderingContext){
        if(!(gl instanceof WebGL2RenderingContext)||
            !gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT)?.precision)
            throw Error('Требуется WebGL 2 с высокой точностью шейдеров.');
        super.onAdd(map,gl);
    }
    setPalette(alternate: boolean){this.alternatePalette=alternate;this.map?.triggerRepaint();}
}
