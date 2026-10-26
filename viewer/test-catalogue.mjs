import test from 'node:test';
import assert from 'node:assert/strict';
import {compactGroups} from './catalogue.ts';

const template=(field,extra={})=>({model:'ENA',run:'ENA/2026-10-21T00:00:00Z',field:'GRIB2:'+field.repeat(64),
    level:10,native_grid_sha256:'grid',member:null,units:'m s**-1',fixture:'actual',native_version:3,
    field_profile:'grib2-fields/1',...extra});
function fixture(){return {version:'compact/1',templates:[template('a',{wind_axis:'u',wind_pair:'c'.repeat(64),uv_relative_to_grid:false}),
    template('b',{wind_axis:'v',wind_pair:'c'.repeat(64),uv_relative_to_grid:false})],
    batches:[{template:0,key:'u0',valid_time:'2026-10-21T00:00:00Z'},{template:1,key:'v0',valid_time:'2026-10-21T00:00:00Z'},
        {template:0,key:'u2',valid_time:'2026-10-21T02:00:00Z'},{template:1,key:'v2',valid_time:'2026-10-21T02:00:00Z'}],
    revisions:[{revision:'old',completeness:'unknown',batches:[0,1]},{revision:'new',completeness:'unknown',batches:[0,1,2,3]}]};}

test('compact catalogue preserves old revisions, missing hours and exact U/V identity',()=>{
    const groups=compactGroups(fixture()),u=groups.find(g=>g.selection.revision==='new'&&g.selection.wind_axis==='u');
    assert.equal(groups.length,4);assert.equal(u.times.length,3);assert.equal(u.times[1],null);
    assert.equal(u.times[2].selection,'new.u2');assert.equal(u.times[2].wind_v.selection,'new.v2');
    assert.equal(u.times[2].wind_v.revision,'new');
    assert.equal(u.times[2].native_display,'/api/v1/selections/new.u2/display/3/native.json');
    assert.equal(groups.find(g=>g.selection.revision==='old'&&g.selection.wind_axis==='u').times.length,1);
});

test('orientation mismatch never pairs wind; interval and unknown units survive',()=>{
    const body=fixture();body.templates[1].uv_relative_to_grid=true;
    body.batches[0].interval={start:'2026-10-20T23:00:00Z',end:'2026-10-21T00:00:00Z',statistical_process:1};
    body.templates[0].units='unknown';
    const old=compactGroups(body).find(g=>g.selection.revision==='old'&&g.selection.wind_axis==='u');
    assert.equal(old.selection.wind_v,undefined);assert.equal(old.selection.units,'unknown');
    assert.deepEqual(old.selection.interval,body.batches[0].interval);
});

test('a correction labels the whole group without splitting inherited batches',()=>{
    const body=fixture();body.templates.push({...body.templates[0],fixture:'correction'});
    body.batches[2].template=2;
    const groups=compactGroups(body,true),u=groups.find(g=>g.selection.revision==='new'&&g.selection.wind_axis==='u');
    assert.equal(groups.length,4);assert.equal(u.selection.fixture,'correction');
    assert.equal(u.times[0].fixture,'actual');assert.equal(u.times[2].fixture,'correction');
    assert.ok(compactGroups(body).every(g=>g.selection.revision==='old'));
});

test('full82 normalized references hydrate on demand and survive cache eviction',()=>{
    const body={version:'compact/1',templates:[],batches:[],revisions:[]};
    for(let f=0;f<30;f++)body.templates.push(template('a',{field:'GRIB2:'+f.toString(16).padStart(64,'0')}));
    for(let hour=0;hour<82;hour++){
        for(let f=0;f<30;f++)body.batches.push({template:f,key:'k'+hour+'-'+f,valid_time:new Date(Date.UTC(2026,9,21,hour)).toISOString()});
        body.revisions.push({revision:'r'+hour,completeness:'unknown',batches:Array.from({length:(hour+1)*30},(_,i)=>i)});
    }
    const groups=compactGroups(body);assert.equal(groups.length,2460);
    const first=groups[0],held=first.times;
    for(const group of groups.slice(1,7))assert.ok(group.times.length);
    assert.deepEqual(first.times,held);assert.notEqual(first.times,held);
    assert.equal(first.times.length,82);assert.equal(held[81].selection,'r81.k81-29');
});
