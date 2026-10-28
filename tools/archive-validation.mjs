import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {projectRoot,evidenceRoot} from './archive-paths.mjs';

function inside(root,target){const relative=path.relative(root,target);return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);}
function noLinks(root,target){
    if(fs.existsSync(root)&&fs.lstatSync(root).isSymbolicLink())throw Error('Symbolic archive root');
    let current=root;
    for(const part of path.relative(root,target).split(path.sep).filter(Boolean)){
        current=path.join(current,part);
        if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Symbolic archive path');
    }
}
export function sha256(file){
    const hash=createHash('sha256'),buffer=Buffer.alloc(1024**2),descriptor=fs.openSync(file,'r');
    try{let count;while((count=fs.readSync(descriptor,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));}
    finally{fs.closeSync(descriptor);}
    return hash.digest('hex');
}
/** New archives only: original reports and existing archives are never replaced. */
export function archiveValidation(source,archive,{workspace=projectRoot,evidenceDirectory=evidenceRoot}={}){
    if(path.isAbsolute(archive))throw Error('Archive must be relative to evidence root');
    const root=path.resolve(workspace),input=path.resolve(root,source),external=path.resolve(evidenceDirectory),target=path.resolve(external,archive);
    if(!['data/reports','data/archives'].some(directory=>inside(path.join(root,directory),input)))throw Error('Expected a report or retirement directory');
    if(!inside(external,target)||inside(input,target)||inside(target,input))throw Error('Archive escapes evidence root or overlaps source');
    noLinks(root,input);noLinks(external,target);
    if(!fs.lstatSync(input).isDirectory()||fs.existsSync(target))throw Error('Source unavailable or archive already exists');
    const files=[],excluded=[];
    function walk(directory){
        for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
            const file=path.join(directory,entry.name),relative=path.relative(input,file).replaceAll('\\','/');
            if(entry.isSymbolicLink())throw Error('Symbolic source entry');
            if(/^(?:\.env(?:\..*)?|.*\.env)$/i.test(entry.name)||entry.isDirectory()&&entry.name==='profile'){excluded.push(relative);continue;}
            if(entry.isDirectory())walk(file);
            else if(entry.isFile()){
                if(relative==='archive-index.json')throw Error('Reserved archive index name');
                files.push({path:relative,bytes:fs.statSync(file).size,sha256:sha256(file)});
            }else throw Error('Unsupported source entry');
        }
    }
    walk(input);
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.mkdirSync(target);
    for(const item of files){
        const destination=path.join(target,item.path);
        fs.mkdirSync(path.dirname(destination),{recursive:true});
        fs.copyFileSync(path.join(input,item.path),destination,fs.constants.COPYFILE_EXCL);
        if(fs.statSync(destination).size!==item.bytes||sha256(destination)!==item.sha256)throw Error('Archive verification failed');
    }
    const index={format:'hmc-validation-archive/1',observed_at:new Date().toISOString(),source:path.relative(root,input).replaceAll('\\','/'),files,excluded};
    const indexFile=path.join(target,'archive-index.json');
    fs.writeFileSync(indexFile,JSON.stringify(index,null,2)+'\n',{flag:'wx'});
    return {archive:target,files:files.length,excluded:excluded.length,index_sha256:sha256(indexFile)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
    try{
        if(process.argv.length!==4)throw Error('Usage: node tools/archive-validation.mjs REPORT_DIRECTORY ARCHIVE_RELATIVE_TO_EVIDENCE_ROOT');
        console.log(JSON.stringify(archiveValidation(process.argv[2],process.argv[3])));
    }catch(error){console.error('Архивирование не завершено: '+error.message);process.exitCode=1;}
}
