import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeContours,nativeBlockRange} from './contour-grid.js';
import {displaySpec,displayValue,displayNumber,contourProfile} from './display-units.js';
import {simplifyLine,smoothLine,lineLength,projectedPieces,clipScreenLine,nativeContourTransform,mapWidthKm,packScreenLine,projectedNativeWindow} from './contour-geometry.js';
import {nativePosition} from './source-crs.js';
import {readFileSync} from 'node:fs';

function fixture(nx,ny,value,valid=()=>true){
 const columns=Math.ceil(nx/256),rows=Math.ceil(ny/256),blocks=[];
 for(let by=0;by<rows;by++)for(let bx=0;bx<columns;bx++){
  const buffer=new ArrayBuffer(332820),a=new Float32Array(buffer,0,258*258),mask=new Uint8Array(buffer,258*258*4);
  for(let r=0;r<258;r++)for(let c=0;c<258;c++){
   const x=bx*256+c-1,y=by*256+r-1,i=r*258+c;
   if(x>=0&&x<nx&&y>=0&&y<ny&&valid(x,y)){a[i]=value(x,y);mask[i]=1;}
  }blocks.push(buffer);
 }
 return {metadata:{columns:[0,columns-1],rows:[0,rows-1],grid:{shape_yx:[ny,nx]}},blocks};
}
function contours(f,step=1,extra={}){
 const paths=[],engine=new NativeContours(f.metadata,{factor:1,offset:0,step},(level,points,closed)=>paths.push({level,points,closed}),extra);
 for(const [i,b] of f.blocks.entries()){
  engine.addBlock(i,b);
  assert.equal(engine.starts.size,engine.paths.size,'Every live path retains its own start');
  assert.equal(engine.ends.size,engine.paths.size,'Every live path retains its own end');
 }const stats=engine.finish();return {paths,stats};
}
test('display conversions retain source values and distinguish contradictory accumulated rates',()=>{
 const p={units:'Pa',field_short_name:'sp'};assert.equal(displayValue(101325,p),1013.25);assert.equal(p.units,'Pa');assert.equal(displaySpec(p).unit,'гПа');
 assert.equal(displayValue(.007,{units:'kg kg**-1',field_short_name:'q'}),7);
 assert.equal(displayValue(.4,{units:'m',field_short_name:'sde'}),40);
 assert.equal(displayValue(.001,{units:'kg m**-2 s**-1'}),3.6);
 const ambiguous={units:'kg m**-2 s**-1',field_short_name:'lsrr',interval:{statistical_process:1}};
 assert.equal(displayValue(12,ambiguous),12);assert.match(displaySpec(ambiguous).note,/противоречат/);
 assert.equal(displayNumber(273.15,{units:'K',field_short_name:'2t'}),'0');
 assert.equal(displaySpec({units:'unknown'}).factor,1);assert.match(displaySpec({units:'unknown'}).note,/не определены/);
});
test('chosen custom intervals and exact scale boundaries are retained',()=>{
 const pressure={units:'Pa',field_short_name:'sp'},visibility={units:'m',field_short_name:'vis'};
 assert.deepEqual([6001,6000,2000].map(w=>contourProfile(pressure,w).step),[25,20,5]);
 assert.deepEqual([6001,6000,2000].map(w=>contourProfile(visibility,w).step),[20000,10000,5000]);
 assert.equal(contourProfile({units:'unknown',field_label:'Поле GRIB 0.6.1'},10000).step,25);
 assert.equal(contourProfile({units:'unknown',field_label:'Поле GRIB 0.0.18'},1000).step,2);
});

