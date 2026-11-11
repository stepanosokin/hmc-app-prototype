import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runners=['tools/viewer-point-series.mjs','tools/viewer-series-synthetic.mjs','tools/viewer-settings.mjs'];
const mercatorPixel=/proj4\(\s*['"]EPSG:4326['"]\s*,\s*['"]EPSG:3857['"]\s*\)\.forward/;
const sharedPicker=/\b(?:nativePointPixel|geographicPointPixel)\(/;

test('T13 point runners pick map points through projection-aware helpers',()=>{
    for(const file of runners){
        const source=fs.readFileSync(file,'utf8');
        assert.doesNotMatch(source,mercatorPixel,file+' must not hand-roll Mercator pixels');
        assert.match(source,sharedPicker,file+' must use a shared map picker');
    }
});
