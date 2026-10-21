import ts from 'typescript';
import {rm,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const configPath=resolve(import.meta.dirname,'tsconfig.json');
const {config,error}=ts.readConfigFile(configPath,ts.sys.readFile);
if(error)throw Error(ts.flattenDiagnosticMessageText(error.messageText,'\n'));
const parsed=ts.parseJsonConfigFileContent(config,ts.sys,import.meta.dirname);
const program=ts.createProgram(parsed.fileNames,parsed.options);
const diagnostics=ts.getPreEmitDiagnostics(program);
if(diagnostics.length){console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{
    getCanonicalFileName:f=>f,getCurrentDirectory:()=>import.meta.dirname,getNewLine:()=>"\n"}));process.exit(1);}
const target=resolve(parsed.options.outDir),expected=resolve(import.meta.dirname,'../data/viewer/build');
if(target!==expected)throw Error('Unexpected viewer build directory');
await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
const emitted=program.emit();if(emitted.emitSkipped)throw Error('Viewer build skipped');
console.log('TypeScript: сборка и проверка завершены.');
