// Read-only comparison: compile into memory, then GET the actual stand's modules.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';

const viewer=fileURLToPath(new URL('../viewer/',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');

export function compileViewerModules(){
    const ts=createRequire(new URL('../viewer/package.json',import.meta.url))('typescript');
    const {config,error}=ts.readConfigFile(path.join(viewer,'tsconfig.json'),ts.sys.readFile);
    if(error)throw Error('Не удалось прочитать конфигурацию TypeScript.');
    const parsed=ts.parseJsonConfigFileContent(config,ts.sys,viewer);
    const program=ts.createProgram(parsed.fileNames,parsed.options);
    if(parsed.errors.length||ts.getPreEmitDiagnostics(program).length)
        throw Error('Исходники не проходят проверку TypeScript. Выполните npm --prefix viewer run check.');
    const modules=new Map();
    const result=program.emit(undefined,(filename,source)=>{
        const name=path.relative(parsed.options.outDir,filename).split(path.sep).join('/');
        if(!/^[\w-]+\.js$/.test(name))throw Error('Неожиданный путь модуля сборки.');
        modules.set(name,Buffer.from(source));
    });
    if(result.emitSkipped||!modules.size)throw Error('Компилятор не создал модули.');
    return modules;
}

export async function checkViewerRuntime(modules,origin,fetchModule=fetch){
    if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Укажите локальный HTTP origin: http://127.0.0.1:ПОРТ');
    const failures=[];
    for(const [name,source] of modules){
        if(!/^[\w-]+\.js$/.test(name))throw Error('Неожиданный путь модуля сборки.');
        let response;
        try{response=await fetchModule(origin+'/build/'+name,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});}
        catch{failures.push({module:name,reason:'network'});continue;}
        if(response.status!==200){failures.push({module:name,reason:'http',status:response.status});continue;}
        if(!/^(?:text|application)\/javascript(?:;|$)/i.test(response.headers.get('content-type')??'')){
            failures.push({module:name,reason:'mime'});continue;
        }
        try{
            const expected=sha(source),actual=sha(Buffer.from(await response.arrayBuffer()));
            if(actual!==expected)failures.push({module:name,reason:'bytes',expected,actual});
        }catch{failures.push({module:name,reason:'body'});}
    }
    return {status:failures.length?'failed':'passed',modules:modules.size,failures};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
    try{
        const result=await checkViewerRuntime(compileViewerModules(),process.argv[2]??'http://127.0.0.1:8140');
        console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
    }catch(error){console.error(error.message);process.exitCode=1;}
}
