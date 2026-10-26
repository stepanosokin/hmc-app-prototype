import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {unlink,writeFile} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';

export async function checkWithdrawal({call,evaluate,wait,select,click,capture,report,directory}){
    const project=process.env.T52_PROJECT,fixtures=resolve(process.env.T52_FIXTURES??'');
    assert.match(project,/^hmc-publication-sync-[a-z0-9-]+$/);
    assert.ok(fixtures.startsWith(resolve('data/reports/grib-sync')+sep));
    const results=report.withdrawal={operations:[],checks:[]};
    const apply=async name=>{
        const plan=join(directory,name+'.json');
        for(const operation of ['preview','apply'])results.operations.push({operation,output:execFileSync(process.execPath,
            ['tools/sync-grib.mjs',operation,'--project',project,'--input-directory',fixtures,'--plan',plan],
            {encoding:'utf8',windowsHide:true,timeout:180000})});
    };
    await select('#time',true,2);
    await wait("window.captureWeatherEvidence().ready&&window.captureWeatherEvidence().selected.valid_time==='2026-10-15T03:00:00Z'",'retained B time');
    const before=await capture();
    await unlink(join(fixtures,'a.grib2'));await apply('remove-a');
    await click('#settings');await click('#refresh');
    await wait(`window.captureWeatherEvidence().ready&&window.captureWeatherEvidence().selected.revision!==${JSON.stringify(before.selected.revision)}`,'automatic withdrawal replacement');
    const replacement=await capture();
    assert.equal(replacement.selected.valid_time,before.selected.valid_time);
    assert.equal(replacement.selected.field,before.selected.field);
    assert.equal(replacement.catalogue_pending,false);
    results.checks.push('Surviving field/time switches automatically to replacement');
    await call('Page.captureScreenshot',{format:'png'}).then(image=>writeFile(join(directory,'withdrawal-replacement.png'),Buffer.from(image.data,'base64')));
    await unlink(join(fixtures,'b.grib2'));await apply('empty');
    await click('#refresh');
    await wait("!window.captureWeatherEvidence().frame_visible&&document.getElementById('notice').textContent==='Публикация снята'",'withdrawn frame removed');
    const withdrawn=await capture();
    assert.equal(withdrawn.selected,undefined);assert.equal(withdrawn.displayed,undefined);
    assert.equal(withdrawn.time_state,'withdrawn');
    assert.equal(await evaluate("document.getElementById('availability').textContent"),'Публикация снята');
    assert.equal(await evaluate("document.getElementById('linkPoint').textContent"),'Публикация снята. Перевыберите публикацию.');
    assert.equal(await evaluate("document.getElementById('wmsCopy').disabled&&document.getElementById('apiCopy').disabled"),true);
    const pointRequests=()=>report.requests.filter(item=>item.url.includes('/point?')).length;
    const requestsBefore=pointRequests();
    await click('#closeDrawer');await click('#map');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const clicked=await capture();
    assert.equal(clicked.position,undefined);assert.equal(clicked.point,undefined);
    assert.equal(pointRequests(),requestsBefore,'A withdrawn map cannot start a point series');
    results.checks.push('Map clicks cannot recreate a point or series for a withdrawn publication');
    results.checks.push('Empty source folder removes frame and reports withdrawal in Russian');
    results.states={before,replacement,withdrawn};
    for(const [width,height] of [[1440,900],[390,844]]){
        await call('Emulation.setDeviceMetricsOverride',{width,height,mobile:width<700,deviceScaleFactor:1});
        await wait("(()=>{const e=document.getElementById('availability'),r=e.getBoundingClientRect();return e.textContent==='Публикация снята'&&r.top>=0&&r.bottom<=innerHeight;})()",'visible withdrawn state');
        await call('Page.captureScreenshot',{format:'png'}).then(image=>writeFile(join(directory,`withdrawal-${width}.png`),Buffer.from(image.data,'base64')));
    }
}
