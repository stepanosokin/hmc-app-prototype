import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root='data/reports/t13/';
const read=async project=>JSON.parse(await readFile(root+project+'/inputs-start.json','utf8'));
const before=await read('hmc-publication-t13-t25-desktop-final2');
const after=await read('hmc-publication-t13-t25-desktop-final4');
const phone=await read('hmc-publication-t13-t25-android-final3');
assert.deepEqual(after,phone,'Final platform source snapshots differ');
const backend=Object.keys(before).filter(p=>/^(decoder|publication|tests|trials)\//.test(p)||/^(Dockerfile|compose|requirements)/.test(p)||p.startsWith('tools/')&&p.endsWith('.py'));
for(const path of backend)assert.deepEqual(after[path],before[path],path);
const unitBefore=await read('hmc-publication-t13-t25-dev6');
const unit=['viewer/field.ts','viewer/selection.ts','viewer/test-field.mjs','viewer/test-selection.mjs','viewer/package.json','viewer/package-lock.json'];
for(const path of unit)assert.deepEqual(after[path],unitBefore[path],path);
const results=(await readFile(root+'hmc-publication-t13-t25-desktop-final2/process-results.jsonl','utf8')).trim().split(/\r?\n/).map(l=>JSON.parse(l.replace(/^\uFEFF/,'')));
assert.equal(results.find(r=>r.check==='full-suite').native_exit_code,0);
const log=await readFile(root+'hmc-publication-t13-t25-desktop-final2/full-suite.stderr.log','utf8');
assert.match(log,/Ran 46 tests/);assert.match(log,/OK \(skipped=22\)/);
const differences=Object.keys(after).filter(p=>JSON.stringify(after[p])!==JSON.stringify(before[p])).map(path=>({path,before:before[path],after:after[path]}));
const report={phase:'frozen final inputs; pre-commit',observed_at:new Date().toISOString(),
    full_python_suite:{project:'hmc-publication-t13-t25-desktop-final2',native_exit_code:0,total:46,skipped:22,executed:24,reused:true,reason:'Only viewer UI and browser driver changed afterwards; every Python/backend/configuration input is byte-identical',unchanged_inputs:Object.fromEntries(backend.map(p=>[p,after[p]]))},
    node_suite:{report:'checks/final-local',passed:6,reused:true,unchanged_inputs:Object.fromEntries(unit.map(p=>[p,after[p]]))},
    final_platform_snapshots_identical:true,final_input_count:Object.keys(after).length,differences_since_python_gate:differences};
await writeFile('docs/evidence/t25/checks/reused-checks.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({backend_inputs_identical:backend.length,node_inputs_identical:unit.length,final_platform_inputs_identical:Object.keys(after).length,differences:differences.map(p=>p.path)}));
