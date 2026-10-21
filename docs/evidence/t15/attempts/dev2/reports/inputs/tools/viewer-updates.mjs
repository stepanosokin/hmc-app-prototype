import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {navigationDelays} from './viewer-navigation.mjs';

export async function checkUpdates({call,evaluate,wait,select,click,capture,origin,report}){
    await call('Page.addScriptToEvaluateOnNewDocument',{source:navigationDelays});
    await call('Page.navigate',{url:origin+'/?validation=1&fixtures=1'});
    await wait('window.captureWeatherEvidence?.().ready','update baseline');
    const initial=await capture();
    await click('#settings');
    const actual=await evaluate("[...document.getElementById('run').options].findIndex(o=>JSON.parse(o.value)[1].startsWith('ICON-EU/'))");
    await select('#run',true,actual);
    await wait('window.captureWeatherEvidence().ready','pinned actual run');
    await select('#time',true,2);
    await wait('window.captureWeatherEvidence().ready','pinned last time');
    const before=await capture();
    const project=process.env.T15_PROJECT;
    assert.match(project,/^hmc-publication-t13-[a-z0-9-]+$/);
    const publish=fixture=>execFileSync('powershell',['-NoProfile','-File','tools/publish-viewer-update.ps1','-Project',project,'-Fixture',fixture],{windowsHide:true,timeout:180000,stdio:'pipe'});
    publish('correction');
    await click('#settings');await click('#refresh');
    await wait("!document.getElementById('acceptUpdate').hidden",'revision notification');
    assert.equal((await capture()).selected.selection,before.selected.selection,'Unaccepted publication preserves pinned field');
    await click('#acceptUpdate');
    await wait(`window.captureWeatherEvidence().ready&&window.captureWeatherEvidence().selected.revision!==${JSON.stringify(before.selected.revision)}`,'explicit revision refresh');
    const after=await capture(true);
    assert.equal(after.selected.run,before.selected.run,'Revision refresh preserves run');
    assert.equal(after.selected.valid_time,before.selected.valid_time,'Revision refresh preserves time');
    assert.equal(after.view.cache_identity.identity.revision,after.selected.revision);
    report.updates={initial:initial.selected,before:before.selected,after:after.selected};
    report.checks.push('T15 explicit same-run refresh preserves valid time and switches GPU identity');
}
