// Freeze runtime/configuration and browser bytes, including newly added files.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [directory,phase]=process.argv.slice(2);
if(!['start','end'].includes(phase)||!path.resolve(directory).startsWith(path.resolve('data/reports')+path.sep))throw Error('Expected report directory and start/end');
const files=[];
async function walk(root){for(const entry of await fs.readdir(root,{withFileTypes:true})){
    const name=path.join(root,entry.name);if(entry.isDirectory()){if(!['node_modules','__pycache__','profile'].includes(entry.name))await walk(name);}
    else if(/\.(py|ps1|json|sql|sh|sld|js|mjs|ts|html|css|txt)$/.test(name))files.push(name.replaceAll('\\','/'));
}}
for(const root of ['decoder','publication','config','tests','trials','tools','viewer','data/viewer'])await walk(root);
for(const entry of await fs.readdir('.'))if(/^(Dockerfile|compose|requirements)/.test(entry))files.push(entry);
files.push('.dockerignore','.gitattributes','AGENTS.md','docs/development-workflow.md','.github/workflows/checks.yml');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024**2}).trim();
const changed=new Set([...git('diff','--name-only').split('\n'),...git('ls-files','--others','--exclude-standard').split('\n')]);
const manifest={phase,observed_at:new Date().toISOString(),starting_commit:git('rev-parse','HEAD'),files:[],sources:[]};
await fs.mkdir(directory,{recursive:true});
for(const name of [...new Set(files)].sort()){
    if(changed.has(name)&&!name.startsWith('data/')){
        const a=git('hash-object','--no-filters','--',name),b=git('hash-object','--path='+name,'--',name);
        if(a!==b)throw Error('Git filter changes runtime bytes: '+name);
    }
    const bytes=await fs.readFile(name),sha256=createHash('sha256').update(bytes).digest('hex');
    manifest.files.push({path:name,bytes:bytes.length,sha256});
    if(phase==='start'){const target=path.join(directory,'inputs',name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);}
}
for(const name of ['data/grib/ICON_EU_T_G_2026101500.grib2','data/grib/test/igfi00000000s.ENA6km.grb']){
    const bytes=await fs.readFile(name);manifest.sources.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),copied:false});
}
await fs.writeFile(path.join(directory,'inputs-'+phase+'.json'),JSON.stringify(manifest,null,2)+'\n');
if(phase==='end'){
    const before=JSON.parse(await fs.readFile(path.join(directory,'inputs-start.json'),'utf8'));
    if(JSON.stringify(before.files)!==JSON.stringify(manifest.files)||JSON.stringify(before.sources)!==JSON.stringify(manifest.sources))throw Error('Frozen inputs changed');
}
console.log(JSON.stringify({phase,files:manifest.files.length,sources:manifest.sources.length,status:'passed'}));
