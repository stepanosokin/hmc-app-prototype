import { NativeLayer } from './native-layer.js';
/** MapLibre custom layer over the accepted one-pass native-cell GPU kernel. */
export class WeatherLayer extends NativeLayer {
    alternatePalette = false;
    context;
    constructor(data, mode, projection, center) {
        super(data.blocks, mode, projection, data.metadata, center);
    }
    onAdd(map, gl) {
        if (!(gl instanceof WebGL2RenderingContext) ||
            (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ?? 0) < 23)
            throw Error('Требуется WebGL 2 с высокой точностью шейдеров.');
        super.onAdd(map, gl);
    }
    setPalette(alternate) { this.alternatePalette = alternate; this.map?.triggerRepaint(); }
}