test('all 29 approved field intervals agree with the normative requirements table',()=>{
 const rows=readFileSync(new URL('../docs/design/field-contours-discussion.md',import.meta.url),'utf8').split('\n')
  .filter(line=>/^\| .+ \| .+ \| \d+ \| \d+ \| \d+ \|/.test(line));
 const shorts=['prmsl','sp','2t','t','sot','min_2t','max_2t','2d','T_G','q','2sh','2r','ccl','ccl','ccl','max_i10fg','tp','cp','lsp','lsfwe','csfwe','sde','sd','tgrp','vis','','','lsrr','crr'];
 assert.equal(rows.length,29);
 rows.forEach((row,index)=>{
  const expected=row.split('|').slice(3,6).map(Number),source={field_short_name:shorts[index],field_label:row.split('|')[1]};
  assert.deepEqual([10000,4000,1000].map(w=>contourProfile(source,w).step),expected,source.field_label);
 });
});

test('geographic width uses surface distance rather than inflated Mercator metres',()=>{
 const view={width:1000,height:500,origin:[500,250],scale:.001,mode:'mercator'};
 const r=6378137,lat=60*Math.PI/180;
 const width=mapWidthKm(view,([x])=>[x/r*180/Math.PI,60]);
 assert.ok(Math.abs(width-1000*Math.cos(lat)*6371.0088/(r/1000))<.01);
});

test('forward native-cell bounds retain disconnected visible pieces and crossings without visible corners',()=>{
 const metadata={grid:{shape_yx:[200,300]}},view={width:100,height:100};
 const project=(x,y)=>x<45?[x-50,y-50,0]:x>210?[x-200,y-80,0]:undefined;
 const window=projectedNativeWindow(metadata,view,project);
 for(let y=0;y<200;y++)for(let x=0;x<300;x++){
  const p=project(x,y);if(p&&p[0]>=-24&&p[0]<=124&&p[1]>=-24&&p[1]<=124)
   assert.ok(x>=window[0]&&x<=window[2]+1&&y>=window[1]&&y<=window[3]+1);
 }
 const crossing=projectedNativeWindow({grid:{shape_yx:[2,2]}},view,(x,y)=>[-100+x*300,-100+y*300,0]);
 assert.deepEqual(crossing,[0,0,0,0]);
});

test('closed rings and exact saddle vertices retain all segments without orphan paths',()=>{
 for(const value of [(x,y)=>(x-4)**2+(y-4)**2,(x,y)=>(x-4)*(y-4)]){
  const {paths,stats}=contours(fixture(9,9,value),2);
  assert.ok(paths.length>0);let segments=0;
  for(const path of paths){segments+=path.points.length/2-1;
   if(path.closed)assert.deepEqual([...path.points.slice(0,2)],[...path.points.slice(-2)]);
  }
  assert.equal(segments,stats.segments);
 }
 const cropped=contours(fixture(600,10,(x,y)=>y),1,{window:[250,2,270,5]});
 assert.equal(cropped.stats.cells,84);
 for(const p of cropped.paths)for(let i=0;i<p.points.length;i+=2)assert.ok(p.points[i]>=250&&p.points[i]<=271);
});
test('native contours cross block halos once and retain valid zero nodes',()=>{
 const f=fixture(260,3,(x,y)=>y),original=f.blocks.map(b=>b.slice(0));
 const {paths,stats}=contours(f);
 assert.equal(stats.cells,518);assert.equal(paths.length,2);
 const p=paths.find(p=>p.level===1);assert.ok(p);
 const xs=[...p.points].filter((_,i)=>i%2===0);
 assert.equal(Math.min(...xs),0);assert.equal(Math.max(...xs),259);
 assert.equal(p.points.length,520); // one path, with no duplicated seam cell
 f.blocks.forEach((b,i)=>assert.deepEqual(new Uint8Array(b),new Uint8Array(original[i])));
});
test('linear-cell intersections satisfy the numeric level and higher-side orientation',()=>{
 const {paths}=contours(fixture(13,9,(x,y)=>2*x+3*y),5);
 assert.ok(paths.length>5);
 for(const p of paths){
  for(let i=0;i<p.points.length;i+=2)assert.ok(Math.abs(2*p.points[i]+3*p.points[i+1]-p.level)<1e-9);
  for(let i=2;i<p.points.length;i+=2){const dx=p.points[i]-p.points[i-2],dy=p.points[i+1]-p.points[i-1];assert.ok(dx*3-dy*2>=-1e-12);}
 }
});
test('numeric NoData creates real breaks; a uniform field creates no artificial coverage boundary',()=>{
 const {paths}=contours(fixture(6,3,(x,y)=>y,(x)=>x!==3));
 assert.ok(paths.length>1);
 for(const p of paths)for(let i=2;i<p.points.length;i+=2)assert.ok(Math.abs(p.points[i]-p.points[i-2])<=1);
 assert.equal(contours(fixture(5,5,()=>7)).paths.length,0);
});

