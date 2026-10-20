import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=process.cwd(),out=path.join(root,'docs/evidence/t23a');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
function copy(from,to){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}
function tree(from,to){for(const entry of fs.readdirSync(from,{withFileTypes:true})){const a=path.join(from,entry.name),b=path.join(to,entry.name);if(entry.isDirectory())tree(a,b);else copy(a,b);}}
const projects=fs.readdirSync('data/archives/publication').filter(p=>p.startsWith('hmc-publication-t23a-')||p==='hmc-publication-t9-t23a-dev1'||/^hmc-publication-t(?:12|6)-t23a-final/.test(p));
const receipts=[];
for(const project of projects){
    const base=path.join('data/archives/publication',project);
    for(const id of fs.readdirSync(base)){
        const archive=path.join(base,id),receipt=path.join(archive,'retirement.json');
        if(!fs.existsSync(receipt))continue;
        const destination=path.join(out,'attempts',project,id);
        tree(archive,destination);
        receipts.push(path.relative(out,path.join(destination,'retirement.json')).replaceAll('\\','/'));
    }
}
const native=process.argv[2],t12=process.argv[3],t6=process.argv[4];
if(!native||!t12||!t6){console.log(JSON.stringify({archived_projects:projects.length}));process.exit(0);}
function projectPrefix(project){const matches=receipts.filter(p=>p.includes('/'+project+'/'));if(matches.length!==1)throw Error('Ambiguous retirement: '+project);return path.posix.dirname(matches[0])+'/reports/';}
const nativePrefix=projectPrefix(native);
const rawStart=nativePrefix+'probe-inputs-start.json',rawEnd=nativePrefix+'probe-inputs-end.json';
const inputs=read(path.join(out,rawStart)),endInputs=read(path.join(out,rawEnd));
if(JSON.stringify(inputs)!==JSON.stringify(endInputs))throw Error('Runner inputs changed');
const browserPaths=['browser','browser-edge'].map(b=>nativePrefix+b+'/browser.json');
const browserInputs=browserPaths.map(p=>read(path.join(out,p)).inputs);
if(JSON.stringify(browserInputs[0])!==JSON.stringify(browserInputs[1]))throw Error('Browser inputs changed');
const extras=[];
for(const [sourcePath,sha256] of Object.entries(browserInputs[0])){
    const existing=inputs.find(x=>x.path===sourcePath);
    if(existing&&existing.sha256!==sha256)throw Error('Browser/runner source conflict: '+sourcePath);
    if(!existing){const item={path:sourcePath,sha256};inputs.push(item);endInputs.push(item);extras.push(sourcePath);}
}
const inventory='validation/combined-inputs-start.json',endInventory='validation/combined-inputs-end.json';
fs.mkdirSync(path.join(out,'validation'),{recursive:true});
for(const [name,value] of [[inventory,inputs],[endInventory,endInputs],['validation/input-provenance.json',
    {method:'union of unchanged runner start/end and identical Chrome/Edge browser input hashes; originals preserved',runner_start:rawStart,runner_end:rawEnd,browser_reports:browserPaths,additional_browser_inputs:extras}]])
    fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');
for(const entry of inputs){const from=path.join(root,entry.path);if(hash(fs.readFileSync(from))!==entry.sha256)throw Error('Source changed: '+entry.path);copy(from,path.join(out,'inputs',entry.path));}
// The retirement helper deliberately does not retain executable vendor files.
for(const browser of ['browser','browser-edge']){
    const from=path.join('data/reports/t23a',native,browser,'vendor');
    if(fs.existsSync(from))tree(from,path.join(out,nativePrefix,browser,'vendor'));
}
const selected=['chrome','edge'].map(browser=>({browser,project:native,
    report:nativePrefix+(browser==='edge'?'browser-edge':'browser')+'/browser.json',
    comparison:nativePrefix+(browser==='edge'?'native-comparison-edge.json':'native-comparison.json'),
    inputs_end:endInventory}));
const reference=read(path.join(out,nativePrefix+'native-reference.json'));
const blocks=read(path.join(out,nativePrefix+'native-blocks.json'));
const source='dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a';
if(blocks.source_sha256!==source||blocks.selection.selection!==reference.selection.selection)throw Error('Native reference/block identity mismatch');
for(const selection of selected){
    const report=read(path.join(out,selection.report)),comparison=read(path.join(out,selection.comparison));
    if(report.reference_sha256!==hash(fs.readFileSync(path.join(out,nativePrefix+'native-reference.json')))||comparison.source_sha256!==source||report.viewports.some(v=>v.selection!==reference.selection.selection))throw Error('Browser reference identity mismatch');
}
for(const project of [t12,t6]){
    const prefix=projectPrefix(project);
    const inventory=read(path.join(out,prefix+(project===t12?'inputs-start.json':'inputs.json')));
    if(inventory.actual_source_sha256!==source)throw Error('Regression source differs');
}
const index={schema:1,contract:'inputs/publication/native-display.v1.json',input_inventory:inventory,
    selected,blocks:nativePrefix+'native-blocks.json',regressions:[{name:'t12',project:t12,result:projectPrefix(t12)+'gate.json',inputs:projectPrefix(t12)+'inputs-start.json'},
    {name:'t6',project:t6,result:projectPrefix(t6)+'gate.json',inputs:projectPrefix(t6)+'inputs.json'}],retirements:receipts,artifacts:[]};
function list(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?list(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const file of list(out).sort()){
    const name=path.relative(out,file).replaceAll('\\','/');
    if(name==='artifact-index.json'||(!name.includes('/')&&name.endsWith('.md')))continue;
    const bytes=fs.readFileSync(file);index.artifacts.push({name,bytes:bytes.length,sha256:hash(bytes)});
}
fs.writeFileSync(path.join(out,'artifact-index.json'),JSON.stringify(index,null,2)+'\n');
console.log(JSON.stringify({archived_projects:projects.length,artifacts:index.artifacts.length}));
