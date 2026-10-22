import test from 'node:test';
import assert from 'node:assert/strict';
import {restrictRuntimeNetwork} from './viewer-network.mjs';

const origin='http://127.0.0.1:8140';
const invalid=()=>new Error(JSON.stringify({code:-32602,message:'Invalid InterceptionId.'}));
async function fixture(failId){
    const report={},calls=[];
    const guard=await restrictRuntimeNetwork(async(method,args)=>{
        calls.push({method,args});if(failId&&args?.requestId===failId)throw invalid();
    },origin,report);
    const request=(id,url,networkId=id)=>guard.event({method:'Fetch.requestPaused',params:{requestId:id,networkId,request:{url},resourceType:'Fetch'}});
    await guard.start();
    request('local',origin+'/');
    for(const name of ['page','worker','nested-worker'])request(name,'https://hmc-runtime-check.invalid/'+name);
    return {guard,report,calls,request};
}
test('same origin continues; all external worker/page probes are blocked',async()=>{
    const {guard,report,calls}=await fixture();await guard.finish();
    assert.equal(report.network.status,'passed');assert.equal(calls.filter(c=>c.method==='Fetch.failRequest').length,3);
});
test('only matching confirmed local cancellation retires an invalid interception',async()=>{
    const {guard,report,request}=await fixture('retired');request('retired',origin+'/field','network-7');
    // The network event may follow the failed continuation promise.
    await new Promise(resolve=>setImmediate(resolve));
    guard.event({method:'Network.loadingFailed',params:{requestId:'network-7',canceled:true}});
    await guard.finish();assert.deepEqual(report.network.retired_interceptions,[{
        request_id:'retired',network_id:'network-7',url:origin+'/field',canceled:true}]);
});
for(const [name,id,canceled] of [['unconfirmed','retired',false],['wrong network ID','other',true]])
    test(name+' remains fatal',async()=>{
        const {guard,request}=await fixture('retired');request('retired',origin+'/field','retired');
        guard.event({method:'Network.loadingFailed',params:{requestId:id,canceled}});
        await assert.rejects(guard.finish(),/Invalid InterceptionId/);
    });
test('external invalid interception remains fatal even with a cancellation receipt',async()=>{
    const {guard,request}=await fixture('external');request('external','https://public.invalid/app.js');
    guard.event({method:'Network.loadingFailed',params:{requestId:'external',canceled:true}});
    await assert.rejects(guard.finish(),/Invalid InterceptionId/);
});
test('successfully blocked application dependency remains fatal',async()=>{
    const {guard,request}=await fixture();request('external','https://public.invalid/app.js');
    await assert.rejects(guard.finish(),/No application dependency/);
});
