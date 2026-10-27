import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseOptions} from './revalidate-fields.mjs';

test('revalidation requires a saved plan and rejects malformed arguments before Docker',()=>{
    for(const args of [[],['apply'],['preview','--plan'],['preview','--plan','a','--project','../other'],
        ['preview','--plan','a','--plan','b'],['preview','--plan','a','--storage-budget-bytes','0'],
        ['preview','--plan','a','--storage-budget-bytes','9007199254740992']])assert.throws(()=>parseOptions(args));
    const value=parseOptions(['preview','--plan','a','--project','hmc-publication-test','--storage-budget-bytes','123']);
    assert.equal(value.operation,'preview');assert.equal(value.project,'hmc-publication-test');assert.equal(value.budget,'123');
});
