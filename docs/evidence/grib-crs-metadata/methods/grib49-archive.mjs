import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve('.'), destination=path.join(root,'docs/evidence/grib-crs-metadata');
const projects=[
 ['grib-crs-metadata','hmc-publication-grib49-dev1'],['grib-crs-metadata','hmc-publication-grib49-dev2'],
 ['grib-crs-metadata','hmc-publication-grib49-final1'],['grib-crs-metadata','hmc-publication-grib49-final2'],['grib-crs-metadata','hmc-publication-grib49-final3'],
 ['t12','hmc-publication-t12-grib49-final1'],['t12','hmc-publication-t12-grib49-final2'],['t12','hmc-publication-t12-grib49-final3'],
 ['t6','hmc-publication-t6-grib49-final1'],['t6','hmc-publication-t6-grib49-final2'],['t6','hmc-publication-t6-grib49-final3'],
 ['t13','hmc-publication-t13-grib49-final1'],['t13','hmc-publication-t13-grib49-final2'],['t13','hmc-publication-t13-grib49-final3'],
 ['t23a','hmc-publication-t23a-grib49-final1'],['t23a','hmc-publication-t23a-grib49-final2'],['t23a','hmc-publication-t23a-grib49-final3'],['t23a','hmc-publication-t23a-grib49-final4']];
const secrets=[];
async function secretFile(file,environment=false){try{const text=await fs.readFile(file,'utf8');
 if(environment){for(const line of text.split(/\r?\n/)){const [key,...rest]=line.split('=');if(key.endsWith('PASSWORD'))secrets.push(rest.join('='));}}
 else secrets.push(text.trim());}catch(error){if(error.code!=='ENOENT')throw error;}}
for(const [kind,name] of projects){await secretFile(`data/reports/${kind}/${name}/environment.env`,true);await secretFile(`.scratch/hmc-meteo/${name}/key`);}
await secretFile('data/live/hmc-app/environment.env',true);
const meaningfulSecrets=secrets.filter(s=>s.length>=12),copied=[];
async function copyTree(source,target){let entries;try{entries=await fs.readdir(source,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
 for(const entry of entries){const from=path.join(source,entry.name),to=path.join(target,entry.name);
  if(entry.isDirectory()){if(!['profile','node_modules','__pycache__','batch-input','fixtures'].includes(entry.name))await copyTree(from,to);continue;}
  if(!entry.isFile()||/\.env$|\.key$|^key$|^desktop\.json$/.test(entry.name))continue;
  if(!from.includes(path.sep+'inputs'+path.sep)&&!(/\.(json|jsonl|log|txt|png|py|ps1|js|mjs|ts|css|html|sql|sh|sld|md|yaml|yml)$/.test(entry.name)||/^(Dockerfile|\.gitattributes|\.dockerignore)/.test(entry.name)))continue;
  const bytes=await fs.readFile(from);
  if(meaningfulSecrets.some(secret=>bytes.includes(Buffer.from(secret))))throw Error('Secret detected in selected artifact: '+from);
  await fs.mkdir(path.dirname(to),{recursive:true});await fs.writeFile(to,bytes);
  copied.push({source:path.relative(root,from).replaceAll('\\','/'),path:path.relative(destination,to).replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
}
for(const [kind,name] of projects){await copyTree(path.join(root,`data/reports/${kind}/${name}`),path.join(destination,'attempts',name));await copyTree(path.join(root,'data/archives/publication',name),path.join(destination,'retirement',name));}
const metadata=path.join(root,'data/reports/grib-crs-metadata');
for(const entry of await fs.readdir(metadata,{withFileTypes:true}))if(entry.isDirectory()&&!entry.name.startsWith('hmc-publication-'))await copyTree(path.join(metadata,entry.name),path.join(destination,'checks',entry.name));
await copyTree(path.join(root,'data/live/hmc-app/grib49-acceptance'),path.join(destination,'live'));
await fs.writeFile(path.join(destination,'copy-manifest.json'),JSON.stringify({observed_at:new Date().toISOString(),secret_scan:'passed; private environments/keys excluded',files:copied},null,2)+'\n');
async function scan(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){
 const file=path.join(directory,entry.name);if(entry.isDirectory())await scan(file);else if(entry.isFile()){
  const bytes=await fs.readFile(file);if(meaningfulSecrets.some(secret=>bytes.includes(Buffer.from(secret))))throw Error('Secret detected in evidence: '+file);
 }}}
await scan(destination);
console.log(JSON.stringify({files:copied.length,bytes:copied.reduce((sum,f)=>sum+f.bytes,0),status:'passed'}));
