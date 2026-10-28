// Resource-free frozen-input and served-bundle verification after acceptance.
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
const [chromeDirectory,edgeDirectory,outputDirectory]=process.argv.slice(2).map(p=>resolve(p));
for(const path of [chromeDirectory,edgeDirectory,outputDirectory])assert.ok(path.startsWith(resolve('data/reports/wind72')+sep));
const origin=process.env.HMC_WIND_GATEWAY??'http://127.0.0.1:8140';assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const chrome=JSON.parse(await readFile(join(chromeDirectory,'validation.json'),'utf8'));
const edge=JSON.parse(await readFile(join(edgeDirectory,'validation.json'),'utf8'));
const result={observed_at:new Date().toISOString(),checks:[],inputs:{},served:{},cleanup:{test_resources_created:0}};
await mkdir(outputDirectory,{recursive:false});
await copyFile('tools/verify-wind-validation.mjs',join(outputDirectory,'verify-wind-validation.mjs'));
try{
    assert.equal(chrome.status,'passed');assert.equal(edge.status,'passed');assert.deepEqual(chrome.inputs,edge.inputs);
    result.checks.push('Chrome and Edge used identical complete input manifests');
    for(const [path,expected] of Object.entries(chrome.inputs)){
        const actual=hash(await readFile(path));assert.equal(actual,expected,'Working input changed: '+path);result.inputs[path]=actual;
    }
    result.checks.push('Working bytes match both browser snapshots');
    const built=join(chromeDirectory,'site/build'),names=(await readdir(built)).sort();
    assert.deepEqual((await readdir('data/viewer/build')).sort(),names);
    for(const name of names){
        const expected=hash(await readFile(join(built,name)));
        assert.equal(hash(await readFile(join('data/viewer/build',name))),expected,'Local build differs: '+name);
        const response=await fetch(origin+'/build/'+encodeURIComponent(name));assert.equal(response.status,200);
        const served=hash(Buffer.from(await response.arrayBuffer()));assert.equal(served,expected,'Served build differs: '+name);result.served['build/'+name]=served;
    }
    for(const [path,source] of [['/','viewer/index.html'],['/style.css','viewer/style.css'],['/worker-projection.mjs','viewer/worker-projection.mjs']]){
        const response=await fetch(origin+path);assert.equal(response.status,200);const served=hash(Buffer.from(await response.arrayBuffer()));
        assert.equal(served,chrome.inputs[source],'Served source differs: '+source);result.served[path]=served;
    }
    result.checks.push('Local and HTTP-served bundle, HTML, CSS and worker match acceptance');result.status='passed';
}catch(error){result.status='failed';result.failure=String(error.stack??error);process.exitCode=1;}
await writeFile(join(outputDirectory,'validation.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,inputs:Object.keys(result.inputs).length,served:Object.keys(result.served).length,failure:result.failure}));
