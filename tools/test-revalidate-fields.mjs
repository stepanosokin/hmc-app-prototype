import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseOptions,summarizePlan,checkScope} from './revalidate-fields.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

test('revalidation requires a saved plan and rejects malformed arguments before Docker',()=>{
    for(const args of [[],['apply'],['preview','--plan'],['preview','--plan','a','--project','../other'],
        ['preview','--plan','a','--plan','b'],['preview','--plan','a','--storage-budget-bytes','0'],
        ['preview','--plan','a','--storage-budget-bytes','9007199254740992']])assert.throws(()=>parseOptions(args));
    const value=parseOptions(['preview','--plan','a','--project','hmc-publication-test','--storage-budget-bytes','123']);
    assert.equal(value.operation,'preview');assert.equal(value.project,'hmc-publication-test');assert.equal(value.budget,'123');
});

function plan(count=10){
    const entries=Array.from({length:count},(_,i)=>({key:'k'+i,field:'wind10',manifest_path:'batch/'+i,manifest_sha256:'sha'+i}));
    return {version:'field-revalidation/1',actions:[{entries,rebuild_keys:entries.map(e=>e.key)}]};
}
test('apply requires an explicit expected count and accepts a single-field scope',()=>{
    for(const value of [undefined,'-1','1.5','NaN','9007199254740992','01'])
        assert.throws(()=>parseOptions(['apply','--plan','a',...(value===undefined?[]:['--expect-rebuild-batches',value])]),/ожидаемое/);
    const value=parseOptions(['apply','--plan','a','--expect-rebuild-batches','10','--expect-field','wind10']);
    assert.equal(value.expected,10);assert.equal(value.field,'wind10');
    assert.equal(parseOptions(['apply','--plan','a','--expect-rebuild-batches','0']).expected,0);
    assert.throws(()=>parseOptions(['preview','--plan','a','--expect-rebuild-batches','10']));
});
test('scope counts unique immutable batches, distinguishing reused entries from rebuilds',()=>{
    const saved=plan();saved.actions[0].rebuild_keys=saved.actions[0].rebuild_keys.slice(0,2);
    saved.actions.push(structuredClone(saved.actions[0]));
    assert.deepEqual(checkScope(saved,2,'wind10'),{roots:2,rebuild_batches:2,reused_batches:8,fields:[{field:'wind10',batches:2}]});
    assert.deepEqual(checkScope({version:saved.version,actions:[]},0).fields,[]);
});
test('scope rejects excess work, unrelated fields and ambiguous or legacy plans',()=>{
    assert.throws(()=>checkScope(plan(334),10),/334.*10/);
    const unrelated=plan();unrelated.actions[0].entries[5].field='temperature';
    assert.throws(()=>checkScope(unrelated,10,'wind10'),/вне --expect-field/);
    for(const mutate of [p=>delete p.actions[0].rebuild_keys,p=>p.actions[0].rebuild_keys.push('unknown'),
        p=>p.actions[0].rebuild_keys.push('k0'),p=>p.actions[0].entries.push(p.actions[0].entries[0]),
        p=>p.actions[0].entries[0].manifest_path=null]){
        const saved=plan();mutate(saved);assert.throws(()=>summarizePlan(saved));
    }
    for(const saved of [null,{}, {version:'old',actions:[]}])assert.throws(()=>summarizePlan(saved));
});
test('actual apply entrypoint refuses a 334-batch plan before any Docker command',()=>{
    const directory=mkdtempSync(join(tmpdir(),'hmc-revalidation-scope-'));
    try{
        const file=join(directory,'plan.json');writeFileSync(file,JSON.stringify(plan(334)));
        const result=spawnSync(process.execPath,[resolve('tools/revalidate-fields.mjs'),'apply','--plan',file,'--expect-rebuild-batches','10'],
            {encoding:'utf8',windowsHide:true,env:{...process.env,PATH:'',Path:''}});
        assert.ifError(result.error);assert.equal(result.status,1);assert.match(result.stderr,/334.*10/);
        assert.doesNotMatch(result.stderr,/Docker/);
    }finally{
        assert.ok(directory.startsWith(join(tmpdir(),'hmc-revalidation-scope-')));
        rmSync(directory,{recursive:true,force:true});
    }
});
