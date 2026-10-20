import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const prefix='docs/evidence/t23a/';
const read=name=>JSON.parse(fs.readFileSync(prefix+name,'utf8').replace(/^\uFEFF/,''));
const index=read('artifact-index.json');
for(const item of index.artifacts){
    const bytes=fs.readFileSync(prefix+item.name);
    assert.equal(bytes.length,item.bytes,item.name);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),item.sha256,item.name);
}
const projects=new Set();
for(const name of index.retirements){
    const receipt=read(name);assert.equal(receipt.status,'retired');assert.equal(receipt.archive_verified,true);
    for(const kind of ['container','network','volume'])assert.equal(receipt.remaining[kind].length,0);
    projects.add(receipt.project);
}
for(const gate of index.regressions){assert.equal(read(gate.result).status,'passed');assert.equal(read(gate.result).development,false);}
const negative=index.artifacts.find(x=>x.name.includes('hmc-publication-t23a-evidence2/')&&x.name.endsWith('/evidence-negative.json'));
assert.ok(negative);const result=read(negative.name);assert.equal(result.status,'passed');assert.equal(result.negative_checks.length,10);
assert.ok(result.negative_checks.every(x=>x.status==='rejected'));
console.log(JSON.stringify({status:'passed',artifacts:index.artifacts.length,retired_projects:projects.size,negative_checks:10}));
