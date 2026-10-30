import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sampleWind,earthWind} from './wind.ts';
import {publishedGroups,sameWindInterval} from './selection.ts';

test('wind pairing compares the entire averaging interval, independent of key order',()=>{
    const interval={start:'2026-10-30T00:00:00Z',end:'2026-10-30T06:00:00Z',statistical_process:0,time_increment:1};
    assert.ok(sameWindInterval({interval},{interval:{time_increment:1,statistical_process:0,end:interval.end,start:interval.start}}));
    assert.ok(sameWindInterval({},{interval:null}));
    assert.ok(!sameWindInterval({interval},{interval:{...interval,start:'2026-10-30T03:00:00Z'}}));
    assert.ok(!sameWindInterval({interval},{interval:{...interval,time_increment:2}}));
    assert.ok(!sameWindInterval({interval},{}));
});

function component(values){
    const bytes=new ArrayBuffer(332820),data=new Float32Array(bytes,0,258*258),mask=new Uint8Array(bytes,258*258*4);
    for(let r=0;r<2;r++)for(let c=0;c<2;c++){const i=(r+1)*258+c+1;data[i]=values[r*2+c];mask[i]=1;}
    return {metadata:{grid:{shape_yx:[2,2],outer_cell_edges_wsen:[0,0,2,2],spacing_degrees_xy:[1,1]},columns:[0,0]},blocks:[bytes]};
}
test('wind uses both components and never crosses a positive-weight missing cell',()=>{
    const data=component([2,4,6,8]);data.wind=component([-3,-3,-3,-3]);
    assert.deepEqual(sampleWind(data,[1,1]),{u:5,v:-3});
    new Uint8Array(data.wind.blocks[0],258*258*4)[2*258+2]=0;
    assert.equal(sampleWind(data,[1,1]),undefined);
    assert.deepEqual(sampleWind(data,[.5,.5]),{u:2,v:-3});
    assert.equal(sampleWind(data,[-.1,1]),undefined);
});
test('grid-relative wind rotates with the source axes; geographic wind keeps east/north',()=>{
    const data=component([5,5,5,5]);data.wind=component([-3,-3,-3,-3]);
    data.metadata.uv_relative_to_grid=false;
    assert.deepEqual(earthWind(data,[1,1],[0,0],xy=>[xy[1]-1,1-xy[0]]),{east:5,north:-3});
    data.metadata.uv_relative_to_grid=true;
    const actual=earthWind(data,[1,1],[0,0],xy=>[xy[1]-1,1-xy[0]]);
    assert.ok(Math.abs(actual.east+3)<1e-8);assert.ok(Math.abs(actual.north+5)<1e-8);
});
test('arrows pair only the same run revision time level grid member and orientation',()=>{
    const base={selection:'u',model:'ENA',run:'ENA/2026-10-21T06:00:00Z',revision:'r',field:'GRIB2:'+'a'.repeat(64),
        field_profile:'grib2-fields/1',level:10,valid_time:'2026-10-21T06:00:00Z',units:'m s**-1',state:'published',
        wind_axis:'u',wind_pair:'c'.repeat(64),uv_relative_to_grid:true,native_grid_sha256:'g',member:null};
    const v={...base,selection:'v',field:'GRIB2:'+'b'.repeat(64),wind_axis:'v'};
    assert.equal(publishedGroups([base,v]).find(g=>g.selection.selection==='u').selection.wind_v.selection,'v');
    for(const change of [{revision:'other'},{level:100},{native_grid_sha256:'other'},{member:1},{uv_relative_to_grid:false}]){
        const group=publishedGroups([base,{...v,...change}]).find(g=>g.selection.selection==='u');
        assert.equal(group.selection.wind_v,undefined);
    }
});
