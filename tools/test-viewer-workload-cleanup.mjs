import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForWorkloadBrowserExit} from './viewer-workload-cleanup.mjs';

test('workload retirement waits for the owned profile to disappear and retains observations',async()=>{
    const observations=[{phase:'legacy one-shot',count:1,processes:null}];
    const inventories=[[{ProcessId:42,ParentProcessId:40,Name:'chrome.exe'}],[]];
    await waitForWorkloadBrowserExit('owned-profile',observations,async()=>inventories.shift(),1000);
    assert.deepEqual(observations.map(item=>item.count),[1,1,0]);
    assert.equal(observations[1].processes[0].ProcessId,42);
    assert.ok(observations.slice(1).every(item=>Number.isFinite(Date.parse(item.observed_at))));
});

test('a persistent owned process remains a cleanup failure',async()=>{
    const observations=[];
    await assert.rejects(waitForWorkloadBrowserExit('owned-profile',observations,
        async()=>[{ProcessId:42,Name:'chrome.exe'}],30),/deadline exceeded/);
    assert.ok(observations.length>0&&observations.every(item=>item.count===1));
});

for(const message of ['CIM query failed','CIM query timed out'])test(message+' cannot confirm cleanup',async()=>{
    const observations=[];
    await assert.rejects(waitForWorkloadBrowserExit('owned-profile',observations,
        async()=>{throw Error(message);}),new RegExp(message));
    assert.ok(observations.at(-1).inventory_error.includes(message));
});

test('a zero inventory arriving beyond the deadline is not accepted',async()=>{
    const observations=[];
    await assert.rejects(waitForWorkloadBrowserExit('owned-profile',observations,async()=>{
        await new Promise(resolve=>setTimeout(resolve,30));return [];
    },5),/deadline exceeded/);
    assert.equal(observations.at(-1).count,0,'Late result is preserved without converting it to success');
});
