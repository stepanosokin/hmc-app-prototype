import test from 'node:test';
import assert from 'node:assert/strict';
import {windAtTime,windGroups,windVariant,windLevel,windValue,windBarb} from './wind-values.ts';

test('overlay requires exact run/revision/member/time and a compatible U/V pair',()=>{
    const source={model:'M',run:'r',revision:'v',member:null};
    const u={...source,units:'m s**-1',wind_axis:'u',wind_v:{},level:10,field_level_type:'heightAboveGround'};
    const group={selection:u,start:0,times:[u,null,u]};
    const others=['model','run','revision','member'].map(key=>({...group,selection:{...u,[key]:'other'}}));
    assert.deepEqual(windGroups([group,...others],source),[group]);
    assert.equal(windAtTime(group,3600000),undefined);
    assert.equal(windAtTime(group,1800000),undefined);
    assert.equal(windAtTime(group,7200000),u);
    assert.equal(windLevel(u),'10 м');
    assert.notEqual(windVariant(u),windVariant({...u,field_level_type:'isobaricInhPa'}));
    assert.equal(windVariant(u),windVariant({...u,member:1,level:'10'}));
    assert.equal(windLevel({...u,field_level_type:'isobaricInhPa',field_surfaces:[{type:100,value:85000}]}),'850 гПа');
});
test('strong-wind flags fit a bounded circle at every direction and keep all graduations',()=>{
    for(const speed of [5,30,90,200]){
        const barb=windBarb(speed);
        assert.ok(barb.radius<=13+1e-12);
        const [scale,,shift]=[...barb.transform.matchAll(/-?\d+(?:\.\d+)?/g)].map(m=>Number(m[0]));
        const bottom=Number(barb.shaft.match(/^M0 ([\d.-]+)/)[1]);
        for(const direction of [0,45,90,180,270])for(const x of [0,8])for(const y of [-13,bottom]){
            const angle=direction*Math.PI/180,px=x*scale,py=(y+shift)*scale;
            assert.ok(Math.abs(px*Math.cos(angle)-py*Math.sin(angle))<=13+1e-12);
            assert.ok(Math.abs(px*Math.sin(angle)+py*Math.cos(angle))<=13+1e-12);
        }
    }
    assert.equal((windBarb(200).pennants.match(/Z/g)||[]).length,7);
});
test('meteorological from-direction differs from airflow and calm has no direction',()=>{
    for(const [u,v,from] of [[1,0,270],[-1,0,90],[0,1,180],[0,-1,0],[1,1,225]]){
        const actual=windValue(u,v);assert.equal(actual.direction,from);assert.equal(actual.speed,Math.hypot(u,v));
    }
    assert.equal(windValue(0,0).direction,null);
    assert.equal(windValue(.01,.01).direction,null);
});
test('traditional flags combine 50/10/5 knots, round weak wind to a circle and bound invalid input',()=>{
    const knots=k=>k/1.9438444924406;
    const ten=windBarb(knots(10)),fifty=windBarb(knots(50)),sixtyFive=windBarb(knots(65));
    assert.ok(ten.feathers.includes('l7 3'));assert.equal(ten.pennants,'');
    assert.ok(fifty.pennants.endsWith('Z'));assert.equal(fifty.feathers,'');
    assert.ok(sixtyFive.pennants);assert.ok(sixtyFive.feathers.includes('l7 3'));assert.ok(sixtyFive.feathers.includes('l3.5 1.5'));
    assert.equal(windBarb(NaN).shaft,'');assert.equal(windBarb(1).calm,true);
});
