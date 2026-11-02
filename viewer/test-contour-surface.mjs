import test from 'node:test';
import assert from 'node:assert/strict';
import {gaussianSurface,contourSurface} from './contour-surface.js';

function grid(width,height,value=0){return {width,height,values:new Float32Array(width*height).fill(value),valid:new Uint8Array(width*height).fill(1)};}
function metadata(source,level=8){return {display_level:level,grid:{shape_yx:[source.height,source.width],spacing_degrees_xy:[1,1],
    outer_cell_edges_wsen:[-.5,-.5,source.width-.5,source.height-.5]}};}

test('Gaussian preserves zero and constant regions separated by missing cells without changing source arrays',()=>{
    const input=grid(17,17);
    for(let y=0;y<17;y++)for(let x=0;x<17;x++){
        if(x===8)input.valid[y*17+x]=0;
        if(x>8)input.values[y*17+x]=700;
    }
    const values=input.values.slice(),valid=input.valid.slice(),actual=gaussianSurface(input);
    assert.deepEqual(input.values,values);assert.deepEqual(input.valid,valid);assert.deepEqual(actual.valid,valid);
    assert.deepEqual(actual.values,values,'No smoothing across a complete NoData barrier, including boundary normalization');
    assert.notEqual(actual.values,input.values);
});

test('Gaussian impulse matches independent separable weights and has bounded support',()=>{
    const input=grid(17,17);input.values[8*17+8]=1;const actual=gaussianSurface(input);
    const weight=offset=>Math.exp(-(offset**2)/(2*1.2**2));
    const total=Array.from({length:9},(_,i)=>weight(i-4)).reduce((a,b)=>a+b,0);
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)
        assert.ok(Math.abs(actual.values[(8+dy)*17+8+dx]-weight(dx)*weight(dy)/total**2)<1e-8);
    assert.equal(actual.values[8*17+3],0);assert.equal(actual.values[3*17+8],0);
});

test('spline keeps original end-node centres, constants, local bounds and continuous knot slopes',()=>{
    const input=grid(17,17,7);
    for(const [level,subdivision] of [[1,1],[2,2],[4,4],[8,4]]){
        const source=metadata(input,level),before=structuredClone(source),surface=contourSurface(source,input),g=surface.metadata.grid;
        assert.deepEqual(source,before);assert.equal(surface.subdivision,subdivision);
        assert.equal(g.outer_cell_edges_wsen[0]+g.spacing_degrees_xy[0]/2,0);
        assert.equal(g.outer_cell_edges_wsen[2]-g.spacing_degrees_xy[0]/2,16);
        for(const [x,y] of [[0,0],[.25,.75],[8*subdivision,8*subdivision],[16*subdivision,16*subdivision]])assert.ok(Math.abs(surface.sample(x,y)-7)<1e-12);
    }
    input.values.fill(0);input.values[8*17+8]=1;
    const surface=contourSurface(metadata(input),gaussianSurface(input)),h=.001;
    const left=(surface.sample(32,32)-surface.sample(32-h,32))/h,right=(surface.sample(32+h,32)-surface.sample(32,32))/h;
    assert.ok(Math.abs(left-right)<1e-4);
    for(let y=0;y<=64;y++)for(let x=0;x<=64;x++){const value=surface.sample(x,y);assert.ok(value>=0&&value<=1);}
});

test('streamed spline blocks agree at halos and keep missing and padding values invalid',()=>{
    const input=grid(70,4,0);input.valid[1*70+64]=0;
    for(let y=0;y<4;y++)for(let x=8;x<70;x++)input.values[y*70+x]=x+10*y;
    const surface=contourSurface(metadata(input),input);assert.equal(surface.count,2);
    assert.equal(surface.sample(256,4),undefined);assert.equal(surface.sample(12,4),0);
    const blocks=[surface.block(0),surface.block(1)].map(buffer=>({values:new Float32Array(buffer,0,258*258),valid:new Uint8Array(buffer,258*258*4)}));
    for(let y=0;y<258;y++)for(let x=0;x<2;x++){
        assert.equal(blocks[0].values[y*258+256+x],blocks[1].values[y*258+x]);
        assert.equal(blocks[0].valid[y*258+256+x],blocks[1].valid[y*258+x]);
    }
    assert.equal(blocks[0].valid[5*258+13],1,'Valid zero remains data');
    assert.equal(blocks[0].valid[0],0,'Outer padding is missing');
    assert.equal(blocks[1].valid[5*258+1],0,'Missing spline contributor invalidates the output');
    for(const block of blocks)for(let i=0;i<block.valid.length;i++)if(!block.valid[i])assert.equal(block.values[i],0);
});
