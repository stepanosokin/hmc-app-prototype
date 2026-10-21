// Run from the repository root; no server, browser or Docker resources.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root='docs/evidence/t13', read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const sha=(b,algorithm='sha256')=>crypto.createHash(algorithm).update(b).digest('hex');
const index=read(root+'/artifact-index.json');
for(const item of index.artifacts){
 assert.ok(item.path.startsWith(root+'/')&&!item.path.includes('..')&&!item.path.includes('\\'));
 const bytes=fs.readFileSync(item.path);
 assert.equal(bytes.length,item.bytes,item.path);
 assert.equal(sha(bytes),item.sha256,item.path);
 assert.equal(sha(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes]),'sha1'),item.git_object,item.path);
}
const frozen=read(root+'/frozen-inputs.json').files;
for(const [name,info]of Object.entries(frozen)){
 const bytes=fs.readFileSync(path.join(root,'inputs',name));
 assert.equal(bytes.length,info.bytes,name);assert.equal(sha(bytes),info.sha256,name);
 if(process.argv.includes('--current'))assert.equal(sha(fs.readFileSync(name)),info.sha256,'Current runtime drift: '+name);
}
for(const name of ['desktop2','android4']){
 const dir=root+'/attempts/'+name+'/reports';
 assert.deepEqual(read(dir+'/inputs-start.json'),frozen);
 assert.deepEqual(read(dir+'/inputs-end.json'),frozen);
 for(const file of ['browser/browser.json',...(name==='desktop2'?['browser-edge/browser.json','browser-unavailable/browser.json']:[])]){
  const result=read(dir+'/'+file);assert.equal(result.status,'passed');
  assert.ok(Object.values(result.cleanup).every(value=>value===true||value===0));
 }
 const comparison=read(dir+'/native-comparison.json');
 assert.equal(comparison.status,'passed');assert.equal(comparison.mask_differences,0);
 assert.ok(comparison.max_abs_error_K<=.01);
}
const copies=read(root+'/archive-copy-verification.json');
assert.equal(copies.attempts.length,16);
for(const attempt of copies.attempts){
 const name=attempt.project.replace('hmc-publication-t13-','').replace('hmc-publication-t5-t13-final1','t5-final1');
 const dir=root+'/attempts/'+name, retirement=read(dir+'/retirement.json');
 assert.equal(retirement.archive_verified,true);assert.ok(Object.values(retirement.remaining).every(a=>a.length===0));
 for(const item of read(dir+'/artifact-index.json').artifacts){
  const bytes=fs.readFileSync(path.join(dir,...item.name.split(/[\\/]/)));
  assert.equal(bytes.length,item.bytes);assert.equal(sha(bytes),item.sha256.toLowerCase());
 }
}
console.log(JSON.stringify({status:'passed',artifacts:index.artifacts.length,frozen_inputs:Object.keys(frozen).length,retired_attempts:16,test_resources_created:0}));