test('level bounds come from native numerical masks, independently of clipped colour ranges and transparent zero',()=>{
 const f=fixture(260,4,(x,y)=>x+y,(x,y)=>!(x===259&&y===3));
 Object.assign(f.metadata,{display_range:[50,100],zero_transparent:true});
 const ranges=f.blocks.map((b,i)=>nativeBlockRange(f.metadata,i,b));
 assert.equal(Math.min(...ranges.map(r=>r.low)),0);assert.equal(Math.max(...ranges.map(r=>r.high)),261);
 const cropped=f.blocks.map((b,i)=>nativeBlockRange(f.metadata,i,b,[255,1,257,2]));
 assert.equal(Math.min(...cropped.map(r=>r.low)),256);assert.equal(Math.max(...cropped.map(r=>r.high)),261);
});
test('saddle topology follows the asymptotic decider rather than an arbitrary fixed diagonal',()=>{
 const positive=contours(fixture(2,2,(x,y)=>x===y?2:-1),10).paths;
 const negative=contours(fixture(2,2,(x,y)=>x===y?1:-2),10).paths;
 assert.equal(positive.length,2);assert.equal(negative.length,2);
 const side=p=>[...p.points].filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0);
 assert.notDeepEqual(positive.map(side),negative.map(side));
});
test('working geometry has a real admission guard',()=>{
 assert.throws(()=>contours(fixture(10,10,(x,y)=>x+y),1,{maxBytes:1}),/бюджет/);
});

test('exact zero plateaus and touching islands keep distinct topological edges',()=>{
 for(const value of [(x,y)=>(x+y)%2?0:1,(x,y)=>x%3&&y%3?10:0,(x,y)=>Math.max(0,4-Math.abs(x%9-4)-Math.abs(y%9-4))]){
  const {paths,stats}=contours(fixture(260,12,value));
  assert.equal(paths.reduce((n,p)=>n+p.points.length/2-1,0),stats.segments);
 }
});
function distance(point,line){let best=Infinity;for(let i=2;i<line.length;i+=2){
 const ax=line[i-2],ay=line[i-1],dx=line[i]-ax,dy=line[i+1]-ay,n=dx*dx+dy*dy;
 const t=n?Math.max(0,Math.min(1,((point[0]-ax)*dx+(point[1]-ay)*dy)/n)):0;
 best=Math.min(best,Math.hypot(point[0]-ax-dx*t,point[1]-ay-dy*t));}return best;}
test('combined simplification and rounding stay within a symmetric one-pixel envelope',()=>{
 for(const original of [[0,0,10,0,10,10,20,10],[0,0,8,0,8,8,0,8,0,0],Array.from({length:60},(_,i)=>[i,Math.sin(i)*2]).flat()]){
  const changed=smoothLine(simplifyLine(original));
  for(const [a,b] of [[original,changed],[changed,original]])for(let i=2;i<a.length;i+=2)for(let t=0;t<=1;t+=.1){
   const p=[a[i-2]+(a[i]-a[i-2])*t,a[i-1]+(a[i+1]-a[i-1])*t];assert.ok(distance(p,b)<=1+1e-9);
  }
  assert.ok(lineLength(changed)>0);
 }
});

