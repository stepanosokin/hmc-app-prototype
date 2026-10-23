import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const [directory,phase='start']=process.argv.slice(2),paths=[];
const changed=new Set(execFileSync('git',['ls-files','--modified','--others','--exclude-standard'],{encoding:'utf8'}).trim().split(/\r?\n/));
async function walk(root){for(const entry of await readdir(root,{withFileTypes:true})){
    if(entry.name==='node_modules'||entry.name==='__pycache__')continue;
    const path=join(root,entry.name).replaceAll('\\','/');
    if(entry.isDirectory())await walk(path);else paths.push(path);
}}
for(const root of ['decoder','publication','viewer','tools','tests','trials'])await walk(root);
// Include the exact prepared local browser runtime, not just its source code.
await walk('data/viewer');
paths.push('compose.publication.yaml','Dockerfile.publication','requirements.lock',
    'requirements.adapters.lock','requirements.publication.lock','data/grib/proj.txt','.gitignore','.gitattributes',
    'docs/prototypes/assets/land.js','AGENTS.md','docs/development-workflow.md');
const files=[];
for(const path of paths.sort()){
    const bytes=await readFile(path),sha256=createHash('sha256').update(bytes).digest('hex');
    files.push({path,bytes:bytes.length,sha256});
    if(phase==='start'&&changed.has(path)){
        const raw=execFileSync('git',['hash-object','--no-filters','--',path],{encoding:'utf8'}).trim();
        const filtered=execFileSync('git',['hash-object','--path='+path,'--',path],{encoding:'utf8'}).trim();
        if(raw!==filtered)throw Error('Resolve Git filters before acceptance: '+path);
    }
    if(phase==='start'){await mkdir(join(directory,'inputs',path,'..'),{recursive:true});await copyFile(path,join(directory,'inputs',path));}
}
await mkdir(directory,{recursive:true});
await writeFile(join(directory,`inputs-${phase}.json`),JSON.stringify({starting_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files},null,2)+'\n');
if(phase!=='start'){
    const before=JSON.parse(await readFile(join(directory,'inputs-start.json'),'utf8'));
    if(JSON.stringify(before.files)!==JSON.stringify(files))throw Error('Validated inputs changed during the run');
}
