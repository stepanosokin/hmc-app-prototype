import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
const directory=resolve('data/reports/fast-validation/probe2');
await mkdir(directory,{recursive:true});
const css='docs/prototypes/weather-map.prototype.css';
const original=await readFile(css);
const env={...process.env,T22_CHROME:'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'};
const args=['--scenario=landscape','--viewport=640x360','--screenshots=initial,point'];
function run(name){
  let exit=0,output;
  try{output=execFileSync(process.execPath,['tools/check-weather-prototype.mjs',...args],{encoding:'utf8',env:{...env,T22_REPORT_DIRECTORY:join(directory,name)},windowsHide:true});}
  catch(error){exit=error.status;output=String(error.stdout)+'\n'+String(error.stderr);}
  return writeFile(join(directory,name+'.log'),output).then(()=>exit);
}
try{
  await writeFile(css,Buffer.concat([original,Buffer.from('\n/* Temporary layout fault for issue #38; restored in finally. */\n.navigation { transform: translateX(2000px) !important; }\n')]));
  assert.equal(await run('css-defect'),1,'Focused check must reject actual CSS defect');
  const report=JSON.parse(await readFile(join(directory,'css-defect/validation.json')));
  assert.match(report.failure,/landscape-640x360/);
  assert.equal(report.cleanup.browser_processes_remaining,0);
  assert.equal(report.cleanup.profile_removed,true);
}finally{await writeFile(css,original);}
assert.equal(await run('focused-corrected'),0,'Focused check passes after exact CSS restoration');
assert.deepEqual(await readFile(css),original);
console.log('CSS defect rejected; original CSS restored; focused check passed.');
