import type {Selection} from './selection.js';
export interface NativeMetadata {
    source_crs?: {template:number;[key:string]:unknown};
    display_range?: number[]|null; all_nodata?:boolean; all_transparent?:boolean; zero_transparent?:boolean; encoding_max_abs_error?: number;
    uv_relative_to_grid?: boolean;
    portrayal_baseline?: boolean;
    contract: string; contract_sha256: string; selection: string; identity: Record<string,unknown>;
    selection_identity: string[]; matrix: string; crs: string; engine: string;
    grid: {shape_yx: number[]; spacing_degrees_xy: number[]; outer_cell_edges_wsen: number[]};
    url: string; columns: number[]; rows: number[];
    encoding:string;units:string;stored_size:number[];
}
export interface FieldData {metadata: NativeMetadata; blocks: ArrayBuffer[]; bytes: number; load_ms: number; wind?:FieldData; decode_ms?:number[]}
export class PublicationExpired extends Error {
    constructor(){super('Публикация истекла. Проверьте обновления.');}
}
export function localURL(url: string): string {
    if(!/^\/(?:api\/v1\/|ogc\/collections\/)/.test(url)||url.includes('..')||url.includes('\\')||url.includes('#'))
        throw Error('Недопустимый адрес опубликованных данных.');
    return url;
}
// Tiles, discovery and the point series use the same public gateway budget.
let activeRequests=0;
const requestQueue:Array<()=>void>=[];
function requestSlot(signal:AbortSignal):Promise<()=>void>{
    signal.throwIfAborted();
    return new Promise((resolve,reject)=>{
        const abort=()=>{const index=requestQueue.indexOf(start);if(index>=0)requestQueue.splice(index,1);reject(signal.reason);};
        const start=()=>{
            signal.removeEventListener('abort',abort);activeRequests++;
            resolve(()=>{activeRequests--;requestQueue.shift()?.();});
        };
        if(activeRequests<2)start();
        else{requestQueue.push(start);signal.addEventListener('abort',abort,{once:true});}
    });
}
async function response(url: string, signal: AbortSignal): Promise<Response> {
    for(let attempt=0;attempt<3;attempt++){
        const release=await requestSlot(signal);
        let result:Response;
        try{result=await fetch(localURL(url),{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),cache:'no-store'});}
        finally{release();}
        if(result.status===429&&attempt<2){
            await new Promise<void>((resolve,reject)=>{
                const abort=()=>{clearTimeout(timer);reject(signal.reason);};
                const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},1000);
                signal.addEventListener('abort',abort,{once:true});
            });continue;
        }
        if(result.status===410)throw new PublicationExpired();
        if(!result.ok)throw Error(result.status===404?'Выбранная публикация недоступна.':'Сервис данных недоступен. Повторите загрузку.');
        return result;
    }
    throw Error('Сервис занят. Повторите загрузку.');
}
export async function json<T>(url: string,signal: AbortSignal,limit=1024*1024): Promise<T> {
    const result=await response(url,signal);
    if(limit>4*1024**2||Number(result.headers.get('Content-Length'))>limit)throw Error('Слишком большой ответ сервиса.');
    const bytes=await result.arrayBuffer();
    if(bytes.byteLength>limit)throw Error('Слишком большой ответ сервиса.');
    signal.throwIfAborted();return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
/** Owns one selection, at most two outstanding fetches and eighteen native blocks. */
export class FieldLoader {
    controller=new AbortController();
    generation=0;
    private loadingBlocks:ArrayBuffer[]|undefined;
    private secondary:FieldLoader|undefined;
    private baseline:boolean;
    constructor(baseline=false){this.baseline=baseline;}
    cancel(){this.controller.abort();this.controller=new AbortController();this.generation++;
        this.secondary?.cancel();this.secondary=undefined;
        if(this.loadingBlocks)this.loadingBlocks.length=0;this.loadingBlocks=undefined;}
    async load(selection: Selection): Promise<FieldData> {
        this.cancel();const generation=this.generation,signal=this.controller.signal,start=performance.now();
        const metadata=await json<NativeMetadata>(selection.native_display,signal);
        if(this.baseline)metadata.portrayal_baseline=true;
        const generic=metadata.contract==='hmc-native-display/3';
        const extended=generic||metadata.contract==='hmc-native-display/2';
        if((generic?metadata.contract_sha256!=='98c9e10367d9c4185647e22758c94913d8cc9d716561ff0b93f3b1dcd71db0eb'||selection.field_profile!=='grib2-fields/1'||
            (metadata.all_nodata===true||metadata.all_transparent===true?metadata.display_range!==null:
            !metadata.display_range||metadata.display_range.length!==2||metadata.display_range.some(v=>!Number.isFinite(v))||metadata.display_range[0]>metadata.display_range[1]):
            extended?metadata.contract_sha256!=='2d4f078f773b794f5a727a3506cacc3fa8f7a0ca58e829698c68c1da03b3ecf7':
            metadata.contract!=='hmc-native-display/1'||metadata.contract_sha256!=='3c245dada032f3cf4ee0f26e2c371e863ba0094a3c5f8de4e5f2c6af3ef4c1f0')||metadata.selection!==selection.selection||
            (!extended&&(metadata.grid.shape_yx.join(',')!=='657,1377'||metadata.columns.join(',')!=='0,5'||metadata.rows.join(',')!=='0,2'||
            metadata.grid.spacing_degrees_xy?.join(',')!=='0.0625,0.0625'||
            metadata.grid.outer_cell_edges_wsen?.join(',')!=='-23.53125,29.46875,62.53125,70.53125'||
            metadata.crs!=='urn:hmc:crs:icon-sphere-6371229'))||metadata.encoding!=='f32'||metadata.units!==selection.units||metadata.stored_size?.join(',')!=='258,258'||
            ['model','run','revision','field','level','valid_time','native_grid_sha256','member'].some(key=>metadata.identity[key]!==selection[key as keyof Selection]))
            throw Error('Несогласованный числовой контракт или выборка.');
        const columns=metadata.columns[1]+1,rows=metadata.rows[1]+1,count=columns*rows;
        if(!Number.isSafeInteger(count)||count<1||count>(extended?64:18)||metadata.columns[0]!==0||metadata.rows[0]!==0||
            metadata.grid.shape_yx.length!==2||metadata.grid.shape_yx.some(x=>!Number.isSafeInteger(x)||x<1)||
            Math.ceil(metadata.grid.shape_yx[1]/256)!==columns||Math.ceil(metadata.grid.shape_yx[0]/256)!==rows||
            metadata.grid.spacing_degrees_xy.some(x=>!Number.isFinite(x)||x<=0)||metadata.grid.outer_cell_edges_wsen.some(x=>!Number.isFinite(x))||
            extended&&(!metadata.source_crs||![0,1,10,20,30,31].includes(metadata.source_crs.template)))throw Error('Некорректная геометрия числовой сетки.');
        const blocks=new Array<ArrayBuffer>(count);let next=0,bytes=new TextEncoder().encode(JSON.stringify(metadata)).length;
        const decode_ms=new Array<number>(count);
        this.loadingBlocks=blocks;
        const worker=async()=>{
            while(next<count){
                const index=next++,url=metadata.url.replace('{column}',String(index%columns)).replace('{row}',String(Math.floor(index/columns)));
                const payload=await (await response(this.baseline?url.replace(/\.f32$/,'.png'):url,signal)).arrayBuffer();
                signal.throwIfAborted();
                if(generation!==this.generation)throw new DOMException('Устаревшая выборка','AbortError');
                const decodeStart=performance.now();
                if(this.baseline){
                    if(payload.byteLength<24||payload.byteLength>332820||new DataView(payload).getUint32(16)!==258||new DataView(payload).getUint32(20)!==258)
                        throw Error('Повреждённый цветной блок.');
                    const bitmap=await createImageBitmap(new Blob([payload],{type:'image/png'}),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
                    const canvas=document.createElement('canvas');canvas.width=258;canvas.height=258;
                    try{
                        if(bitmap.width!==258||bitmap.height!==258)throw Error('Повреждённый размер цветного блока.');
                        const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);
                        blocks[index]=ctx.getImageData(0,0,258,258).data.buffer as ArrayBuffer;
                    }finally{bitmap.close();canvas.width=0;canvas.height=0;}
                    signal.throwIfAborted();
                    if(generation!==this.generation)throw new DOMException('Устаревшая выборка','AbortError');
                    decode_ms[index]=performance.now()-decodeStart;
                    bytes+=payload.byteLength;if(bytes>(extended?24:8)*1024**2)throw Error('Превышен объём цветных данных на вид.');
                    continue;
                }
                if(payload.byteLength!==332820)throw Error('Повреждённый числовой блок.');
                const values=new DataView(payload),mask=new Uint8Array(payload,258*258*4);
                for(let i=0;i<mask.length;i++){
                    const value=values.getFloat32(i*4,true);
                    if(!Number.isFinite(value)||mask[i]>1||mask[i]===0&&value!==0)
                        throw Error('Повреждены значения или маска числового блока.');
                }
                bytes+=payload.byteLength;if(bytes>(extended?24:8)*1024**2)throw Error('Превышен объём числовых данных на вид.');
                blocks[index]=payload;
                decode_ms[index]=performance.now()-decodeStart;
            }
        };
        try{await Promise.all([worker(),worker()]);}catch(error){if(generation===this.generation)this.cancel();throw error;}
        signal.throwIfAborted();
        let wind:FieldData|undefined;
        if(selection.wind_v&&!this.baseline){
            this.secondary=new FieldLoader();
            wind=await this.secondary.load(selection.wind_v);
            signal.throwIfAborted();
            if(metadata.uv_relative_to_grid!==wind.metadata.uv_relative_to_grid||typeof metadata.uv_relative_to_grid!=='boolean')
                throw Error('Не согласована ориентация компонент ветра.');
            bytes+=wind.bytes;
        }
        this.loadingBlocks=undefined;
        return {metadata,blocks,bytes,wind,decode_ms,load_ms:performance.now()-start};
    }
}
