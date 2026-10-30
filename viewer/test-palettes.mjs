import test from 'node:test';
import assert from 'node:assert/strict';
import {paletteThresholds} from './palettes.js';

test('representable GPU thresholds preserve physical comparisons at every temperature bin',()=>{
    const range=[193.15,328.15],thresholds=paletteThresholds(range,250);
    const storage=new Float32Array(1),bits=new Uint32Array(storage.buffer);
    for(let i=0;i<thresholds.length;i++){
        const physical=range[0]+(range[1]-range[0])*i/249;
        assert.ok(thresholds[i]>=physical);
        storage[0]=thresholds[i];bits[0]--;
        assert.ok(storage[0]<physical,'Previous float32 must remain below the physical boundary');
    }
    assert.ok(Math.fround(328.15)<thresholds[249],'Rounded source maximum must not be mistaken for the next colour');
});