test('screen packing preserves the combined pixel bound, including 4K and wide-screen fallback',()=>{
 for(const width of [360,1440,3840,7680,12000]){
  const original=[-24,-24,12.19,40.83,20.11,12.37,width+24,98.73];
  const precise=smoothLine(simplifyLine(original)),{points,quantum,offset}=packScreenLine(precise,width,900);
  const restored=[...points].map(v=>v*quantum+offset);
  for(let i=0;i<restored.length;i+=2)assert.ok(Math.hypot(restored[i]-precise[i],restored[i+1]-precise[i+1])<=.09);
  for(const [a,b] of [[original,restored],[restored,original]])for(let i=2;i<a.length;i+=2)for(let t=0;t<=1;t+=.01)
   assert.ok(distance([a[i-2]+(a[i]-a[i-2])*t,a[i-1]+(a[i+1]-a[i-1])*t],b)<=1);
 }
});

test('disjoint level batches reproduce the unsplit native geometry exactly',()=>{
 const f=fixture(270,8,(x,y)=>Math.sin(x/17)*15+y-10),whole=contours(f,2);
 const chunks=[];for(let low=-13;low<=20;low+=4)chunks.push(...contours(f,2,{levels:[low,low+3]}).paths);
 const canonical=paths=>paths.map(p=>JSON.stringify([p.level,[...p.points],p.closed])).sort();
 assert.deepEqual(canonical(chunks),canonical(whole.paths));
});
test('projection clipping does not connect across a hidden strip',()=>{
 const p=projectedPieces(new Float64Array([0,0,1,0,2,0,3,0,4,0]),(x,y)=>x>1.2&&x<2.8?undefined:[x*100,y,0],{width:500,height:100});
 assert.equal(p.length,2);for(const line of p)assert.ok(Math.max(...line.filter((_,i)=>i%2===0))-Math.min(...line.filter((_,i)=>i%2===0))<150);
});

test('the geographic dateline only splits Mercator, not continuous LAEA or globe curves',()=>{
 const native=new Float64Array([0,0,1,0,2,0,3,0,4,0]),project=x=>[x*50,50,(177+x+180)%360-180];
 assert.equal(projectedPieces(native,project,{mode:'mercator',width:500,height:100}).length,2);
 for(const mode of ['hmc:laea-rf','EPSG:3576','hmc:orthographic'])assert.equal(projectedPieces(native,project,{mode,width:500,height:100}).length,1);
});
test('viewport clipping bounds float32 error and keeps disconnected visible portions separate',()=>{
 const pieces=clipScreenLine([-1e8,10,50,10,1e8,10,1e8,90,50,90,-1e8,90],100,100);
 assert.equal(pieces.length,2);
 for(const p of pieces){const f=new Float32Array(smoothLine(simplifyLine(p)));
  for(let i=0;i<f.length;i+=2){assert.ok(f[i]>=-24&&f[i]<=124);assert.ok(f[i+1]>=-24&&f[i+1]<=124);}
 }
});
test('cached spherical native operation agrees with the operative source CRS operation',()=>{
 const spec={template:1,datum_mode:'explicit-geocentric',semi_major_m:6371229,semi_minor_m:6371229,
  rotation:{south_lat:-25,south_lon:90,angle:13},prime_meridian_degrees:0,configuration:{values:{coordinate_height_m:0,geocentric_translation_m:[0,0,0],prime_meridian_degrees:0}}};
 const convert=nativeContourTransform(spec);
 for(let x=-60;x<=60;x+=7.7)for(let y=-30;y<=30;y+=4.1){const a=convert([x,y]),b=nativePosition(spec,[x,y],true);
  assert.ok(Math.abs(a[0]-b[0])<1e-10);assert.ok(Math.abs(a[1]-b[1])<1e-10);
 }
});
test('native geographic crossings retain the independent pinned PROJ reference',()=>{
 const reference=JSON.parse(readFileSync(new URL('../tests/fixtures/wind/rotated-reference.json',import.meta.url),'utf8'));
 for(const entry of reference.cases){
  const actual=nativeContourTransform(reference.specs[entry.spec])(entry.xy),expected=entry.expected.geographic;
  assert.ok(Math.abs(actual[0]-expected[0])<1e-9);assert.ok(Math.abs(actual[1]-expected[1])<1e-9);
 }
});
