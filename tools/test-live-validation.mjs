import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {checkLiveHttp} from './check-live-http.mjs';
import {compareLiveResources} from './compare-live-resources.mjs';

async function report(run){
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hmc-live-http-'));
    try{await run(directory);}finally{
        assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
        assert.match(path.basename(directory),/^hmc-live-http-/);
        fs.rmSync(directory,{recursive:true,force:true});assert.equal(fs.existsSync(directory),false);
    }
}
test('first HTTP failure retains status, timing, request ID and body; no retry',()=>report(async directory=>{
    let requests=0;
    const result=await checkLiveHttp('http://127.0.0.1:8140/gis/v1/wms',directory,async()=>{
        requests++;return new Response('{"code":"ResourceLimit"}',{status:504,headers:{'x-request-id':'first-failure','content-type':'application/json','retry-after':'2'}});
    });
    assert.equal(requests,1);assert.equal(result.passed,false);assert.equal(result.status,504);
    assert.equal(result.request_id,'first-failure');assert.equal(result.retry_after,'2');assert.ok(result.duration_ms>=0);
    assert.equal(fs.readFileSync(path.join(directory,'body.bin'),'utf8'),'{"code":"ResourceLimit"}');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'result.json'),'utf8')),result);
    await assert.rejects(checkLiveHttp(result.url,directory,()=>{throw Error('must not run');}),/пустой каталог/);
}));
test('successful responses retain binary bytes and request policy',()=>report(async directory=>{
    const bytes=Buffer.from([0,255,13,10]);
    const result=await checkLiveHttp('http://127.0.0.1:8141/gis/v1/wms?snapshot=public',directory,async(url,options)=>{
        assert.equal(options.redirect,'error');assert.ok(options.signal);return new Response(bytes,{status:200});
    });
    assert.equal(result.passed,true);assert.deepEqual(fs.readFileSync(path.join(directory,'body.bin')),bytes);
}));
test('network failure and interrupted body preserve diagnostics',async()=>{
    await report(async directory=>{
        const result=await checkLiveHttp('http://127.0.0.1:8140/',directory,async()=>{throw Error('private diagnostic');});
        assert.equal(result.status,null);assert.equal(result.passed,false);assert.ok(result.error);
        assert.ok(!fs.readFileSync(path.join(directory,'result.json'),'utf8').includes('private diagnostic'));
    });
    await report(async directory=>{
        const result=await checkLiveHttp('http://127.0.0.1:8140/',directory,async()=>({status:200,headers:new Headers({'x-request-id':'interrupted'}),arrayBuffer:async()=>{throw Error('broken stream');}}));
        assert.equal(result.status,200);assert.equal(result.request_id,'interrupted');assert.equal(result.passed,false);
    });
});
test('public probes reject credentials and nonlocal URLs before fetch',async()=>{
    for(const url of ['https://example.com/','http://127.0.0.1:8140/?api_key=secret','http://user:secret@127.0.0.1:8140/'])
        await assert.rejects(checkLiveHttp(url,'unused',()=>{throw Error('must not run');}),/без секретов/);
});

const container=()=>({name:'/live-api-1',id:'old',state:'running',mounts:[
    {type:'bind',source:'D:\\Project\\publication',destination:'/app/publication',read_only:true},
    {type:'volume',name:'live_assets',source:'/var/lib/docker/volumes/live_assets/_data',destination:'/assets'}
],networks:['live_edge','live_publication']});
test('mount order and Docker Desktop Windows path aliases preserve identity',()=>{
    const old=container(),current=structuredClone(old);current.id='new';current.networks.reverse();current.mounts.reverse();
    current.mounts[1].source='/run/desktop/mnt/host/d/Project/publication';
    assert.equal(compareLiveResources([old],[current],[old.name]).status,'passed');
    assert.deepEqual(compareLiveResources([old],[current],[]).errors,['id '+old.name]);
});
test('changed volumes, destinations, Linux path case, networks, missing or extra containers fail',()=>{
    const old=container();
    for(const change of [c=>{c.mounts[1].name='other';},c=>{c.mounts[0].destination='/other';},c=>{c.mounts[0].read_only=false;},c=>{c.mounts[1].source='/var/lib/docker/volumes/LIVE_assets/_data';},c=>{c.networks=['other'];},c=>{c.state='exited';}]){
        const current=structuredClone(old);change(current);assert.equal(compareLiveResources([old],[current],[]).status,'failed');
    }
    assert.equal(compareLiveResources([old],[],[]).status,'failed');
    assert.equal(compareLiveResources([old],[old,{...old,name:'/unexpected'}],[]).status,'failed');
    assert.throws(()=>compareLiveResources([old,old],[old],[]),/Duplicate/);
    assert.throws(()=>compareLiveResources([old],[old],['/unknown']),/Unknown/);
    assert.throws(()=>compareLiveResources({},[],[]),/arrays/);
});
