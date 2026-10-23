import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=path.resolve('docs/evidence/grib-crs-metadata');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=async name=>JSON.parse((await fs.readFile(path.join(root,name),'utf8')).replace(/^\uFEFF/,''));
const copies=await read('copy-manifest.json');
for(const entry of copies.files){const bytes=await fs.readFile(path.join(root,entry.path));assert.equal(bytes.length,entry.bytes,entry.path);assert.equal(sha(bytes),entry.sha256,entry.path);}
const frozen=await read('checks/acceptance4/inputs-start.json'),end=await read('checks/acceptance4/inputs-end.json');
assert.deepEqual(frozen.files,end.files);assert.deepEqual(frozen.sources,end.sources);
const inputLocations=new Map();
for(const entry of frozen.files){const file='checks/acceptance4/inputs/'+entry.path,bytes=await fs.readFile(path.join(root,file));assert.equal(sha(bytes),entry.sha256,file);inputLocations.set(entry.path,{file,sha256:entry.sha256});}
const viewer='attempts/hmc-publication-t13-grib49-final3/';
const startViewer=await read(viewer+'inputs-start.json');assert.deepEqual(startViewer,await read(viewer+'inputs-end.json'));
for(const [name,entry] of Object.entries(startViewer)){const file=viewer+'inputs/'+name,bytes=await fs.readFile(path.join(root,file));assert.equal(bytes.length,entry.bytes,file);assert.equal(sha(bytes),entry.sha256,file);if(inputLocations.has(name))assert.equal(inputLocations.get(name).sha256,entry.sha256,name);else inputLocations.set(name,{file,sha256:entry.sha256});}
const native='attempts/hmc-publication-t23a-grib49-final4/';
const nativeStart=await read(native+'probe-inputs-start.json');assert.deepEqual(nativeStart,await read(native+'probe-inputs-end.json'));
for(const entry of nativeStart){assert.ok(inputLocations.has(entry.path),entry.path);assert.equal(inputLocations.get(entry.path).sha256,entry.sha256,entry.path);}
for(const name of ['native-comparison.json','native-comparison-edge.json'])assert.equal((await read(native+name)).status,'passed');
for(const name of ['browser','browser-edge']){const report=await read(viewer+name+'/browser.json');assert.equal(report.status,'passed');assert.equal(report.configuration.focused,false);assert.equal(report.cleanup.profile_removed,true);assert.equal(report.cleanup.browser_processes_remaining,0);}
for(const name of ['chrome','edge']){const report=await read('checks/browser-final3-'+name+'/browser.json');assert.equal(report.status,'passed');assert.equal(report.cases.length,12);assert.ok(report.cases.every(c=>c.gpu_max_error_K<=.01));assert.equal(report.cleanup.browser_stopped,true);assert.equal(report.cleanup.profile_removed,true);}
const custom='attempts/hmc-publication-grib49-final3/';
assert.equal((await read(custom+'six-template-http.json')).cases.length,6);
assert.equal((await read(custom+'qgis-six-templates.json')).observations.length,12);
assert.equal((await read(custom+'full-source-verification.json')).native_cells_checked,144);
const integration='attempts/hmc-publication-t12-grib49-final3/';
const gate=await read(integration+'gate.json');assert.equal(gate.status,'passed');assert.equal(gate.m3_passed,true);assert.equal(gate.development,false);
assert.equal((await read(integration+'t11-desktop.json')).qgis_version,'3.44.11-Solothurn');
assert.ok(Object.values((await read(integration+'qgis-desktop-cleanup.json')).cleanup).every(Boolean));
const recovery=await fs.readFile(path.join(root,'attempts/hmc-publication-t6-grib49-final3/process-results.jsonl'),'utf8');
for(const line of recovery.trim().split(/\r?\n/))assert.equal(JSON.parse(line).native_exit_code,0);
const live=await read('live/full-source-verification.json');assert.equal(live.status,'passed');assert.equal(live.files,1);assert.equal(live.new_times,24);assert.equal(live.native_cells_checked,144);assert.equal(live.rejected_files,0);
assert.equal((await read('live/retained-readers.json')).old_values_and_bytes_unchanged,true);
assert.equal((await read('live/retention-restored.json')).original_policy_restored,true);
const liveBrowsers=await read('live/live-browser-selections.json');assert.equal(liveBrowsers.observations.length,2);assert.ok(liveBrowsers.observations.every(b=>b.ready&&b.revision==='d17ce16ff7bba9da289aaa965c28207b4c80f49ac78b293658adf0d020a972b5'));
const retirements=copies.files.filter(entry=>entry.path.startsWith('retirement/')&&entry.path.endsWith('/retirement.json'));
assert.equal(new Set(retirements.map(entry=>entry.path.split('/')[1])).size,18);
for(const entry of retirements){const receipt=await read(entry.path);assert.equal(receipt.status,'retired');assert.equal(receipt.archive_verified,true);assert.ok(Object.values(receipt.remaining).every(values=>values.length===0));}
await fs.writeFile(path.join(root,'cleanup-summary.json'),JSON.stringify({status:'passed',retired_projects:18,receipts:retirements.map(entry=>entry.path),retained_user_stack:'hmc-app-live',unrelated_projects_and_caches:'preserved',runtime_snapshots_removed:true,browser_profiles:'removed'},null,2)+'\n');
await fs.writeFile(path.join(root,'validation-summary.json'),JSON.stringify({status:'passed',starting_commit:frozen.starting_commit,selected_frozen_inputs:'checks/acceptance4',frozen_files:frozen.files.length,source_grib_files:frozen.sources,union_inputs:[...inputLocations].map(([name,entry])=>({path:name,...entry})),selected_gates:{integration,recovery:'attempts/hmc-publication-t6-grib49-final3/',native,viewer,six_templates:custom},live_revision:liveBrowsers.observations[0].revision,live_times:24,live_native_cells:144,retention_original_restored:true,review:'review.md',physical_mobile_scope:'not requested; desktop emulation is not physical acceptance'},null,2)+'\n');
const files=[];let tokenCount=0;
async function walk(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await walk(file);else if(entry.isFile()&&file!==path.join(root,'artifact-index.json')){const bytes=await fs.readFile(file);if(/hmc_[a-f0-9]{32}_[A-Za-z0-9_-]{43}/.test(bytes.toString('utf8')))throw Error('Potential API token in artifact: '+file);files.push({path:path.relative(root,file).replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)});}}}
await walk(root);files.sort((a,b)=>a.path.localeCompare(b.path));
await fs.writeFile(path.join(root,'artifact-index.json'),JSON.stringify({schema:'hmc-grib-crs-evidence/1',status:'passed',observed_at:new Date().toISOString(),secret_token_scan:'passed',files},null,2)+'\n');
console.log(JSON.stringify({status:'passed',copied_artifacts:copies.files.length,indexed_artifacts:files.length,frozen_union_inputs:inputLocations.size,retired_projects:18,live_times:24}));
