import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/** Untimed actual GPU readback, separate from performance profiles. */
export async function captureScalarReference({call,evaluate,wait,click,select,capture,report,directory}){
    const corpus=JSON.parse(await readFile(process.env.T19_CORPUS,'utf8'));
    const pinned=corpus.selections.find(s=>s.field_label==='Поле GRIB 0.3.1');assert.ok(pinned);
    await click('#field-group-pressure');await click('.fieldOption[data-field="'+pinned.field+'"]');
    await wait('window.captureWeatherEvidence().ready','reference pressure field');
    await click('#settings');
    const options=await evaluate("[...document.querySelector('#run').options].map(o=>JSON.parse(o.value))");
    const index=options.findIndex(key=>key[2]===pinned.revision&&key[3]===pinned.field);assert.ok(index>=0);
    await select('#run',true,index);await wait('window.captureWeatherEvidence().ready','reference pinned revision');
    report.scalar_reference=[];
    for(const [mode,index] of [['mercator',0],['orthographic',1],['laea',2]]){
        await click('#settings');await select('#projection',true,index);
        await wait(`window.captureWeatherEvidence().ready&&window.captureWeatherEvidence().mode===${JSON.stringify(mode)}`,'reference projection');
        await click('#closeDrawer');
        await new Promise(resolve=>setTimeout(resolve,300));
        const state=await capture(true);assert.ok(state.view?.samples.length,'Actual GPU numerical readback');
        assert.ok(state.managed_bytes<=128*1024**2);
        report.scalar_reference.push({mode,identity:state.selected,source_crs:state.source_crs,view:state.view,
            managed_bytes:state.managed_bytes,heap:await call('Runtime.getHeapUsage')});
        const shot=await call('Page.captureScreenshot',{format:'png'});
        await writeFile(join(directory,'scalar-reference-'+mode+'.png'),Buffer.from(shot.data,'base64'));
    }
    report.checks.push('Untimed pressure GPU readback in three projections for independent raw-GRIB/PROJ comparison');
}
