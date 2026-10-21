import { NativeLayer } from './native-layer.js';
/** MapLibre custom layer over the accepted one-pass native-cell GPU kernel. */
export class WeatherLayer extends NativeLayer {
    alternatePalette = false;
    context;
    pendingUploads = [];
    uploadFrame = 0;
    uploaded = 0;
    constructor(data, mode, projection, center) {
        super(data.blocks, mode, projection, data.metadata, center);
        Object.assign(this.cacheIdentity, { encoding: data.metadata.encoding, units: data.metadata.units, stored_size: data.metadata.stored_size });
    }
    onAdd(map, gl) {
        if (!(gl instanceof WebGL2RenderingContext) ||
            (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ?? 0) < 23)
            throw Error('Требуется WebGL 2 с высокой точностью шейдеров.');
        super.onAdd(map, gl);
        this.ready = false;
        const upload = () => {
            this.uploadFrame = 0;
            const next = this.pendingUploads.shift();
            if (!next)
                return;
            try {
                super.uploadBlock(next.index, next.bytes);
                this.ready = ++this.uploaded === 18;
                if (this.ready)
                    map.triggerRepaint();
                else
                    this.uploadFrame = requestAnimationFrame(upload);
            }
            catch (error) {
                this.ready = false;
                this.pendingUploads = [];
                map.fire('error', { error });
            }
        };
        this.uploadFrame = requestAnimationFrame(upload);
    }
    // Yield between real decode/upload operations so selection changes can retire
    // this layer before any further texture writes. Never render a partial field.
    uploadBlock(index, bytes) { this.pendingUploads.push({ index, bytes }); }
    onRemove(map, gl) {
        cancelAnimationFrame(this.uploadFrame);
        this.uploadFrame = 0;
        this.pendingUploads = [];
        this.ready = false;
        this.blocks = [];
        super.onRemove(map, gl);
    }
    setPalette(alternate) { this.alternatePalette = alternate; this.map?.triggerRepaint(); }
}
