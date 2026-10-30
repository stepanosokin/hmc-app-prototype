import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';

const directory=resolve(process.argv[2]),root=resolve('.');
assert.ok(directory.startsWith(resolve('data/reports/contours74')+sep));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=readFileSync(directory+'/validation.json'),report=JSON.parse(bytes);
const reference=JSON.parse(readFileSync(directory+'/native-reference.json'));
assert.equal(report.status,'passed');assert.equal(reference.status,'passed');
const differences=[];
for(const [file,expected] of Object.entries(report.inputs)){
    const target=resolve(file);assert.ok(target.startsWith(root+sep));
    if(hash(readFileSync(target))!==expected)differences.push(file);
}
assert.deepEqual(differences,[],'Frozen browser inputs still match the working sources');
const tours=report.states.filter(s=>s.name.startsWith('tour-'));
assert.equal(new Set(tours.map(s=>s.displayed.model+'/'+s.displayed.field)).size,29);
for(const state of report.states){
    assert.ok(state.contours.labels.length<=7);
    assert.equal(state.contours.selection,state.displayed.selection);
    assert.ok(state.ui.probe.peak_managed_bytes<=128*1024**2);
    const match=state.name.match(/^(?:1440|360|640)-(mercator|orthographic|laea|laea-rf)-(?:dark|light)-(?:system|courier)$/);
    if(match)assert.equal(state.contours.view.mode,{mercator:'mercator',orthographic:'hmc:orthographic',laea:'EPSG:3576','laea-rf':'hmc:laea-rf'}[match[1]]);
}
const pressure=report.states.find(s=>s.name==='pressure-point');
assert.equal(pressure.point.units,'Pa');
assert.ok(pressure.ui.points.some(text=>text.includes('гПа')&&Math.abs(Number.parseFloat(text.replace(',','.'))-pressure.point.value/100)<=.01),'Displayed pressure is converted while the point API remains in Pa');
for(const width of [1440,360,640]){
    const initial=report.states.find(s=>s.name===width+'-temperature'),next=report.states.find(s=>s.name===width+'-next');
    assert.notEqual(next.displayed.valid_time,initial.displayed.valid_time);
}
for(const state of reference.states){
    const actual=report.states.find(s=>s.name===state.state);assert.ok(actual);
    assert.equal(state.selection,actual.displayed.selection);
    assert.equal(state.samples,actual.contours.stats.numeric_samples.length);
}
assert.equal(report.network.status,'passed');
assert.equal(report.cleanup.browser_processes_remaining,0);assert.equal(report.cleanup.profile_removed,true);assert.equal(report.cleanup.test_proxy_closed,true);
const result={status:'passed',report_sha256:hash(bytes),fields:29,screenshots:report.screenshots.length,native_samples:reference.samples,
    projected_points:reference.projected_points,native_nodes:reference.states.reduce((n,s)=>n+(s.viewport_native_nodes_checked||0),0),
    frozen_input_differences:differences,max_labels:Math.max(...report.states.map(s=>s.contours.labels.length)),
    max_managed_bytes:Math.max(...report.states.map(s=>s.ui.probe.peak_managed_bytes)),cleanup:'Read-only source/report checks; no test resources created'};
copyFileSync(new URL(import.meta.url),directory+'/verification-program.mjs');
writeFileSync(directory+'/verification.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
