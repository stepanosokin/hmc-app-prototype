// Actual worker replay and an independent geometric intersection check; no browser resources.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import {NativeContours} from '../contour-grid.js';
import {screenProjector,projectedPieces,lineLength,simplifyLine,smoothLine} from '../contour-geometry.js';
import {gaussianSurface,contourSurface} from './surface.js';

const [source='data/reports/pyramid79/final-data',reportPath='data/reports/pyramid79/final-chrome/report.json',destination='data/reports/contour-surface/numerical.json']=process.argv.slice(2);
assert.ok(!fs.existsSync(destination),'Use a new report path for every attempt');
const vendor={};vm.runInNewContext(fs.readFileSync('data/viewer/vendor/proj4.js','utf8'),vendor);globalThis.proj4=vendor.proj4;
const workerSource=fs.readFileSync(new URL('./surface-worker.js',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'');
const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
export function geometryQuality(curves){
    let intersections=0,selfIntersections=0,sharpTurns=0;const bins=new Map(),segments=[];
    for(let p=0;p<curves.length;p++){
        const xy=curves[p].points;
        for(let j=2;j<xy.length;j+=2){
            const a=[xy[j-2],xy[j-1]],b=[xy[j],xy[j+1]],index=segments.length,seen=new Set();
            if(j+3<xy.length){const c=[xy[j+2],xy[j+3]],u=[b[0]-a[0],b[1]-a[1]],v=[c[0]-b[0],c[1]-b[1]],n=Math.hypot(...u)*Math.hypot(...v);
                if(n>.01&&Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/n)))>Math.PI/6)sharpTurns++;}
            for(let y=Math.floor(Math.min(a[1],b[1])/16);y<=Math.floor(Math.max(a[1],b[1])/16);y++)for(let x=Math.floor(Math.min(a[0],b[0])/16);x<=Math.floor(Math.max(a[0],b[0])/16);x++){
                const key=x+','+y,indices=bins.get(key)??[];
                for(const k of indices){if(seen.has(k))continue;seen.add(k);const t=segments[k];if(t.p===p&&Math.abs(t.j-j)<=2)continue;
                    if(orient(a,b,t.a)*orient(a,b,t.b)<-1e-12&&orient(t.a,t.b,a)*orient(t.a,t.b,b)<-1e-12){intersections++;if(t.p===p)selfIntersections++;}}
                indices.push(index);bins.set(key,indices);
            }
            segments.push({a,b,p,j});
        }
    }
    return {intersections,selfIntersections,sharpTurns,segments:segments.length};
}

// Numerical invariants do not rely on the native contour algorithm.
const width=17,height=17,values=new Float32Array(width*height).fill(7),valid=new Uint8Array(values.length).fill(1);
for(let y=0;y<height;y++)valid[y*width+8]=0;
const grid={width,height,values,valid},before=values.slice(),filtered=gaussianSurface(grid);
assert.deepEqual(values,before);assert.deepEqual(filtered.valid,valid);
for(let i=0;i<values.length;i++)assert.equal(filtered.values[i],valid[i]?7:0);
// A complete missing column blocks influence from a different constant region.
for(let y=0;y<height;y++)for(let x=9;x<width;x++)values[y*width+x]=700;
const split=gaussianSurface(grid);for(let y=0;y<height;y++)for(let x=0;x<8;x++)assert.equal(split.values[y*width+x],7);
const metadata={grid:{shape_yx:[height,width],spacing_degrees_xy:[1,1],outer_cell_edges_wsen:[-.5,-.5,16.5,16.5]},prototype:{factor:4}};
const surface=contourSurface(metadata,split);assert.equal(surface.sample(32,32),undefined);assert.equal(surface.sample(12,12),7);
assert.deepEqual(surface.metadata.grid.outer_cell_edges_wsen,[-.125,-.125,16.125,16.125]);
// Independent Gaussian expectation at an impulse and continuity at a spline knot.
const impulse={width:17,height:17,values:new Float32Array(289),valid:new Uint8Array(289).fill(1)};impulse.values[8*17+8]=1;
const blurred=gaussianSurface(impulse),sum=Array.from({length:9},(_,i)=>Math.exp(-((i-4)**2)/(2*1.2**2))).reduce((a,b)=>a+b);
assert.ok(Math.abs(blurred.values[8*17+8]-1/(sum*sum))<1e-7);
const continuous=contourSurface(metadata,blurred),h=.001;
const left=(continuous.sample(32,32)-continuous.sample(32-h,32))/h,right=(continuous.sample(32+h,32)-continuous.sample(32,32))/h;
assert.ok(Math.abs(left-right)<1e-4);
for(let y=0;y<65;y++)for(let x=0;x<65;x++){const v=continuous.sample(x,y);assert.ok(v>=0&&v<=1);}
const rows=[],report=JSON.parse(fs.readFileSync(reportPath)),dirs=fs.readdirSync(source).map(d=>source+'/'+d);
for(const row of report.rows){
    const dir=dirs.find(d=>JSON.parse(fs.readFileSync(d+'/receipt.json')).selection===row.selection);
    const metadata=JSON.parse(fs.readFileSync(`${dir}/${row.factor}/native.json`)),blocks=[];
    for(let y=0;y<=metadata.rows[1];y++)for(let x=0;x<=metadata.columns[1];x++){
        const b=fs.readFileSync(`${dir}/${row.factor}/${x}-${y}.f32`);blocks.push(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
    }
    let result;const messages=[];
    const context=vm.createContext({performance,Float32Array,Float64Array,Uint8Array,ArrayBuffer,NativeContours,screenProjector,projectedPieces,lineLength,gaussianSurface,contourSurface,
        self:{postMessage:m=>{if(m.type==='error')throw Error(m.message);if(m.type==='result')result=m;else messages.push(m);},close(){}}});
    vm.runInContext(workerSource,context);
    context.self.onmessage({data:{type:'start',metadata,profile:row.contours.profile,view:row.contours.view,count:blocks.length}});
    while(messages.length){const m=messages.shift();assert.equal(m.type,'block');context.self.onmessage({data:{type:'block',index:m.index,buffer:blocks[m.index]}});}
    assert.ok(result);const after=geometryQuality(result.curves);
    const old=[],project=screenProjector(metadata,row.contours.view);
    const engine=new NativeContours(metadata,row.contours.profile,(level,native)=>{
        for(const line of projectedPieces(native,project,row.contours.view))if(lineLength(line)>=60)old.push({level,points:smoothLine(simplifyLine(line),row.factor===1?.6:row.factor)});
    },{maxBytes:32*1024**2});blocks.forEach((b,i)=>engine.addBlock(i,b));engine.finish();
    rows.push({name:row.name,before:geometryQuality(old),after,elapsed_ms:result.elapsed_ms,surface:result.stats.surface});
    console.log(JSON.stringify(rows.at(-1)));
}
const checks={no_intersections:rows.every(r=>r.after.intersections===0),baseline_failure_reproduced:rows.some(r=>r.before.intersections>0),
    fewer_sharp_turns:rows.reduce((n,r)=>n+r.after.sharpTurns,0)<rows.reduce((n,r)=>n+r.before.sharpTurns,0)};
const result={status:Object.values(checks).every(Boolean)?'passed':'failed',checks,rows,resources_created:0};
fs.mkdirSync(path.dirname(destination),{recursive:true});
// The caller supplies a workspace report destination.
fs.writeFileSync(destination,JSON.stringify(result,null,2),{flag:'wx'});
assert.equal(result.status,'passed',JSON.stringify(checks));
