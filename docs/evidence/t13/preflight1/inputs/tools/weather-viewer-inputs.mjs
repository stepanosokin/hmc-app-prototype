import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve,dirname,sep} from 'node:path';
import assert from 'node:assert/strict';
const directory=resolve(process.argv[2]),phase=process.argv[3];
assert.ok(directory.startsWith(resolve('data/reports/t13')+sep));assert.ok(['start','end'].includes(phase));
const files=[];
async function walk(path){for(const entry of await readdir(path,{withFileTypes:true})){
    if(['node_modules','__pycache__'].includes(entry.name))continue;
    const child=path+'/'+entry.name;
    if(entry.isDirectory())await walk(child);else if(/\.(?:py|ps1|json|sql|sh|sld|js|ts|mjs|html|css|lock)$/.test(child))files.push(child);
}}
for(const path of ['decoder','publication','tests','trials','tools','viewer','data/viewer'])await walk(path);
files.push('AGENTS.md','.gitattributes','.github/workflows/checks.yml','docs/development-workflow.md','docs/prototypes/assets/land.js');
for(const entry of await readdir('.'))if(/^(?:Dockerfile|compose|requirements)/.test(entry))files.push(entry);
const inputs={};
for(const path of files.sort()){
    const bytes=await readFile(path);inputs[path]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    if(phase==='start'){
        const target=join(directory,'inputs',path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);
    }
}
if(phase==='start'){
    const changed=execFileSync('git',['ls-files','--modified','--others','--exclude-standard'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(path=>inputs[path]);
    for(const path of changed){
        const raw=execFileSync('git',['hash-object','--no-filters','--',path],{encoding:'utf8'}).trim();
        const filtered=execFileSync('git',['hash-object','--path='+path,'--',path],{encoding:'utf8'}).trim();
        assert.equal(raw,filtered,'Resolve Git filters: '+path);
    }
}
await writeFile(join(directory,'inputs-'+phase+'.json'),JSON.stringify(inputs,null,2)+'\n');
if(phase==='end')assert.deepEqual(inputs,JSON.parse(await readFile(join(directory,'inputs-start.json'),'utf8')),'Validation inputs changed');
console.log(JSON.stringify({phase,files:Object.keys(inputs).length,status:'passed'}));
