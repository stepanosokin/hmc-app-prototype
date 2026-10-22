import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root='docs/evidence/t27';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const attempts=[];
for(const name of fs.readdirSync(root+'/attempts')){
 const dir=root+'/attempts/'+name,receipt=read(dir+'/retirement.json');
 assert.equal(receipt.status,'retired');assert.equal(receipt.archive_verified,true);
 for(const v of Object.values(receipt.remaining))assert.deepEqual(v,[]);
 let inputs=0;
 const start=dir+'/reports/inputs-start.json';
 if(fs.existsSync(start))for(const [p,v] of Object.entries(read(start))){const b=fs.readFileSync(dir+'/reports/inputs/'+p);assert.equal(b.length,v.bytes,p);assert.equal(sha(b),v.sha256,p);inputs++;}
 for(const v of read(dir+'/artifact-index.json').artifacts){const b=fs.readFileSync(path.join(dir,...v.name.split(/[\\/]/)));assert.equal(b.length,v.bytes);assert.equal(sha(b),v.sha256.toLowerCase());}
 attempts.push({name,status:'archived and retired',inputs});
}
const result={observed_at:new Date().toISOString(),status:'passed',attempts,test_resources_created:0};
fs.writeFileSync(root+'/checks/archive-verification.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:'passed',attempts:attempts.length,inputs:attempts.reduce((s,x)=>s+x.inputs,0)}));
