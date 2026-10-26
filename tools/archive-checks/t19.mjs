import {historicalPath} from '../archive-paths.mjs';
// From repository root: --write-index builds the inventory; default verifies it.
// File reads/writes only; no server, browser, Docker or network resources.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root='docs/evidence/t19',indexPath=root+'/artifact-index.json';
const excluded=new Set([indexPath,root+'/index-check.json']);
const sha=(bytes,algorithm='sha256')=>crypto.createHash(algorithm).update(bytes).digest('hex');
const paths=[];
const walk=directory=>{
    for(const entry of fs.readdirSync(historicalPath(directory),{withFileTypes:true})){
        assert.ok(!entry.isSymbolicLink(),'Unexpected evidence symlink: '+entry.name);
        assert.ok(!['environment.env','load.key','profile'].includes(entry.name),'Private runtime artifact: '+entry.name);
        const path=directory+'/'+entry.name;
        if(entry.isDirectory())walk(path);else if(!excluded.has(path))paths.push(path);
    }
};
walk(root);paths.sort();
if(process.argv.includes('--write-index')){
    const artifacts=paths.map(path=>{
        const bytes=fs.readFileSync(historicalPath(path));
        return {path,bytes:bytes.length,sha256:sha(bytes),
            git_object:sha(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes]),'sha1')};
    });
    fs.writeFileSync(historicalPath(indexPath),JSON.stringify({schema:1,phase:'pre-commit evidence inventory',
        observed_at:new Date().toISOString(),scope:'Integrity inventory; does not itself establish acceptance or performance readiness',artifacts},null,2)+'\n');
}
const index=JSON.parse(fs.readFileSync(historicalPath(indexPath),'utf8'));
assert.deepEqual(index.artifacts.map(item=>item.path),paths,'Archive inventory changed');
for(const item of index.artifacts){
    assert.ok(item.path.startsWith(root+'/')&&!item.path.includes('..')&&!item.path.includes('\\'));
    const bytes=fs.readFileSync(historicalPath(item.path));
    assert.equal(bytes.length,item.bytes,item.path);
    assert.equal(sha(bytes),item.sha256,item.path);
    assert.equal(sha(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes]),'sha1'),item.git_object,item.path);
}
console.log(JSON.stringify({status:'passed',artifacts:index.artifacts.length,
    bytes:index.artifacts.reduce((sum,item)=>sum+item.bytes,0),test_resources_created:0}));
