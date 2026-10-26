import {spawn} from 'node:child_process';
import {open,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const [project,environment,directory,clients,seconds,phase,repetition,representation]=process.argv.slice(2);
assert.match(project,/^hmc-publication-t19-[a-z0-9-]+$/);
assert.ok(['1','10','50','100'].includes(clients)&&['cold','warm'].includes(phase));
const prefix=`load-${repetition}-${clients}-${phase}-${representation}`;
const stdout=await open(join(directory,prefix+'.stdout.log'),'wx'),stderr=await open(join(directory,prefix+'.stderr.log'),'wx');
let code;
try{
    const args=['compose','--env-file',environment,'--project-name',project,'--file','compose.publication.yaml','--file','compose.workloads.yaml',
        'run','--rm','--entrypoint','python','check','-m','publication.workload','load','--input','/evidence/corpus.json',
        '--output',`/evidence/${prefix}.json`,'--clients',clients,'--seconds',seconds,'--phase',phase,'--representation',representation,'--stop',`/evidence/${prefix}.stop.json`,'--key','/evidence/load.key'];
    const child=spawn('docker',args,{cwd:resolve('.'),windowsHide:true,stdio:['ignore',stdout.fd,stderr.fd]});
    code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
}catch(error){code=1;await stderr.write(String(error));}
finally{
    await stdout.close();await stderr.close();
    await writeFile(join(directory,prefix+'-exit.json'),JSON.stringify({native_exit_code:code})+'\n');
}
process.exitCode=code??1;
