import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const staged=new Map(execFileSync('git',['ls-files','--stage','-z'],{encoding:'utf8',maxBuffer:64*1024*1024}).split('\0').filter(Boolean).map(line=>{const [info,name]=line.split('\t');return [name,info.split(' ')[1]];}));
const index=JSON.parse(fs.readFileSync('docs/evidence/t13/artifact-index.json','utf8'));
for(const artifact of index.artifacts)assert.equal(staged.get(artifact.path),artifact.git_object,'Staged evidence drift '+artifact.path);
const changed=new Set(execFileSync('git',['diff','--cached','--name-only','-z'],{encoding:'utf8',maxBuffer:64*1024*1024}).split('\0'));
const frozen=JSON.parse(fs.readFileSync('docs/evidence/t13/frozen-inputs.json','utf8')).files;
for(const file of Object.keys(frozen)){
 if(file.startsWith('data/viewer/'))continue;
 const bytes=fs.readFileSync(file);
 const object=crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex');
 const expected=changed.has(file)?object:execFileSync('git',['hash-object','--path='+file,'--',file],{encoding:'utf8'}).trim();
 assert.equal(staged.get(file),expected,'Staged runtime drift '+file);
}
assert.equal(execFileSync('git',['diff','--name-only'],{encoding:'utf8'}).trim(),'');
console.log(JSON.stringify({status:'passed',staged_evidence:index.artifacts.length,staged_frozen_source_inputs:Object.keys(frozen).filter(f=>!f.startsWith('data/viewer/')).length,test_resources_created:0}));
