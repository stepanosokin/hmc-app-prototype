import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve,sep} from 'node:path';
import {projectRoot,evidenceRoot,archiveRoot,historicalPath} from './archive-paths.mjs';

test('archive locations respect the external configuration',()=>{
    assert.equal(evidenceRoot,resolve(projectRoot,process.env.HMC_EVIDENCE_ROOT||'../hmc-app-evidence'));
    assert.equal(archiveRoot('t13'),resolve(evidenceRoot,'t13'));
});
test('historical metadata paths resolve outside the source tree on both path formats',()=>{
    const expected=resolve(evidenceRoot,'t13','inputs','viewer','main.ts');
    assert.equal(historicalPath('docs/evidence/t13/inputs/viewer/main.ts'),expected);
    assert.equal(historicalPath('docs\\evidence\\t13\\inputs\\viewer\\main.ts'),expected);
});
test('runtime source paths still refer to the repository',()=>{
    assert.equal(historicalPath('publication/contract.v2.json'),resolve(projectRoot,'publication/contract.v2.json'));
});
test('T25 archive containment uses native separators',()=>{
    const root=archiveRoot('t25')+sep;
    assert.ok(resolve(root,'inputs','viewer','main.ts').startsWith(root));
    assert.equal(resolve(root,'../outside.json').startsWith(root),false);
});
