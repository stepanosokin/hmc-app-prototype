import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const directory=resolve('data/reports/fast-validation/final1');
const original=JSON.parse(readFileSync(join(directory,'full-chrome/validation.json')));
function verifyInputs(report){for(const [path,hash] of Object.entries(report.inputs))assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),hash,'Frozen input: '+path);}
function geometry(name,suffix){
  const report=JSON.parse(readFileSync(join(directory,name,'validation.json')));
  verifyInputs(report);
  const result=spawnSync('C:/OSGeo4W/apps/Python312/python.exe',['-B','tools/check-weather-geometry.py',join(directory,name,'validation.json')],{encoding:'utf8',windowsHide:true,env:{...process.env,PYTHONHOME:'C:/OSGeo4W/apps/Python312',PROJ_DATA:'C:/OSGeo4W/share/proj',PATH:'C:/OSGeo4W/bin;'+process.env.PATH}});
  writeFileSync(join(directory,`${name}-${suffix}.stdout.log`),result.stdout||'');
  writeFileSync(join(directory,`${name}-${suffix}.stderr.log`),result.stderr||'');
  assert.equal(result.status,0,result.stderr);
  console.log(result.stdout.trim());
}
geometry('full-chrome','geometry2');
const output=join(directory,'full-edge'),started=performance.now();
const result=spawnSync(process.execPath,['tools/check-weather-prototype.mjs','--projections'],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024,env:{...process.env,T22_CHROME:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',T22_REPORT_DIRECTORY:output}});
writeFileSync(join(directory,'full-edge.stdout.log'),result.stdout||'');writeFileSync(join(directory,'full-edge.stderr.log'),result.stderr||'');
assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
const report=JSON.parse(readFileSync(join(output,'validation.json')));
assert.deepEqual(report.inputs,original.inputs);
const results=JSON.parse(readFileSync(join(directory,'summary.json')));
results.push({name:'full-edge',external_wall_ms:performance.now()-started,timing_ms:report.timing_ms,checks:report.checks.length,screenshots:report.screenshots.length,acceptance:report.selection.acceptance});
writeFileSync(join(directory,'summary.json'),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results.at(-1)));
geometry('full-edge','geometry');
