import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root='docs/evidence/t27',read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const names=['graph-desktop-final2','graph-android-final2','regression-desktop-final2','regression-android-final2'];
const frozen=read(`${root}/attempts/${names[0]}/reports/inputs-start.json`),results=[];
for(const name of names){
 const dir=`${root}/attempts/${name}`,reports=dir+'/reports';
 assert.deepEqual(read(reports+'/inputs-start.json'),frozen);assert.deepEqual(read(reports+'/inputs-end.json'),frozen);
 const processes=fs.readFileSync(reports+'/process-results.jsonl','utf8').trim().split(/\r?\n/).map(x=>JSON.parse(x.replace(/^\uFEFF/,'')));
 assert.ok(processes.length>0);for(const p of processes)assert.equal(p.native_exit_code,0,name+':'+p.check);
 const browsers=name.includes('desktop')?['browser','browser-edge','browser-unavailable']:['browser'];
 for(const b of browsers){const r=read(`${reports}/${b}/browser.json`);assert.equal(r.status,'passed');assert.ok(Object.values(r.cleanup).every(x=>x===true||x===0));}
 const retirement=read(dir+'/retirement.json');assert.equal(retirement.status,'retired');assert.equal(retirement.archive_verified,true);
 for(const remaining of Object.values(retirement.remaining))assert.deepEqual(remaining,[]);
 results.push({name,browsers,process_checks:processes.length,status:'passed'});
}
for(const [p,v] of Object.entries(frozen)){const b=fs.readFileSync(p);assert.equal(b.length,v.bytes,p);assert.equal(crypto.createHash('sha256').update(b).digest('hex'),v.sha256,p);}
const suite=fs.readFileSync(`${root}/attempts/regression-desktop-final2/reports/full-suite.stderr.log`,'utf8');
const summary=suite.match(/Ran (\d+) tests in ([\d.]+)s\s+OK(?: \(skipped=(\d+)\))?/);assert.ok(summary,'Complete Python suite summary');
fs.writeFileSync(root+'/checks/final-gates.json',JSON.stringify({observed_at:new Date().toISOString(),scope:'Current complete gates; historical unexplained failure retained under explicit user exception for issue 41 on 2026-10-22',status:'passed',frozen_inputs:Object.keys(frozen).length,results,python_suite:{tests:Number(summary[1]),seconds:Number(summary[2]),skips:Number(summary[3]||0)},test_resources_created:0},null,2)+'\n');
console.log(JSON.stringify({status:'passed',gates:results.length,frozen_inputs:Object.keys(frozen).length,python_tests:Number(summary[1]),skips:Number(summary[3]||0)}));
