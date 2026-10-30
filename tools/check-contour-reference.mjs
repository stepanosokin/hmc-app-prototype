import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,sep} from 'node:path';
const directory=resolve(process.argv[2]);
if(!directory.startsWith(resolve('data/reports/contours74')+sep))throw Error('Expected owned contour report');
const result=spawnSync('docker',['exec','-i','hmc-app-live-api-1','python','-B','-c',readFileSync('tools/check-contour-reference.py','utf8')],
    {input:readFileSync(directory+'/validation.json'),windowsHide:true,maxBuffer:8*1024**2});
writeFileSync(directory+'/native-reference.stdout',result.stdout??'');writeFileSync(directory+'/native-reference.stderr',result.stderr??'');
if(result.status!==0){console.error(result.stderr?.toString());throw Error('Native contour reference failed');}
const report=JSON.parse(result.stdout);writeFileSync(directory+'/native-reference.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,states:report.states.length,samples:report.samples,projected_points:report.projected_points}));
