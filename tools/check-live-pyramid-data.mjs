// Compare the production derivative against the accepted independent JS prototype.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [destination='data/reports/pyramid-live81/actual-data',reference='data/reports/pyramid79/final-data',origin='http://127.0.0.1:8140']=process.argv.slice(2);
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
await fs.mkdir(destination,{recursive:false});
const sha=b=>createHash('sha256').update(b).digest('hex'),rows=[];
async function get(url){
    const start=performance.now(),r=await fetch(origin+url,{signal:AbortSignal.timeout(30000)});
    assert.equal(r.status,200,url);return {bytes:Buffer.from(await r.arrayBuffer()),ms:performance.now()-start,cache:r.headers.get('x-hmc-cache')};
}
try{
    for(const name of await fs.readdir(reference)){
        const root=path.join(reference,name),target=path.join(destination,name),source=JSON.parse(await fs.readFile(path.join(root,'source.json')));
        await fs.mkdir(target);await fs.copyFile(path.join(root,'receipt.json'),path.join(target,'receipt.json'));
        const current=await get(source.metadata_url),original=JSON.parse(current.bytes);assert.deepEqual(original,source,'Original native metadata preserved');
        await fs.writeFile(path.join(target,'source.json'),current.bytes);
        for(const factor of [1,2,4,8]){
            const folder=path.join(target,String(factor));await fs.mkdir(folder);
            const result=factor===1?current:await get(source.metadata_url.replace('/display/3/','/display/4/'+factor+'/'));
            const metadata=JSON.parse(result.bytes),expected=JSON.parse(await fs.readFile(path.join(root,String(factor),'native.json')));
            assert.deepEqual(metadata.identity,source.identity);assert.deepEqual(metadata.grid.shape_yx,expected.grid.shape_yx);
            assert.deepEqual(metadata.grid.outer_cell_edges_wsen,expected.grid.outer_cell_edges_wsen);
            await fs.writeFile(path.join(folder,'native.json'),result.bytes);
            const row={selection:source.selection,factor,metadata_ms:result.ms,blocks:0,bytes:0,max_abs_error:0,max_relative_error:0,exact_blocks:0,block_ms:[]};
            for(let y=0;y<=metadata.rows[1];y++)for(let x=0;x<=metadata.columns[1];x++){
                const block=await get(metadata.url.replace('{column}',x).replace('{row}',y));assert.equal(block.bytes.length,332820);
                const baseline=await fs.readFile(path.join(root,String(factor),x+'-'+y+'.f32'));
                assert.deepEqual(block.bytes.subarray(258*258*4),baseline.subarray(258*258*4),'Every mask/halo byte');
                for(let i=0;i<258*258;i++){
                    const a=block.bytes.readFloatLE(i*4),b=baseline.readFloatLE(i*4),error=Math.abs(a-b),relative=error/Math.max(1,Math.abs(b));
                    assert.ok(Number.isFinite(a)&&relative<=2e-7,'Float32 mean agrees with independent prototype');
                    row.max_abs_error=Math.max(row.max_abs_error,error);row.max_relative_error=Math.max(row.max_relative_error,relative);
                }
                if(factor===1)assert.equal(sha(block.bytes),sha(baseline),'Original native values unchanged');
                row.exact_blocks+=Number(block.bytes.equals(baseline));row.blocks++;row.bytes+=block.bytes.length;row.block_ms.push(block.ms);
                await fs.writeFile(path.join(folder,x+'-'+y+'.f32'),block.bytes);
            }
            rows.push(row);console.log(JSON.stringify(row));
        }
    }
    await fs.writeFile(path.join(destination,'comparison.json'),JSON.stringify({status:'passed',origin,reference,rows,resources_created:0},null,2));
}catch(error){await fs.writeFile(path.join(destination,'failure.json'),JSON.stringify({status:'failed',error:String(error),rows,resources_created:0},null,2));throw error;}
