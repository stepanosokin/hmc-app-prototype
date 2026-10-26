import {archiveRoot,projectRoot} from '../archive-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const directory=archiveRoot('wms-compat'),workspace=projectRoot;
if(process.argv.some(arg=>arg.startsWith('--git=')))throw Error('External archive bytes are not tracked in the current Git tree; use historical verification without --git.');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const json=file=>JSON.parse(fs.readFileSync(path.join(directory,file),'utf8').replace(/^\uFEFF/,''));
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const index=json('artifact-index.json');
for(const item of index.files){const bytes=fs.readFileSync(path.join(directory,item.path));assert(bytes.length===item.bytes&&sha(bytes)===item.sha256,'Artifact mismatch '+item.path);}
let frozen=0;
for(const attempt of ['development','acceptance']){
 const base='attempts/'+attempt+'/',start=json(base+'inputs-start.json'),end=json(base+'inputs.json');
 assert(JSON.stringify(start)===JSON.stringify(end),'Inputs changed during '+attempt);
 for(const item of start.inputs){const bytes=fs.readFileSync(path.join(directory,base,'inputs',item.path));assert(bytes.length===item.bytes&&sha(bytes)===item.sha256,'Frozen mismatch '+item.path);frozen++;}
 const retired=json(base+'retirement.json');assert(retired.status==='retired'&&Object.values(retired.remaining).every(x=>x.length===0),'Cleanup incomplete '+attempt);
}
const gate=json('attempts/acceptance/gate.json');assert(gate.status==='passed'&&gate.development===false,'Missing final gate');
const desktop=json('attempts/acceptance/t11-desktop.json');assert(desktop.standard_identify.length===4,'Missing ordinary Identify checks');
for(const crs of ['EPSG:4326','EPSG:3857'])assert(new Set(desktop.standard_identify.filter(x=>x.crs===crs).map(x=>x.expected_K)).size===2,'Times must have different native values');
const before=json('live-before.json'),after=json('live-after.json');assert(!before.passed&&after.passed&&before.catalogue_sha256===after.catalogue_sha256&&after.forecast_times===24,'Live reproduction or preservation failed');
const current=process.argv.includes('--current'),gitArg=process.argv.find(x=>x.startsWith('--git='));
const inputs=[...json('frozen.json').inputs,...json('attempts/acceptance/inputs-start.json').inputs];
if(current)for(const item of inputs){const bytes=fs.readFileSync(path.join(workspace,item.path));assert(bytes.length===item.bytes&&sha(bytes)===item.sha256,'Current input changed '+item.path);}
if(gitArg){
 const revision=gitArg.slice(6),staged=revision==='index';
 const output=execFileSync('git',staged?['ls-files','--stage','-z']:['ls-tree','-rz',revision],{cwd:workspace,encoding:'utf8',maxBuffer:64*1024**2});
 const objects=new Map(output.split('\0').filter(Boolean).map(line=>{const [meta,file]=line.split('\t');return [file,meta.split(' ')[staged?1:2]];}));
 // Unchanged baseline checkout filters are historical; raw equality is required
 // for every changed input and every newly archived byte-addressed artifact.
 const files=[...json('frozen.json').inputs.map(x=>x.path),...index.files.map(x=>'docs/evidence/wms-compat/'+x.path),'docs/evidence/wms-compat/artifact-index.json'];
 for(const file of new Set(files)){const bytes=fs.readFileSync(path.join(workspace,file));const blob=crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');assert(objects.get(file)===blob,'Git bytes differ '+file);}
}
console.log(JSON.stringify({status:'passed',artifacts:index.files.length,frozen_copies:frozen,current_inputs:current,git:gitArg?.slice(6)}));
