import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PointSeries,pointValue} from './series.ts';
import {PublicationExpired} from './field.ts';
const a={selection:'a',model:'ICON-EU',run:'r',revision:'v',field:'T_G:surface:0',level:0,member:null,native_grid_sha256:'grid',units:'K',valid_time:'2026-10-15T01:00:00Z'};
const b={...a,selection:'b',valid_time:'2026-10-15T03:00:00Z'};
const group={key:'g',selection:a,start:Date.parse(a.valid_time),times:[a,null,b]};
const value=s=>({...s,value:280,reason:null,spatial_selection:'nearest-native-cell',source:{},cell:null});
test('a pinned point series retains successful times and retries only failures',async()=>{
    let fail=true,calls=[];
    const series=new PointSeries(async s=>{calls.push(s.selection);if(s===b&&fail)throw Error('503');return value(s);});
    await series.load(group,{lng:37,lat:55});
    assert.deepEqual(series.entries.map(e=>e.state),['value','missing','error']);
    fail=false;await series.retry();
    assert.deepEqual(calls,['a','b','b']);
    assert.deepEqual(series.entries.map(e=>e.state),['value','missing','value']);
    await series.load(group,{lng:37,lat:55});assert.equal(calls.length,3);
});
test('obsolete point responses cannot replace a new series and requests are serial',async()=>{
    let release,active=0,maximum=0;
    const held=new Promise(resolve=>{release=resolve;});
    const series=new PointSeries(async(s,p)=>{active++;maximum=Math.max(maximum,active);if(p.lng===37)await held;active--;return value(s);});
    const old=series.load(group,{lng:37,lat:55});
    const next=series.load(group,{lng:38,lat:56});await next;release();await old;
    assert.ok(series.key.startsWith('[38,56,'));
    assert.deepEqual(series.entries.map(e=>e.state),['value','missing','value']);
    assert.equal(series.requests,2);
    // Cancellation-ignoring transport overlaps only the retired in-flight request.
    assert.equal(maximum,2);
});
test('expiry clears values, stops the queue and cannot be retried under the same identity',async()=>{
    const series=new PointSeries(async s=>{if(s===b)throw new PublicationExpired();return value(s);});
    await series.load(group,{lng:37,lat:55});assert.equal(series.expired,true);
    assert.ok(series.entries.every(e=>!e.result));await series.retry();
    await series.load(group,{lng:37,lat:55});assert.equal(series.requests,2);
});
test('new revision, grid and member invalidate the series; nodata differs from outside coverage',async()=>{
    const series=new PointSeries(async s=>({...value(s),value:null,reason:s.selection==='a'?'outside_coverage':'native_nodata'}));
    await series.load(group,{lng:37,lat:55});
    assert.deepEqual(series.entries.map(e=>e.state),['outside_coverage','missing','native_nodata']);
    const key=series.key;
    await series.load({...group,times:[{...a,revision:'new',native_grid_sha256:'new-grid',member:'1'}]}, {lng:37,lat:55});
    assert.notEqual(series.key,key);assert.equal(series.requests,1);
});
test('canonical point responses must match all field dimensions and exact nearest-cell semantics',async()=>{
    const original=globalThis.fetch;
    const correct={...value(a),identity:a,temporal_selection:'exact'};
    try{
        globalThis.fetch=async()=>Response.json(correct);
        assert.equal((await pointValue(a,{lng:37,lat:55},new AbortController().signal)).value,280);
        for(const key of ['model','level','native_grid_sha256','member','valid_time']){
            globalThis.fetch=async()=>Response.json({...correct,identity:{...a,[key]:'wrong'}});
            await assert.rejects(pointValue(a,{lng:37,lat:55},new AbortController().signal),/Несогласованное/);
        }
        globalThis.fetch=async()=>Response.json({...correct,temporal_selection:'interpolated'});
        await assert.rejects(pointValue(a,{lng:37,lat:55},new AbortController().signal),/Несогласованное/);
    }finally{globalThis.fetch=original;}
});
test('an atomically accepted point seeds its new revision without requesting that time again',async()=>{
    const calls=[];
    const series=new PointSeries(async s=>{calls.push(s.selection);return value(s);});
    const initial=value(b);
    await series.load(group,{lng:37,lat:55},initial);
    assert.deepEqual(calls,['a']);assert.equal(series.entries[2].result,initial);
    assert.deepEqual(series.entries.map(e=>e.state),['value','missing','value']);
});
