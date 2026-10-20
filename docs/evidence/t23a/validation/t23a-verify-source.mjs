import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const index=JSON.parse(fs.readFileSync('docs/evidence/t23a/artifact-index.json','utf8'));
const inventory=JSON.parse(fs.readFileSync('docs/evidence/t23a/'+index.input_inventory,'utf8'));
const ref=process.argv[2]??'index';
for(const item of inventory){
    if(hash(fs.readFileSync(item.path))!==item.sha256)throw Error('Working source differs: '+item.path);
    const blob=execFileSync('git',['show',(ref==='index'?':':ref+':')+item.path],{maxBuffer:32*1024**2,stdio:['ignore','pipe','pipe']});
    if(hash(blob)!==item.sha256)throw Error('Git source differs: '+item.path);
}
console.log(JSON.stringify({status:'passed',reference:ref,files:inventory.length}));
