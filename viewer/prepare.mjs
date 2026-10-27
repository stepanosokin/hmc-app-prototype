// Build-time fetch only. Browser runtime never contacts package CDNs.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'data/viewer');
await mkdir(directory+'/vendor',{recursive:true});
const lock=JSON.parse(await readFile(root+'/tools/display-projections/vendor-lock.json','utf8'));
for(const entry of lock){
    const target=directory+'/vendor/'+entry.file;
    let bytes;
    try{bytes=await readFile(target);}catch{}
    if(!bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256){
        const result=await fetch(entry.url);assert.ok(result.ok,entry.url);bytes=Buffer.from(await result.arrayBuffer());
    }
    assert.equal(bytes.length,entry.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
    await writeFile(target,bytes);
}
await copyFile(root+'/docs/prototypes/assets/land.js',directory+'/land.js');
await copyFile(root+'/publication/native-display.v1.json',directory+'/native-display.v1.json');
for(const name of ['MapLibre.LICENSE.txt','proj4.LICENSE.md','d3-array.LICENSE.txt','d3-geo.LICENSE.txt'])
    await copyFile(root+'/viewer/licenses/'+name,directory+'/vendor/'+name);
await mkdir(directory+'/vendor/field-icons',{recursive:true});
const icons=JSON.parse(await readFile(root+'/viewer/icons/manifest.json','utf8'));
for(const icon of icons){
    assert.match(icon.file,/^[a-z]+\.png$/);
    const bytes=await readFile(root+'/viewer/icons/'+icon.file);
    assert.equal(bytes.length,icon.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),icon.sha256);
    await writeFile(directory+'/vendor/field-icons/'+icon.file,bytes);
}
console.log('Локальные ресурсы проверены по зафиксированным SHA256.');
