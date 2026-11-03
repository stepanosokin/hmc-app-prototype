import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {selectViewerOption} from './viewer-select-option.mjs';

function fixture(values=['0','1','7']){
    const changes=[],control={options:values.map(value=>({value})),value:'0',dispatchEvent:event=>changes.push(event)};
    const evaluate=expression=>runInNewContext(expression,{document:{querySelector:s=>s==='#time'?control:null},Event:class {constructor(type,options){this.type=type;this.bubbles=options.bubbles;}}});
    return {changes,control,evaluate};
}
test('valid index selects the time and emits one bubbling change',async()=>{
    const f=fixture();await selectViewerOption(f.evaluate,'#time',7);
    assert.equal(f.control.value,'7');assert.equal(f.changes.length,1);
    assert.equal(f.changes[0].type,'change');assert.equal(f.changes[0].bubbles,true);
});
test('ISO date instead of an option index fails before change or a timed wait',async()=>{
    const f=fixture();await assert.rejects(selectViewerOption(f.evaluate,'#time','2026-10-24T13:00:00Z'),/Недоступное значение/);
    assert.equal(f.control.value,'0');assert.equal(f.changes.length,0);
});
test('missing controls and rejected assignments fail without a change event',async()=>{
    const f=fixture();await assert.rejects(selectViewerOption(f.evaluate,'#missing',0),/Недоступное значение/);
    Object.defineProperty(f.control,'value',{get:()=>'',set:()=>{}});
    await assert.rejects(selectViewerOption(f.evaluate,'#time',1),/не принял/);assert.equal(f.changes.length,0);
});
