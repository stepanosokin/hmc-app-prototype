import {test} from 'node:test';
import assert from 'node:assert/strict';
import {json} from './field.ts';

test('field metadata and canonical point requests share two gateway slots; queued cancellation sends nothing',async()=>{
    const original=globalThis.fetch,pending=[];let active=0,maximum=0,calls=0;
    globalThis.fetch=async()=>{
        calls++;active++;maximum=Math.max(maximum,active);
        await new Promise(resolve=>pending.push(resolve));active--;return Response.json({ok:true});
    };
    const controllers=Array.from({length:5},()=>new AbortController());
    const requests=controllers.map((c,i)=>json('/api/v1/'+(i%2?'point':'catalogue'),c.signal));
    const cancelled=assert.rejects(requests[2],{name:'AbortError'});
    try{
        await new Promise(resolve=>setTimeout(resolve,10));controllers[2].abort();
        for(let round=0;round<5;round++){
            pending.splice(0).forEach(resolve=>resolve());await new Promise(resolve=>setTimeout(resolve,10));
        }
        await cancelled;await Promise.all(requests.filter((_,i)=>i!==2));
        assert.equal(maximum,2);assert.equal(calls,4);
    }finally{pending.splice(0).forEach(resolve=>resolve());globalThis.fetch=original;}
});
