import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {checkViewerRuntime,compileViewerModules} from './check-viewer-runtime.mjs';

const modules=new Map([['main.js',Buffer.from('import "./contours.js";')],['contours.js',Buffer.from('export {};')]]);
const response=(body,status=200,mime='text/javascript')=>new Response(body,{status,headers:{'Content-Type':mime}});

test('checks every module against actual bytes, bypasses cache and rejects redirects',async()=>{
    const calls=[];
    const result=await checkViewerRuntime(modules,'http://127.0.0.1:8140',async(url,options)=>{
        calls.push(url);assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
        return response(modules.get(url.split('/').at(-1)));
    });
    assert.deepEqual(result,{status:'passed',modules:2,failures:[]});assert.equal(calls.length,2);
});

test('old main plus missing contour module reproduces the original live mismatch',async()=>{
    const result=await checkViewerRuntime(modules,'http://127.0.0.1:8140',async url=>url.endsWith('/main.js')?response('old main'):response('missing',404));
    assert.equal(result.status,'failed');assert.deepEqual(result.failures.map(x=>[x.module,x.reason]),[['main.js','bytes'],['contours.js','http']]);
    assert.equal(result.failures[1].status,404);
});

test('HTML fallback, HTTP 429, network and interrupted bodies remain distinct failures',async()=>{
    for(const [reason,fetcher] of [
        ['mime',async()=>response('<html>',200,'text/html')],
        ['http',async()=>response('limit',429)],
        ['network',async()=>{throw Error('Bearer secret-network');}],
        ['body',async()=>({status:200,headers:new Headers({'Content-Type':'application/javascript'}),arrayBuffer:async()=>{throw Error('secret-body');}})]
    ]){
        const result=await checkViewerRuntime(modules,'http://127.0.0.1:8140',fetcher);
        assert.equal(result.status,'failed');assert.ok(result.failures.every(x=>x.reason===reason));assert.ok(!JSON.stringify(result).includes('secret'));
    }
});

test('invalid origin and module paths cannot issue requests',async()=>{
    const forbidden=async()=>assert.fail('Unexpected request');
    for(const origin of ['https://example.org','http://127.0.0.1:8140/path','http://127.0.0.1:8140@evil'])
        await assert.rejects(checkViewerRuntime(modules,origin,forbidden),/origin/);
    await assert.rejects(checkViewerRuntime(new Map([['../escape.js','']]),'http://127.0.0.1:8140',forbidden),/путь/);
});

test('current TypeScript is emitted into memory without updating the runtime directory',()=>{
    const runtime=new URL('../data/viewer/build/',import.meta.url);
    const snapshot=()=>fs.existsSync(runtime)?fs.readdirSync(runtime).sort().map(name=>[name,fs.readFileSync(new URL(name,runtime)).toString('base64')]):[];
    const before=snapshot(),compiled=compileViewerModules();
    assert.ok(compiled.has('main.js'));assert.ok(compiled.has('contours.js'));assert.ok(compiled.has('contour-worker.js'));
    assert.match(compiled.get('main.js').toString(),/ContourOverlay/);assert.deepEqual(snapshot(),before);
});
