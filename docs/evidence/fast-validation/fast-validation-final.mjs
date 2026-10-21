import {spawnSync,execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const directory=resolve('data/reports/fast-validation/final1');
mkdirSync(directory,{recursive:true});
const chrome='C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const results=[];
for(const [name,browser,args] of [
  ['focused-controls',chrome,['--scenario=mobile-controls','--viewport=360x740','--screenshots=focused-controls']],
  ['focused-layout',chrome,['--scenario=landscape','--viewport=640x360','--screenshots=initial,point']],
  ['full-chrome',chrome,['--projections']],
  ['full-edge',edge,['--projections']]]){
  const output=join(directory,name),started=performance.now();
  const result=spawnSync(process.execPath,['tools/check-weather-prototype.mjs',...args],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024,env:{...process.env,T22_CHROME:browser,T22_REPORT_DIRECTORY:output}});
  writeFileSync(join(directory,name+'.stdout.log'),result.stdout||'');
  writeFileSync(join(directory,name+'.stderr.log'),result.stderr||'');
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  const report=JSON.parse(readFileSync(join(output,'validation.json')));
  assert.deepEqual(report.cleanup,{browser_processes_remaining:0,profile_removed:true,compose_projects_created:0,servers_created:0});
  for(const path of Object.keys(report.inputs)){
    const args=['hash-object'];
    const raw=execFileSync('git',[...args,'--no-filters','--',path],{encoding:'utf8'}).trim();
    const filtered=execFileSync('git',[...args,`--path=${path}`,'--',path],{encoding:'utf8'}).trim();
    assert.equal(raw,filtered,'Prospective Git byte identity: '+path);
  }
  results.push({name,external_wall_ms:performance.now()-started,report:join(output,'validation.json'),timing_ms:report.timing_ms,checks:report.checks.length,screenshots:report.screenshots.length,acceptance:report.selection.acceptance});
  writeFileSync(join(directory,'summary.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results.at(-1)));
  if(name.startsWith('full-')){
    const reference=spawnSync('C:/OSGeo4W/apps/Python312/python.exe',['-B','tools/check-weather-geometry.py',join(output,'validation.json')],{encoding:'utf8',windowsHide:true,env:{...process.env,PYTHONHOME:'C:/OSGeo4W/apps/Python312'}});
    writeFileSync(join(directory,name+'-geometry.stdout.log'),reference.stdout||'');
    writeFileSync(join(directory,name+'-geometry.stderr.log'),reference.stderr||'');
    assert.equal(reference.status,0,reference.stderr);
  }
}
assert.deepEqual(JSON.parse(readFileSync(join(directory,'full-chrome/validation.json'))).inputs,JSON.parse(readFileSync(join(directory,'full-edge/validation.json'))).inputs);
