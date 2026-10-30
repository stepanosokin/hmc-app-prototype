import test from 'node:test';
import assert from 'node:assert/strict';
import {windSpeed} from './wind-speed.ts';

test('native-cell speed combines masks, keeps calm and preserves U/V arrays',()=>{
    const component=values=>{const block=new ArrayBuffer(332820);new Float32Array(block,0,4).set(values);new Uint8Array(block,258*258*4,4).set([1,1,1,0]);return {blocks:[block],metadata:{},bytes:block.byteLength};};
    const data=component([3,0,-5,8]);data.wind=component([4,0,12,15]);
    new Uint8Array(data.wind.blocks[0],258*258*4)[2]=0;
    data.metadata.wind_palette={id:'wind',range:[0,100]};
    const result=windSpeed(data);
    assert.deepEqual([...new Float32Array(result.blocks[0],0,4)],[5,0,0,0]);
    assert.deepEqual([...new Uint8Array(result.blocks[0],258*258*4,4)],[1,1,0,0]);
    assert.deepEqual([...new Float32Array(data.blocks[0],0,4)],[3,0,-5,8]);
    assert.equal(result.metadata.zero_transparent,false);
    assert.equal(result.metadata.palette.id,'wind');
});
