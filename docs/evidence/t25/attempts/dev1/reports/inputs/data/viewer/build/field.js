export class PublicationExpired extends Error {
    constructor() { super('Публикация истекла. Проверьте обновления.'); }
}
export function localURL(url) {
    if (!/^\/(?:api\/v1\/|ogc\/collections\/)/.test(url) || url.includes('..') || url.includes('\\') || url.includes('#'))
        throw Error('Недопустимый адрес опубликованных данных.');
    return url;
}
async function response(url, signal) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const result = await fetch(localURL(url), { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), cache: 'no-store' });
        if (result.status === 429 && attempt < 2) {
            await new Promise((resolve, reject) => {
                const abort = () => { clearTimeout(timer); reject(signal.reason); };
                const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000);
                signal.addEventListener('abort', abort, { once: true });
            });
            continue;
        }
        if (result.status === 410)
            throw new PublicationExpired();
        if (!result.ok)
            throw Error(result.status === 404 ? 'Выбранная публикация недоступна.' : 'Сервис данных недоступен. Повторите загрузку.');
        return result;
    }
    throw Error('Сервис занят. Повторите загрузку.');
}
export async function json(url, signal) {
    const result = await response(url, signal);
    const text = await result.text();
    if (text.length > 1024 * 1024)
        throw Error('Слишком большой ответ сервиса.');
    signal.throwIfAborted();
    return JSON.parse(text);
}
/** Owns one selection, at most two outstanding fetches and eighteen native blocks. */
export class FieldLoader {
    controller = new AbortController();
    generation = 0;
    cancel() { this.controller.abort(); this.controller = new AbortController(); this.generation++; }
    async load(selection) {
        this.cancel();
        const generation = this.generation, signal = this.controller.signal, start = performance.now();
        const metadata = await json(selection.native_display, signal);
        if (metadata.contract !== 'hmc-native-display/1' || metadata.contract_sha256 !== '3c245dada032f3cf4ee0f26e2c371e863ba0094a3c5f8de4e5f2c6af3ef4c1f0' || metadata.selection !== selection.selection ||
            metadata.grid.shape_yx.join(',') !== '657,1377' || metadata.columns.join(',') !== '0,5' || metadata.rows.join(',') !== '0,2' ||
            metadata.grid.spacing_degrees_xy?.join(',') !== '0.0625,0.0625' ||
            metadata.grid.outer_cell_edges_wsen?.join(',') !== '-23.53125,29.46875,62.53125,70.53125' ||
            metadata.crs !== 'urn:hmc:crs:icon-sphere-6371229' || metadata.encoding !== 'f32' || metadata.units !== 'K' || metadata.stored_size?.join(',') !== '258,258' ||
            ['model', 'run', 'revision', 'field', 'level', 'valid_time', 'native_grid_sha256', 'member'].some(key => metadata.identity[key] !== selection[key]))
            throw Error('Несогласованный числовой контракт или выборка.');
        const blocks = new Array(18);
        let next = 0, bytes = new TextEncoder().encode(JSON.stringify(metadata)).length;
        const worker = async () => {
            while (next < 18) {
                const index = next++, url = metadata.url.replace('{column}', String(index % 6)).replace('{row}', String(Math.floor(index / 6)));
                const payload = await (await response(url, signal)).arrayBuffer();
                signal.throwIfAborted();
                if (generation !== this.generation)
                    throw new DOMException('Устаревшая выборка', 'AbortError');
                if (payload.byteLength !== 332820)
                    throw Error('Повреждённый числовой блок.');
                const values = new DataView(payload), mask = new Uint8Array(payload, 258 * 258 * 4);
                for (let i = 0; i < mask.length; i++) {
                    const value = values.getFloat32(i * 4, true);
                    if (!Number.isFinite(value) || mask[i] > 1 || mask[i] === 0 && value !== 0)
                        throw Error('Повреждены значения или маска числового блока.');
                }
                bytes += payload.byteLength;
                if (bytes > 8 * 1024 ** 2)
                    throw Error('Превышен объём числовых данных на вид.');
                blocks[index] = payload;
            }
        };
        try {
            await Promise.all([worker(), worker()]);
        }
        catch (error) {
            if (generation === this.generation)
                this.cancel();
            throw error;
        }
        signal.throwIfAborted();
        return { metadata, blocks, bytes, load_ms: performance.now() - start };
    }
}
