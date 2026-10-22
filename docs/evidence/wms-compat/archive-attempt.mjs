import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=process.cwd(),project=process.argv[2],label=process.argv[3];
const report=path.join(root,'data/reports/t11',project),out=path.join(root,'docs/evidence/wms-compat/attempts',label);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const inventory=JSON.parse(fs.readFileSync(path.join(report,'inputs-start.json')));
fs.mkdirSync(out,{recursive:true});
for(const item of inventory.inputs){
    const bytes=fs.readFileSync(path.join(root,item.path));
    if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)throw Error('Changed frozen input: '+item.path);
    const target=path.join(out,'inputs',item.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
}
const forbidden=/^(?:environment\.env|.*\.key|key|desktop\.json)$/;
function copy(from,to){fs.mkdirSync(to,{recursive:true});for(const item of fs.readdirSync(from,{withFileTypes:true})){
    if(forbidden.test(item.name))continue;
    const source=path.join(from,item.name),target=path.join(to,item.name);
    if(item.isDirectory())copy(source,target);else fs.copyFileSync(source,target);
}}
copy(report,out);
const archives=path.join(root,'data/archives/publication',project);
if(fs.existsSync(archives))for(const entry of fs.readdirSync(archives)){
    const receipt=path.join(archives,entry,'retirement.json');if(fs.existsSync(receipt))fs.copyFileSync(receipt,path.join(out,'retirement.json'));
}
console.log(JSON.stringify({project,label,frozen_inputs:inventory.inputs.length,source_sha256:inventory.actual_source_sha256}));
