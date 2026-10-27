import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {projectionControls} from '../tools/viewer-projection-controls.mjs';

const html='<small id="compactProjection">LAEA - RF</small><select id="projection">'+
    '<option value="mercator">Mercator</option><option value="laea-rf" selected>LAEA - RF</option></select>';
const main="type Mode='mercator'|'laea-rf'; let mode:Mode='laea-rf';";

test('production selector, mode union, initial mode and compact label agree',async()=>{
    projectionControls(await readFile(new URL('./index.html',import.meta.url),'utf8'),
        await readFile(new URL('./main.ts',import.meta.url),'utf8'));
});
test('projection preflight accepts a consistent fixture',()=>{
    assert.deepEqual(projectionControls(html,main),{initial:'laea-rf',label:'LAEA - RF',ids:['mercator','laea-rf']});
});
for(const [name,brokenHtml,brokenMain,error] of [
    ['old compact label',html.replace('<small id="compactProjection">LAEA - RF','<small id="compactProjection">Mercator'),main,/compact projection label/],
    ['old TypeScript default',html,main.replace("mode:Mode='laea-rf'","mode:Mode='mercator'"),/initial projections/],
    ['implicit browser default',html.replace(' selected',''),main,/one explicit initial/],
    ['two selected options',html.replace('value="mercator"','value="mercator" selected'),main,/one explicit initial/],
    ['unsupported option',html.replace('value="mercator"','value="unknown"'),main,/supported modes/],
    ['duplicate option',html.replace('value="mercator"','value="laea-rf"'),main,/Duplicate/],
    ['damaged Unicode label',html.replaceAll('LAEA - RF','LAEA - ??'),main,/Invalid projection option/],
])test('projection preflight rejects '+name,()=>assert.throws(()=>projectionControls(brokenHtml,brokenMain),error));

test('service runner executes projection preflight before Docker inventory',async()=>{
    const runner=await readFile(new URL('../tools/run-weather-viewer.ps1',import.meta.url),'utf8');
    const preflight=runner.indexOf("& node --test 'viewer/test-projection-controls.mjs'");
    const docker=runner.indexOf('& docker');
    assert.ok(preflight>=0&&docker>preflight,'Projection contract must fail before Docker access');
    assert.match(runner.slice(preflight,docker),/if\s*\(\$LASTEXITCODE\s*-ne\s*0\)\s*\{\s*throw/);
});
