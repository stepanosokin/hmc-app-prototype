import test from 'node:test';
import assert from 'node:assert/strict';
import {MAP_RESOURCE_BUDGET_BYTES,mapResourceBudgetBytes,parseViewerConfigModule} from './resource-budget.js';
import {NativeLayer} from './native-layer.js';

function layer(width,height,maximum=8192){
    return {gl:{MAX_TEXTURE_SIZE:1,MAX_ARRAY_TEXTURE_LAYERS:2,getParameter:()=>maximum},
        map:{getCanvas:()=>({width,height})},metadata:{},blockCount:1};
}

test('approved map resource allowance is 256 MiB',()=>{
    assert.equal(MAP_RESOURCE_BUDGET_BYTES,256*1024**2);
});
test('project budget accepts explicit integer MiB and rejects invalid/overflowing values',()=>{
    assert.equal(mapResourceBudgetBytes(512),512*1024**2);
    for(const value of [0,-1,1.5,'512',null,Infinity,Number.MAX_SAFE_INTEGER])assert.throws(()=>mapResourceBudgetBytes(value));
    assert.deepEqual(parseViewerConfigModule('export const viewerConfig = {"map_memory_mib":512};\n'),{map_memory_mib:512});
    for(const source of ['export const viewerConfig = {"map_memory_mib":null};','export const viewerConfig = {"secret":1};','export const viewerConfig = {}; alert(1);'])assert.throws(()=>parseViewerConfigModule(source));
});
test('GPU allocation may exceed the former 128 MiB but remains bounded',()=>{
    const bytes=NativeLayer.prototype.checkBudget.call(layer(2800,2000));
    assert.ok(bytes>128*1024**2&&bytes<=MAP_RESOURCE_BUDGET_BYTES);
    assert.throws(()=>NativeLayer.prototype.checkBudget.call(layer(3500,3500)),/бюджет/);
    assert.throws(()=>NativeLayer.prototype.checkBudget.call(layer(4200,1,4096)),/бюджет/);
});
