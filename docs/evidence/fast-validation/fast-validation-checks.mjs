import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const directory='data/reports/fast-validation/checks2';
mkdirSync(directory,{recursive:true});
const checks=[['selection',process.execPath,['--test','tools/test-weather-check-options.mjs']],
  ['evidence-tests','python',['-B','-m','unittest','discover','-s','tools','-p','test_evidence.py','-v']],
  ['documentation','powershell',['-NoProfile','-File','tools/check-documentation.ps1']],
  ...['tools/check-weather-prototype.mjs','tools/weather-check-options.mjs','tools/weather-projection-checks.mjs','tools/weather-landscape-checks.mjs','tools/test-weather-check-options.mjs'].map((path,i)=>['syntax'+i,process.execPath,['--check',path]]),
  ['historical-t24','python',['-B','tools/check_evidence.py','--t24']]];
for(const [name,command,args] of checks){
  const {status,stdout,stderr,error}=spawnSync(command,args,{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
  writeFileSync(`${directory}/${name}.stdout.log`,stdout||'');
  writeFileSync(`${directory}/${name}.stderr.log`,stderr||'');
  console.log(JSON.stringify({name,status}));
  if(error||status!==0)process.exit(status||1);
}
