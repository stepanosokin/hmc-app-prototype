// Independent snapshot checks; does not import the pyramid aggregation implementation.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const directory=path.resolve(process.argv[2]??'data/prototype-pyramid');
let fields=0,checked=0;
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const item of await readdir(directory,{withFileTypes:true})){
    if(!item.isDirectory())continue;
    const base=path.join(directory,item.name);
    let receipt;try{receipt=JSON.parse(await readFile(path.join(base,'receipt.json'),'utf8'));}catch{continue;}
    const sourceBytes=await readFile(path.join(base,'source.json')),source=JSON.parse(sourceBytes);
    assert.equal(sha(sourceBytes),receipt.source_metadata_sha256);
    const [ny,nx]=source.grid.shape_yx,blocks=[];
    for(const file of receipt.levels[0].files)blocks.push(await readFile(path.join(base,'1',file.name)));
    const sample=(buffers,columns,x,y)=>{
        const block=buffers[Math.floor(y/256)*columns+Math.floor(x/256)],i=(y%256+1)*258+x%256+1;
        return [block.readFloatLE(i*4),block[258*258*4+i]];
    };
    for(const level of receipt.levels){
        const bytes=await readFile(path.join(base,String(level.factor),'native.json')),meta=JSON.parse(bytes);
        assert.equal(sha(bytes),level.metadata_sha256);assert.deepEqual(meta.grid.outer_cell_edges_wsen,source.grid.outer_cell_edges_wsen);
        assert.deepEqual(meta.identity,source.identity);assert.deepEqual(meta.source_crs,source.source_crs);
        const output=[];
        for(const file of level.files){const b=await readFile(path.join(base,String(level.factor),file.name));assert.equal(b.length,file.bytes);assert.equal(sha(b),file.sha256);output.push(b);}
        const [h,w]=meta.grid.shape_yx,columns=meta.columns[1]+1;
        // Deterministic coverage includes every outer row/column plus interior samples.
        const points=new Set();
        for(let x=0;x<w;x++){points.add(x+',0');points.add(x+','+(h-1));}
        for(let y=0;y<h;y++){points.add('0,'+y);points.add((w-1)+','+y);}
        for(let i=0;i<2048;i++)points.add((i*127%w)+','+(i*61%h));
        for(const point of points){
            const [x,y]=point.split(',').map(Number),actual=sample(output,columns,x,y);
            if(level.factor===1){assert.deepEqual(actual,sample(blocks,source.columns[1]+1,x,y));continue;}
            const left=x*nx/w,right=(x+1)*nx/w,bottom=y*ny/h,top=(y+1)*ny/h;
            let total=0,invalid=false;
            for(let yy=Math.floor(bottom);yy<Math.ceil(top);yy++)for(let xx=Math.floor(left);xx<Math.ceil(right);xx++){
                const weight=(Math.min(right,xx+1)-Math.max(left,xx))*(Math.min(top,yy+1)-Math.max(bottom,yy));
                if(weight<=0)continue;const [v,m]=sample(blocks,source.columns[1]+1,xx,yy);invalid||=!m;total+=v*weight;
            }
            assert.equal(actual[1],invalid?0:1);const expected=invalid?0:Math.fround(total/((right-left)*(top-bottom)));
            assert.ok(Math.abs(actual[0]-expected)<=Math.max(1e-6,Math.abs(expected)*2e-7));checked++;
        }
        // Adjacent payload halos must equal the owning interior sample, including validity.
        for(let index=0;index<output.length;index++){
            const col=index%columns,row=Math.floor(index/columns),buffer=output[index];
            for(let p=0;p<258;p++)for(const [x,y] of [[0,p],[257,p],[p,0],[p,257]]){
                const xx=col*256+x-1,yy=row*256+y-1,i=y*258+x;
                const expected=xx<0||yy<0||xx>=w||yy>=h?[0,0]:sample(output,columns,xx,yy);
                assert.deepEqual([buffer.readFloatLE(i*4),buffer[258*258*4+i]],expected);
            }
        }
    }
    fields++;
}
assert.ok(fields>0);console.log(JSON.stringify({status:'passed',fields,derived_samples:checked,checks:'SHA256, native footprints, identity/CRS, independent weighted means/masks, all tile halos',resources_created:0}));
