import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const MAX_OUTPUT_BYTES=12*1024;
const MAX_INPUT_BYTES=64*1024**2;
function text(value,limit=256){
    if(typeof value!=='string')return undefined;
    const safe=value.slice(0,4096)
        .replace(/(authorization["']?\s*[:=]\s*["']?)(?:Basic|Bearer)\s+[^\s,"']+/gi,'$1<REDACTED>')
        .replace(/((?:password|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*["']?)[^\s,"'&]+/gi,'$1<REDACTED>');
    let result='',bytes=0;
    for(const character of safe){const size=Buffer.byteLength(character);if(bytes+size>limit)break;result+=character;bytes+=size;}
    return result+(result.length<safe.length?'…':'');
}
function fields(value,names){
    const result={};
    for(const name of names){
        const item=value?.[name];
        if(typeof item==='string')result[name]=text(item);
        else if(typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))result[name]=item;
    }
    return result;
}
const samples=(values,limit=3)=>Array.isArray(values)?values.slice(0,limit).map(value=>text(typeof value==='string'?value:value?.message,128)).filter(Boolean):undefined;
function identity(value){
    const result=fields(value,['selection','model','run','revision','field','level','valid_time','fixture','native_grid_sha256','member']);
    if(value?.member===null)result.member=null;
    return result;
}
const count=value=>Array.isArray(value)?value.length:undefined;
const processRecord=row=>({...fields(row,['check']),native_exit_code:typeof row?.native_exit_code==='number'&&Number.isFinite(row.native_exit_code)?row.native_exit_code:null});

/** Keep diagnostics useful without materializing nested raster/metadata graphs. */
export function summarizeReport(report){
    if(Array.isArray(report)){
        const failed=report.filter(row=>typeof row?.check==='string'&&row.native_exit_code!==0);
        return {records:report.length,failed:failed.length,
            failures:failed.slice(0,5).map(processRecord),
            last:processRecord(report.at(-1))};
    }
    if(!report||typeof report!=='object')throw Error('Expected an object or records');
    const result=fields(report,['status','state','phase','observed_at','scope','failure','error','starting_commit']);
    result.browser=fields(report.browser,['product','protocolVersion']);
    result.counts=Object.fromEntries(['checks','errors','requests','responses','files','inputs'].filter(key=>Array.isArray(report[key])).map(key=>[key,report[key].length]));
    result.errors=samples(report.errors);
    if(report.state&&typeof report.state==='object'){
        result.state=fields(report.state,['ready','field','mode','button','canvas']);
        if(report.state.contours===null)result.state.contours=null;
        else if(report.state.contours)result.state.contours=fields(report.state.contours,['state','message','enabled','worker_active','curves']);
    }
    if(report.viewport)result.viewport=fields(report.viewport,['width','height','scope']);
    if(Number.isSafeInteger(report.contour_ink_pixels))result.contour_ink_pixels=report.contour_ink_pixels;
    if(Array.isArray(report.responses)){
        const statuses=new Map();
        for(const response of report.responses)if(Number.isInteger(response?.status)&&response.status>=400&&response.status<=599)
            statuses.set(response.status,(statuses.get(response.status)??0)+1);
        result.http_failures=Object.fromEntries([...statuses].sort((a,b)=>a[0]-b[0]));
    }
    result.cleanup=fields(report.cleanup,['page_released','browser_stopped','profile_removed','browser_processes_remaining',
        'adb_forward_removed','adb_reverse_removed','ui_dump_removed','user_chrome_retained']);
    if(report.cleanup?.errors)result.cleanup.errors=samples(report.cleanup.errors);
    if(Array.isArray(report.nodata)){
        result.nodata={cases:report.nodata.length,
            kinds:[...new Set(report.nodata.map(item=>text(item?.kind,32)).filter(Boolean))].slice(0,8),
            viewports:[...new Set(report.nodata.filter(item=>Number.isSafeInteger(item?.width)&&Number.isSafeInteger(item?.height))
                .map(item=>item.width+'x'+item.height))].slice(0,8)};
    }
    if(Array.isArray(report.viewports))result.viewports=report.viewports.slice(0,8).map(view=>fields(view,['width','height','mobile_emulation','physical_mobile']));
    if(report.failure_state)result.failure_state={...fields(report.failure_state,['ready','frame_visible','time_state','catalogue_pending','catalogue_checks']),selected:identity(report.failure_state.selected)};
    if(report.updates)result.updates={races:count(report.updates.races),failures:samples(report.updates.failures),new_run:identity(report.updates.new_run)};
    if(report.withdrawal)result.withdrawal={checks:samples(report.withdrawal.checks,8),operations:count(report.withdrawal.operations)};
    return result;
}
export function renderSummary(report){
    const output=JSON.stringify(summarizeReport(report),null,2)+'\n';
    if(Buffer.byteLength(output)>MAX_OUTPUT_BYTES)throw Error('Summary exceeds output limit');
    return output;
}
function main(){
    const args=process.argv.slice(2);
    if(args.length!==1)throw Error('Usage');
    if(args[0]==='--help'){console.log('node tools/validation-summary.mjs ПУТЬ_К_ОТЧЁТУ\nПоддерживаются JSON и JSONL.');return;}
    const info=fs.statSync(args[0]);
    if(!info.isFile()||info.size>MAX_INPUT_BYTES)throw Error('Invalid report size');
    const source=fs.readFileSync(args[0],'utf8').replace(/^\uFEFF/,'');
    const report=args[0].toLowerCase().endsWith('.jsonl')?source.split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line)):JSON.parse(source);
    process.stdout.write(renderSummary(report));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
    try{main();}catch{console.error('Не удалось прочитать отчёт. Укажите корректный JSON/JSONL-файл размером до 64 МиБ.');process.exitCode=1;}
}
