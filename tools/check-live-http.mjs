import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Public local probes only: no credentials, caller headers, redirects or retries.
export async function checkLiveHttp(address,directory,fetchResponse=fetch){
    const url=new URL(address);
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.hash||
        [...url.searchParams.keys()].some(key=>/^(?:key|api_key|apikey|token|access_token|authorization|x-api-key)$/i.test(key)))
        throw Error('Укажите локальный HTTP URL без секретов.');
    fs.mkdirSync(directory,{recursive:true});
    if(fs.readdirSync(directory).length)throw Error('Для каждого запроса нужен пустой каталог отчёта.');
    const started=performance.now();
    const result={url:url.href,status:null,request_id:null,content_type:null,retry_after:null,passed:false};
    try{
        const response=await fetchResponse(url.href,{redirect:'error',signal:AbortSignal.timeout(120000)});
        result.status=response.status;
        result.request_id=response.headers.get('x-request-id');
        result.content_type=response.headers.get('content-type');
        result.retry_after=response.headers.get('retry-after');
        fs.writeFileSync(path.join(directory,'body.bin'),Buffer.from(await response.arrayBuffer()),{flag:'wx'});
        result.passed=response.status===200;
    }catch{
        result.error='Ошибка сети или чтения ответа.';
    }finally{
        result.duration_ms=Math.round(performance.now()-started);
        fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    }
    return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
    try{
        if(process.argv.length!==4)throw Error('Usage: node tools/check-live-http.mjs URL EMPTY_REPORT_DIRECTORY');
        const result=await checkLiveHttp(process.argv[2],process.argv[3]);
        console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
    }catch(error){console.error(error.message);process.exitCode=1;}
}
