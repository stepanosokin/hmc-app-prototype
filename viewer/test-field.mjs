import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FieldLoader,localURL} from './field.ts';
const selection={selection:'a',model:'ICON-EU',run:'ICON-EU/2026-10-15T00:00:00Z',revision:'b',field:'T_G:surface:0',
    level:0,valid_time:'2026-10-15T01:00:00Z',units:'K',native_display:'/api/v1/selections/a/display/1/native.json'};
const metadata={contract:'hmc-native-display/1',contract_sha256:'3c245dada032f3cf4ee0f26e2c371e863ba0094a3c5f8de4e5f2c6af3ef4c1f0',
    selection:'a',identity:selection,selection_identity:['model','run','revision','field','level','valid_time'],
    grid:{shape_yx:[657,1377],spacing_degrees_xy:[.0625,.0625],outer_cell_edges_wsen:[-23.53125,29.46875,62.53125,70.53125]},
    crs:'urn:hmc:crs:icon-sphere-6371229',encoding:'f32',units:'K',stored_size:[258,258],
    columns:[0,5],rows:[0,2],url:'/api/v1/selections/a/display/1/native/{column}/{row}.f32'};
test('obsolete downloads cannot become an uploadable field even when transport ignores abort',async()=>{
    const original=globalThis.fetch;const loader=new FieldLoader();let release,active=0,maximum=0;
    const wait=new Promise(resolve=>{release=resolve;});
    globalThis.fetch=async url=>{
        if(url.endsWith('.json'))return Response.json(metadata);
        active++;maximum=Math.max(active,maximum);await wait;active--;
        return new Response(new ArrayBuffer(332820));
    };
    try{
        const result=loader.load(selection);
        await new Promise(resolve=>setTimeout(resolve,10));loader.cancel();release();
        await assert.rejects(result,{name:'AbortError'});assert.equal(maximum,2);
    }finally{globalThis.fetch=original;loader.cancel();}
});
test('all eighteen finite blocks are bounded and corrupt masks reject the whole field',async()=>{
    const original=globalThis.fetch,loader=new FieldLoader();let corrupt=false;
    globalThis.fetch=async url=>{
        if(url.endsWith('.json'))return Response.json(metadata);
        const bytes=new ArrayBuffer(332820);if(corrupt)new Uint8Array(bytes)[258*258*4]=2;
        return new Response(bytes);
    };
    try{const result=await loader.load(selection);assert.equal(result.blocks.length,18);assert.ok(result.bytes<8*1024**2);
        corrupt=true;await assert.rejects(loader.load(selection),/маска/);
    }finally{globalThis.fetch=original;loader.cancel();}
});
test('display addresses cannot send a browser to a third-party or organization endpoint',()=>{
    for(const url of ['https://example.org/api/v1/a','//example.org/api/v1/a','/org/api/v1/a','/api/v1/../org/a'])assert.throws(()=>localURL(url));
});
test('an entirely missing generic field loads without a colour range, but inconsistent metadata fails',async()=>{
    const original=globalThis.fetch,loader=new FieldLoader();
    const selected={...selection,field_profile:'grib2-fields/1'};
    const empty={...metadata,contract:'hmc-native-display/3',contract_sha256:'98c9e10367d9c4185647e22758c94913d8cc9d716561ff0b93f3b1dcd71db0eb',
        source_crs:{template:0},all_nodata:true,display_range:null,zero_transparent:false};
    globalThis.fetch=async url=>url.endsWith('.json')?Response.json(empty):new Response(new ArrayBuffer(332820));
    try{
        const result=await loader.load(selected);assert.equal(result.metadata.all_nodata,true);
        empty.all_nodata=false;await assert.rejects(loader.load(selected),/контракт/);
        empty.all_transparent=true;empty.zero_transparent=true;
        const transparent=await loader.load(selected);
        assert.equal(transparent.metadata.all_nodata,false);
        assert.equal(transparent.metadata.display_range,null);
    }finally{globalThis.fetch=original;loader.cancel();}
});
