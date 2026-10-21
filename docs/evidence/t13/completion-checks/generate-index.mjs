import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root='docs/evidence/t13';
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const index=path.join(root,'artifact-index.json');
const artifacts=walk(root).filter(f=>f!==index).map(file=>{
 const bytes=fs.readFileSync(file);
 return {path:file.split(path.sep).join('/'),bytes:bytes.length,
  sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
  git_object:crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex')};
});
fs.writeFileSync(index,JSON.stringify({schema:1,scope:'T13 archived evidence; index excludes itself',artifacts},null,2)+'\n');
console.log(artifacts.length+' indexed artifacts');
