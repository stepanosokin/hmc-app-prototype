import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {archiveValidation,sha256} from './archive-validation.mjs';

function fixture(run){
    const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'hmc-archive-test-'));
    const source='data/reports/run',directory=path.join(workspace,source),evidenceDirectory=path.join(workspace,'evidence');
    fs.mkdirSync(directory,{recursive:true});
    try{run({workspace,source,directory,evidenceDirectory});}
    finally{
        assert.equal(path.dirname(path.resolve(workspace)),path.resolve(os.tmpdir()));assert.match(path.basename(workspace),/^hmc-archive-test-/);
        fs.rmSync(workspace,{recursive:true,force:true});assert.equal(fs.existsSync(workspace),false);
    }
}
test('verified external copy retains binary bytes, excludes env/profile and preserves source',()=>fixture(options=>{
    const binary=path.join(options.directory,'snapshot.bin');fs.writeFileSync(binary,Buffer.from([0,255,13,10]));
    fs.writeFileSync(path.join(options.directory,'environment.env'),'do-not-copy');
    fs.mkdirSync(path.join(options.directory,'profile'));fs.writeFileSync(path.join(options.directory,'profile','state'),'private');
    const result=archiveValidation(options.source,'ticket/final',options),copy=path.join(result.archive,'snapshot.bin');
    assert.equal(result.files,1);assert.equal(result.excluded,2);assert.equal(sha256(copy),sha256(binary));
    const index=JSON.parse(fs.readFileSync(path.join(result.archive,'archive-index.json'),'utf8'));
    assert.deepEqual(index.files,[{path:'snapshot.bin',bytes:4,sha256:sha256(binary)}]);
    assert.equal(fs.existsSync(path.join(result.archive,'environment.env')),false);
    assert.equal(result.index_sha256,sha256(path.join(result.archive,'archive-index.json')));
    assert.throws(()=>archiveValidation(options.source,'ticket/final',options),/already exists/);
    assert.equal(sha256(copy),sha256(binary));
    if(process.platform==='win32'){
        const alternate=archiveValidation(options.directory.toLowerCase(),'ticket/case-insensitive',options);
        assert.equal(sha256(path.join(alternate.archive,'snapshot.bin')),sha256(binary));
    }
}));
test('escaping, overlapping and non-report paths are rejected',()=>fixture(options=>{
    for(const archive of ['../escape','.'])assert.throws(()=>archiveValidation(options.source,archive,options),/escapes/);
    assert.throws(()=>archiveValidation(options.source,path.join(options.evidenceDirectory,'absolute'),options),/relative/);
    assert.throws(()=>archiveValidation('.', 'final',options),/Expected a report/);
    assert.throws(()=>archiveValidation(options.source,'child',{...options,evidenceDirectory:options.directory}),/overlaps/);
}));
test('source and destination junctions cannot redirect evidence copies',()=>fixture(options=>{
    const outside=path.join(options.workspace,'unrelated');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'private'),'preserve');
    const link=path.join(options.directory,'link');fs.symlinkSync(outside,link,'junction');
    assert.throws(()=>archiveValidation(options.source,'source-link',options),/Symbolic/);fs.unlinkSync(link);
    fs.mkdirSync(options.evidenceDirectory);fs.symlinkSync(outside,path.join(options.evidenceDirectory,'redirect'),'junction');
    assert.throws(()=>archiveValidation(options.source,'redirect/final',options),/Symbolic/);
    assert.equal(fs.readFileSync(path.join(outside,'private'),'utf8'),'preserve');assert.equal(fs.existsSync(path.join(outside,'final')),false);
}));
test('corrupted copy cannot produce a verified index',()=>fixture(options=>{
    fs.writeFileSync(path.join(options.directory,'report.log'),'correct');
    const original=fs.copyFileSync;
    fs.copyFileSync=(source,destination)=>{original(source,destination);fs.writeFileSync(destination,'corrupt');};
    try{assert.throws(()=>archiveValidation(options.source,'failed',options),/verification failed/);}
    finally{fs.copyFileSync=original;}
    assert.equal(fs.existsSync(path.join(options.evidenceDirectory,'failed','archive-index.json')),false);
    assert.equal(fs.readFileSync(path.join(options.directory,'report.log'),'utf8'),'correct');
}));
