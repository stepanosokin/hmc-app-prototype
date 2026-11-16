import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

function sourcePath(value){
    return value.replace(/^\/run\/desktop\/mnt\/host\/([a-z])\//,'$1:/').replaceAll('\\','/');
}
function mountKey(mount){
    let source=sourcePath(mount.source);
    if(/^[a-z]:\//i.test(source))source=source.toLowerCase();
    return JSON.stringify([mount.type,mount.name??null,source,mount.destination,mount.read_only??null]);
}
const sameSet=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
export function compareLiveResources(before,after,replaced){
    if(!Array.isArray(before)||!before.length||!Array.isArray(after)||!Array.isArray(replaced))throw Error('Expected container arrays.');
    for(const items of [before,after]){
        if(new Set(items.map(item=>item.name)).size!==items.length)throw Error('Duplicate container name.');
        for(const item of items){
            if(typeof item.name!=='string'||typeof item.id!=='string'||typeof item.state!=='string'||!Array.isArray(item.mounts)||!Array.isArray(item.networks))
                throw Error('Expected sanitized container snapshots.');
        }
    }
    if(replaced.some(name=>!before.some(item=>item.name===name)))throw Error('Unknown replacement container.');
    const errors=[];
    for(const old of before){
        const current=after.find(item=>item.name===old.name);
        if(!current){errors.push('missing '+old.name);continue;}
        if(!replaced.includes(old.name)&&current.id!==old.id)errors.push('id '+old.name);
        if(current.state!==old.state)errors.push('state '+old.name);
        if(!sameSet(old.mounts.map(mountKey),current.mounts.map(mountKey)))errors.push('mounts '+old.name);
        if(!sameSet(old.networks,current.networks))errors.push('networks '+old.name);
    }
    for(const current of after)if(!before.some(item=>item.name===current.name))errors.push('extra '+current.name);
    return {status:errors.length?'failed':'passed',errors,containers:before.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
    try{
        if(process.argv.length<5)throw Error('Usage: node tools/compare-live-resources.mjs BEFORE AFTER RESULT [REPLACED_NAME ...]');
        const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
        const result=compareLiveResources(read(process.argv[2]),read(process.argv[3]),process.argv.slice(5));
        fs.writeFileSync(process.argv[4],JSON.stringify(result,null,2)+'\n',{flag:'wx'});
        console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
    }catch(error){console.error(error.message);process.exitCode=1;}
}
