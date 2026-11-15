import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {copyValidationInputs} from './copy-validation-inputs.mjs';

function fixture(run){
    const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'hmc-input-copy-test-'));
    const workspace=path.join(temporary,'workspace'),manifest='data/reports/run/inputs-start.json',destination='data/reports/run/frozen-inputs';
    fs.mkdirSync(path.dirname(path.join(workspace,manifest)),{recursive:true});
    const inputs=[];
    function add(name,bytes=Buffer.from([0,255,13,10])){
        const file=path.join(workspace,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);
        inputs.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
    }
    function write(entries=inputs){fs.writeFileSync(path.join(workspace,manifest),JSON.stringify({inputs:entries}));}
    try{run({temporary,workspace,manifest,destination,inputs,add,write});}
    finally{
        assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));
        assert.match(path.basename(temporary),/^hmc-input-copy-test-/);
        fs.rmSync(temporary,{recursive:true,force:true});assert.equal(fs.existsSync(temporary),false);
    }
}
test('copies every declared Docker/Compose input and exact binary bytes',()=>fixture(options=>{
    const names=['Dockerfile','Dockerfile.adapters','compose.adapters.yaml','compose.tls.yaml','compose.workloads.yaml','compose.yaml'];
    for(const name of names)options.add(name);
    options.add('publication/worker.py');options.write();
    const result=copyValidationInputs(options.manifest,options.destination,options);
    assert.equal(result.status,'passed');assert.equal(result.files,7);
    for(const name of [...names,'publication/worker.py'])assert.deepEqual(fs.readFileSync(path.join(result.directory,name)),Buffer.from([0,255,13,10]));
    assert.deepEqual(fs.readFileSync(path.join(options.workspace,'Dockerfile')),Buffer.from([0,255,13,10]));
}));
test('changed or missing source fails before creating a destination',()=>fixture(options=>{
    options.add('publication/worker.py');options.write();
    fs.writeFileSync(path.join(options.workspace,'publication/worker.py'),'changed');
    assert.throws(()=>copyValidationInputs(options.manifest,options.destination,options),/differs from frozen/);
    fs.unlinkSync(path.join(options.workspace,'publication/worker.py'));
    assert.throws(()=>copyValidationInputs(options.manifest,options.destination,options),/ENOENT/);
    assert.equal(fs.existsSync(path.join(options.workspace,options.destination)),false);
}));
test('existing copies and unrelated files are preserved',()=>fixture(options=>{
    options.add('worker.py');options.write();
    const target=path.join(options.workspace,options.destination);fs.mkdirSync(target);fs.writeFileSync(path.join(target,'keep'),'preserve');
    assert.throws(()=>copyValidationInputs(options.manifest,options.destination,options),/already exists/);
    assert.equal(fs.readFileSync(path.join(target,'keep'),'utf8'),'preserve');
}));
test('rejects malformed, duplicate, escaping and private entries',()=>fixture(options=>{
    options.add('worker.py');
    for(const entries of [[],[{}],[{...options.inputs[0],bytes:-1}],[{...options.inputs[0],sha256:'invalid'}],
        [options.inputs[0],options.inputs[0]],[options.inputs[0],{...options.inputs[0],path:'WORKER.PY'}],
        ...['../outside','/absolute','C:/absolute','a/../worker.py','environment.env','.env','profile/cache','.telegram/.bot_token'].map(name=>[{...options.inputs[0],path:name}])]){
        options.write(entries);assert.throws(()=>copyValidationInputs(options.manifest,options.destination,options));
    }
    options.write();
    assert.throws(()=>copyValidationInputs(options.manifest,'data/reports',options),/report directory/);
    assert.throws(()=>copyValidationInputs(options.manifest,'../outside',options),/report directory/);
    assert.equal(fs.existsSync(path.join(options.workspace,options.destination)),false);
}));
test('invalid manifest JSON is rejected without echoing its contents',()=>fixture(options=>{
    fs.writeFileSync(path.join(options.workspace,options.manifest),'private malformed text');
    assert.throws(()=>copyValidationInputs(options.manifest,options.destination,options),error=>
        error.message==='Invalid input inventory JSON');
    fs.writeFileSync(path.join(options.workspace,options.manifest),'null');
    assert.throws(()=>copyValidationInputs(options.manifest,options.destination,options),/service inputs inventory/);
    assert.equal(fs.existsSync(path.join(options.workspace,options.destination)),false);
}));
test('source and destination junctions cannot redirect the copy',()=>fixture(options=>{
    options.add('source/file');options.write();
    const outside=path.join(options.temporary,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep'),'preserve');
    fs.symlinkSync(outside,path.join(options.workspace,'redirect'),'junction');
    options.write([{...options.inputs[0],path:'redirect/keep'}]);
    assert.throws(()=>copyValidationInputs(options.manifest,options.destination,options),/Symbolic/);
    options.write();fs.symlinkSync(outside,path.join(options.workspace,'data/reports/link'),'junction');
    assert.throws(()=>copyValidationInputs(options.manifest,'data/reports/link/new',options),/Symbolic/);
    assert.equal(fs.readFileSync(path.join(outside,'keep'),'utf8'),'preserve');assert.equal(fs.existsSync(path.join(outside,'new')),false);
}));
test('corrupted destination cannot report success',()=>fixture(options=>{
    options.add('worker.py');options.write();const original=fs.copyFileSync;
    fs.copyFileSync=(source,target,flags)=>{original(source,target,flags);fs.writeFileSync(target,'corrupt');};
    try{assert.throws(()=>copyValidationInputs(options.manifest,options.destination,options),/copy verification failed/);}
    finally{fs.copyFileSync=original;}
    assert.deepEqual(fs.readFileSync(path.join(options.workspace,'worker.py')),Buffer.from([0,255,13,10]));
}));
test('a manifest changed during copying cannot certify the old inventory',()=>fixture(options=>{
    options.add('worker.py');options.write();const original=fs.copyFileSync;
    fs.copyFileSync=(source,target,flags)=>{original(source,target,flags);options.write([]);};
    try{assert.throws(()=>copyValidationInputs(options.manifest,options.destination,options),/manifest changed/);}
    finally{fs.copyFileSync=original;}
}));
