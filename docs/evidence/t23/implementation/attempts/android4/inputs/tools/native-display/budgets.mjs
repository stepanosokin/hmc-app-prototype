import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function assertBudgets(report) {
    assert.ok(report.viewports.length>0,'No measured viewports');
    for(const view of report.viewports){
        assert.ok(view.cold_first_show_ms<=3000,`Cold first show ${view.cold_first_show_ms}ms > 3000ms`);
        assert.ok(view.warm_mode_switch_ms<=1000,`Warm switch ${view.warm_mode_switch_ms}ms > 1000ms`);
        assert.ok(view.transfer_bytes<=8*1024**2,'Transfer budget exceeded');
        const frameLimit=report.physical_mobile?50:33;
        assert.ok(view.interaction?.rotation_same_map,'Continuous rotation recreated the map or was not measured');
        assert.ok(view.interaction.rotation_frame_p95_ms<=frameLimit,
            `Rotation p95 ${view.interaction.rotation_frame_p95_ms}ms > ${frameLimit}ms`);
        for(const mode of view.views){
            assert.ok(mode.scripted_pan_zoom_p95_ms<=frameLimit,'Pan/zoom frame budget exceeded');
            assert.ok(mode.estimated_managed_bytes<=128*1024**2,'Managed numerical resource budget exceeded');
        }
    }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
    assertBudgets(JSON.parse(await readFile(process.argv[2],'utf8')));
    console.log('Measured native display budgets passed');
}
