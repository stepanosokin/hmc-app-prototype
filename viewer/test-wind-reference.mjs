import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {earthComponents} from './wind.ts';
import {nativePosition} from './source-crs.js';
import {windValue} from './wind-values.ts';

const reference=JSON.parse(readFileSync(new URL('../tests/fixtures/wind/rotated-reference.json',import.meta.url),'utf8'));
test('U/V agree with 120 independent PROJ references including rotated poles and nonzero grid angle',()=>{
    for(const [index,item] of reference.cases.entries()){
        const spec=reference.specs[item.spec],geographic=nativePosition(spec,item.xy,true),expected=item.expected;
        assert.ok(Math.abs((geographic[0]-expected.geographic[0]+540)%360-180)<1e-8,`longitude case ${index}`);
        assert.ok(Math.abs(geographic[1]-expected.geographic[1])<1e-8,`latitude case ${index}`);
        const actual=earthComponents(item.u,item.v,{source_crs:spec,uv_relative_to_grid:item.grid_relative},item.xy,geographic,p=>nativePosition(spec,p,true));
        assert.ok(actual,`defined case ${index}`);
        assert.ok(Math.abs(actual.east-expected.east)<.00001,`east case ${index}: ${actual.east} vs ${expected.east}`);
        assert.ok(Math.abs(actual.north-expected.north)<.00001,`north case ${index}`);
        const value=windValue(actual.east,actual.north);
        assert.ok(Math.abs(value.speed-expected.speed)<1e-8,`speed invariant case ${index}: ${value.speed} vs ${expected.speed}`);
        if(expected.direction===null)assert.equal(value.direction,null);
        else assert.ok(Math.abs((value.direction-expected.direction+540)%360-180)<.0001,`from-direction case ${index}`);
    }
});
