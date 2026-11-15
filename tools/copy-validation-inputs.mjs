import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {projectRoot} from './archive-paths.mjs';
import {sha256} from './archive-validation.mjs';

function inside(root,target){
    const relative=path.relative(root,target);
    return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);
}
function noLinks(root,target){
    let current=root;
    for(const part of ['',...path.relative(root,target).split(path.sep)]){
        current=path.join(current,part);
        if(fs.lstatSync(current,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('Symbolic input or destination path');
    }
}
/** Copy the service runner's exact inventory, without selecting files again. */
export function copyValidationInputs(manifest,destination,{workspace=projectRoot}={}){
    const root=path.resolve(workspace),source=path.resolve(root,manifest),target=path.resolve(root,destination);
    const reports=path.join(root,'data/reports');
    if(!inside(reports,source)||!inside(reports,target)||/^(?:\.env(?:\..*)?|.*\.env)$/i.test(path.basename(source)))throw Error('Expected report manifest and new report directory');
    noLinks(root,source);noLinks(root,target);
    if(fs.existsSync(target))throw Error('Input copy destination already exists');
    const manifestBytes=fs.readFileSync(source),manifestHash=createHash('sha256').update(manifestBytes).digest('hex');
    let inventory;
    try{inventory=JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/,''));}
    catch{throw Error('Invalid input inventory JSON');}
    if(!inventory||!Array.isArray(inventory.inputs)||!inventory.inputs.length)throw Error('Expected nonempty service inputs inventory');
    const paths=new Set();
    for(const input of inventory.inputs){
        if(!input||typeof input.path!=='string'||!Number.isSafeInteger(input.bytes)||input.bytes<0||
            typeof input.sha256!=='string'||!(/^[0-9a-f]{64}$/).test(input.sha256))throw Error('Invalid input inventory entry');
        const parts=input.path.replaceAll('\\','/').split('/');
        if(parts.some(part=>!part||part==='.'||part==='..'||part.includes(':'))||path.isAbsolute(input.path)||
            parts.some(part=>/^(?:\.env(?:\..*)?|.*\.env|profile|\.git|\.telegram|\.scratch)$/i.test(part)))throw Error('Unsafe or private input path');
        const key=parts.join('/').toLowerCase();
        if(paths.has(key))throw Error('Duplicate input path');
        paths.add(key);
        const file=path.resolve(root,...parts);
        if(!inside(root,file)||inside(target,file))throw Error('Input escapes workspace or overlaps destination');
        noLinks(root,file);
        if(!fs.statSync(file).isFile()||fs.statSync(file).size!==input.bytes||sha256(file)!==input.sha256)throw Error('Input differs from frozen manifest: '+input.path);
    }
    fs.mkdirSync(target,{recursive:true});
    for(const input of inventory.inputs){
        const parts=input.path.replaceAll('\\','/').split('/'),file=path.join(target,...parts);
        fs.mkdirSync(path.dirname(file),{recursive:true});
        fs.copyFileSync(path.join(root,...parts),file,fs.constants.COPYFILE_EXCL);
        if(fs.statSync(file).size!==input.bytes||sha256(file)!==input.sha256)throw Error('Input copy verification failed: '+input.path);
    }
    if(sha256(source)!==manifestHash)throw Error('Input manifest changed during copy');
    return {directory:target,files:inventory.inputs.length,manifest_sha256:manifestHash,status:'passed'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
    try{
        if(process.argv.length!==4)throw Error('Usage: node tools/copy-validation-inputs.mjs INPUTS_JSON NEW_REPORT_DIRECTORY');
        console.log(JSON.stringify(copyValidationInputs(process.argv[2],process.argv[3])));
    }catch(error){console.error('Копирование входов не завершено: '+error.message);process.exitCode=1;}
}
