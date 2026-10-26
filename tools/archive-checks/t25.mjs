import {archiveRoot,projectRoot} from '../archive-paths.mjs';
// Resource-free verification of the committed T25 archive, including raw inputs.
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,join,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=archiveRoot('t25')+sep;
const repository=projectRoot;
if(process.argv.includes('--staged'))throw Error('External archives are not staged in Git; use historical verification without --staged.');
const read=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const index=await read(join(root,'artifact-index.json'));
let staged,baseline;
if(process.argv.includes('--staged')){
    const records=execFileSync('git',['ls-files','--stage','-z'],{cwd:repository,encoding:'utf8',maxBuffer:64*1024**2}).split('\0').filter(Boolean);
    staged=new Map(records.map(line=>{const [metadata,path]=line.split('\t');return [path,metadata.split(' ')[1]];}));
    const original=execFileSync('git',['ls-tree','-rz','6e76858eaca12dbfc8a722f141896024d1520610'],{cwd:repository,encoding:'utf8',maxBuffer:64*1024**2}).split('\0').filter(Boolean);
    baseline=new Map(original.map(line=>{const [metadata,path]=line.split('\t');return [path,metadata.split(' ')[2]];}));
}
for(const item of index.artifacts){
    const path=resolve(root,item.name);assert.ok(path.startsWith(root),'Archive path remains within root');
    const bytes=await readFile(path);
    assert.equal(bytes.length,item.bytes,item.name);assert.equal(hash(bytes),item.sha256,item.name);
    const blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(blob,item.git_blob,item.name);
    if(staged)assert.equal(staged.get('docs/evidence/t25/'+item.name),blob,'Staged bytes: '+item.name);
}
const attempts=await readdir(join(root,'attempts'));let inputs=0;
for(const attempt of attempts){
    const directory=join(root,'attempts',attempt),receipt=await read(join(directory,'retirement.json'));
    assert.equal(receipt.status,'retired',attempt);assert.equal(receipt.archive_verified,true,attempt);
    for(const remaining of Object.values(receipt.remaining))assert.deepEqual(remaining,[],attempt);
    let manifest;
    try{manifest=await read(join(directory,'reports/inputs-start.json'));}
    catch(error){if(!['dev4','dev5'].includes(attempt)||error.code!=='ENOENT')throw error;continue;}
    for(const [path,entry] of Object.entries(manifest)){
        const bytes=await readFile(join(directory,'reports/inputs',path));
        assert.equal(bytes.length,entry.bytes);assert.equal(hash(bytes),entry.sha256,attempt+': '+path);inputs++;
    }
}
let final;
for(const attempt of ['desktop-final4','android-final3']){
    const directory=join(root,'attempts',attempt,'reports'),start=await read(join(directory,'inputs-start.json'));
    assert.deepEqual(await read(join(directory,'inputs-end.json')),start,attempt);
    if(final)assert.deepEqual(start,final,'Final platforms use identical inputs');else final=start;
    const results=(await readFile(join(directory,'process-results.jsonl'),'utf8')).trim().split(/\r?\n/).map(line=>JSON.parse(line.replace(/^\uFEFF/,'')));
    assert.ok(results.length>0);for(const result of results)assert.equal(result.native_exit_code,0,attempt+': '+result.check);
}
let sourceBlobs=0;
let prospective;
if(staged){
    const paths=Object.keys(final).filter(path=>!path.startsWith('data/viewer/'));
    const hashes=execFileSync('git',['hash-object','--stdin-paths'],{cwd:repository,input:paths.join('\n')+'\n',encoding:'utf8',maxBuffer:2*1024**2}).trim().split(/\r?\n/);
    assert.equal(hashes.length,paths.length);prospective=new Map(paths.map((path,index)=>[path,hashes[index]]));
}
for(const [path,entry] of staged?Object.entries(final):[]){
    const bytes=await readFile(join(repository,path));
    assert.equal(bytes.length,entry.bytes,path);assert.equal(hash(bytes),entry.sha256,'Current final input: '+path);
    if(path.startsWith('data/viewer/'))continue;
    assert.ok(staged.has(path),'Final source must be staged: '+path);
    assert.equal(staged.get(path),prospective.get(path),'Staged final input: '+path);
    // Unchanged baseline files may retain their existing checkout line-ending filter.
    // Changed/new sources were required to match raw prospective blobs at preflight.
    if(staged.get(path)!==baseline.get(path)){
        const blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        assert.equal(staged.get(path),blob,'Validated source blob: '+path);sourceBlobs++;
    }
}
console.log(JSON.stringify({status:'passed',artifacts:index.artifacts.length,retired_projects:attempts.length,verified_input_files:inputs,final_inputs:Object.keys(final).length,staged_bytes_verified:Boolean(staged),validated_changed_source_blobs:sourceBlobs,resources_created:false}));
