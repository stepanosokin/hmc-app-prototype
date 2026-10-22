import {readFile,readdir,cp,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const digest=b=>createHash('sha256').update(b).digest('hex');
const root=resolve('docs/evidence/t25');
for(const project of process.argv.slice(2)){
    assert.match(project,/^hmc-publication-t13-t25-[a-z0-9-]+$/);
    const archiveRoot=resolve('data/archives/publication',project);
    const entries=await readdir(archiveRoot,{withFileTypes:true});
    const ids=entries.filter(e=>e.isDirectory());assert.equal(ids.length,1);
    const archive=join(archiveRoot,ids[0].name);
    const receipt=JSON.parse(await readFile(join(archive,'retirement.json'),'utf8'));
    assert.equal(receipt.status,'retired');assert.equal(receipt.archive_verified,true);
    for(const v of Object.values(receipt.remaining))assert.deepEqual(v,[]);
    const originalIndex=JSON.parse(await readFile(join(archive,'artifact-index.json'),'utf8'));
    for(const artifact of originalIndex.artifacts){
        const bytes=await readFile(join(archive,artifact.name));
        assert.equal(bytes.length,artifact.bytes);assert.equal(digest(bytes),artifact.sha256.toLowerCase());
    }
    const target=join(root,'attempts',project.replace('hmc-publication-t13-t25-',''));
    await mkdir(target,{recursive:true});await cp(archive,target,{recursive:true});
    const inputs=resolve('data/reports/t13',project,'inputs');
    await cp(inputs,join(target,'reports/inputs'),{recursive:true});
    let inputCount=0;
    try{
        const manifest=JSON.parse(await readFile(join(target,'reports/inputs-start.json'),'utf8'));
        for(const [name,entry] of Object.entries(manifest)){
            const bytes=await readFile(join(target,'reports/inputs',name));
            assert.equal(bytes.length,entry.bytes);assert.equal(digest(bytes),entry.sha256);inputCount++;
        }
    }catch(error){if(error.code!=='ENOENT')throw error;}
    console.log(JSON.stringify({project,artifacts_verified:originalIndex.artifacts.length,inputs_verified:inputCount,retired:true}));
}
const artifacts=[];
async function walk(directory){for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory())await walk(path);
    else if(path!==join(root,'artifact-index.json')){
        const bytes=await readFile(path),name=relative(root,path).replaceAll('\\','/');
        artifacts.push({name,bytes:bytes.length,sha256:digest(bytes),git_blob:createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')});
    }
}}
await walk(root);artifacts.sort((a,b)=>a.name.localeCompare(b.name));
await writeFile(join(root,'artifact-index.json'),JSON.stringify({phase:'pre-commit',observed_at:new Date().toISOString(),artifacts},null,2)+'\n');
console.log(JSON.stringify({indexed:artifacts.length}));
