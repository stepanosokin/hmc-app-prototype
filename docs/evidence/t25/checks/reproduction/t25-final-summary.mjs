import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const read=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const results=[];
for(const [project,browser] of [['desktop-final4','browser'],['desktop-final4','browser-edge'],['android-final3','browser']]){
    const root='data/reports/t13/hmc-publication-t13-t25-'+project+'/';
    const report=await read(root+browser+'/browser.json'),numeric=await read(root+browser+'-time-comparison.json');
    assert.equal(report.status,'passed');assert.equal(numeric.status,'passed');assert.equal(report.network.status,'passed');
    assert.equal(report.time_switch.modes.length,3);assert.equal(report.time_switch.numerical.length,6);
    for(const mode of report.time_switch.modes){
        for(const key of ['context_asset_requests_unchanged','camera_map_point_panel_preserved','gap_clears','error_retains_labelled_frame','expiry_hides'])assert.equal(mode[key],true);
        assert.ok(mode.max_managed_bytes<=128*1024**2);assert.ok(mode.memory.maxArrays<=2);assert.equal(mode.memory.retiredWrites,0);
    }
    assert.equal(numeric.mask_differences,0);assert.ok(numeric.max_abs_error_K<=0.01);
    for(const [key,value] of Object.entries(report.cleanup))assert.equal(value,key==='browser_processes_remaining'?0:true,key);
    results.push({project,browser,status:report.status,browser_version:report.browser,gpu:report.gpu,checks:report.checks.length,
        network:report.network.status,confirmed_retired_interceptions:report.network.retired_interceptions.length,
        modes:report.time_switch.modes.map(mode=>({mode:mode.mode,max_managed_bytes:mode.max_managed_bytes,max_textures:mode.memory.maxArrays,retired_writes:mode.memory.retiredWrites})),
        numerical:{valid_gpu_samples:numeric.valid_gpu_samples,max_abs_error_K:numeric.max_abs_error_K,mask_differences:numeric.mask_differences,point_tolerance_K:numeric.point_tolerance_K},cleanup:report.cleanup});
}
await writeFile('docs/evidence/t25/checks/final-results.json',JSON.stringify({phase:'acceptance before commit/push',observed_at:new Date().toISOString(),status:'passed',platforms:results},null,2)+'\n');
console.log(JSON.stringify(results.map(r=>({project:r.project,browser:r.browser,checks:r.checks,numerical:r.numerical,max_managed_bytes:Math.max(...r.modes.map(m=>m.max_managed_bytes)),confirmed_retired_interceptions:r.confirmed_retired_interceptions}))));
