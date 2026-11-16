import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkQgisDesktopPlan, checkQgisSuitePlan} from './check-qgis-preflight.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const wms = read('publication/wms.py');
const desktop = read('publication/qgis_desktop.py');
const runner = read('publication/run-qgis.ps1');
const cli = fileURLToPath(new URL('./check-qgis-preflight.mjs', import.meta.url));

function changed(source, before, after) {
    assert.ok(source.includes(before), `Regression fixture no longer matches: ${before}`);
    return source.replace(before, after);
}

test('current source plan checks a canvas above the current GetMap limit', () => {
    assert.deepEqual(checkQgisDesktopPlan(wms, desktop), {
        status: 'passed', proof: 'source-plan-only', map_limit: 3000,
        render: [3201, 1801], identify: [3201, 1801]
    });
});

test('expanded final acceptance runs the full suite once on T5 before WMS fixtures', () => {
    assert.deepEqual(checkQgisSuitePlan(runner), {
        status: 'passed', proof: 'source-plan-only', expanded_final: 'Prepare', other_modes: 'Complete'
    });
    assert.deepEqual(checkQgisSuitePlan(runner.replaceAll('\n', '\r\n')), checkQgisSuitePlan(runner));
});

test('rejects the old suite placement after the independent WMS fixtures', () => {
    const suite = "            Check full-suite @('run','--rm','--env','T4_HTTP=1','check')\n";
    const late = changed(runner, suite, '').replace('    Check desktop-key @(', suite + '    Check desktop-key @(');
    assert.throws(() => checkQgisSuitePlan(late), /T5 baseline full suite/);
});

test('rejects missing, duplicate or early suite execution', () => {
    const suite = "Check full-suite @('run','--rm','--env','T4_HTTP=1','check')";
    assert.throws(() => checkQgisSuitePlan(changed(runner, suite, '# removed')), /full-suite commands/);
    assert.throws(() => checkQgisSuitePlan(runner + '\n' + suite), /full-suite commands/);
    const early = changed(runner, '            ' + suite + '\n', '')
        .replace("            Check t5-restart @(", '            ' + suite + "\n            Check t5-restart @(");
    assert.throws(() => checkQgisSuitePlan(early), /must follow T5 restart verification/);
});

test('rejects fixtures moved ahead of the baseline suite', () => {
    const fixture = "        Check full-catalogue @('run'";
    const early = changed(runner, fixture, "        Check renamed-catalogue @('run'")
        .replace('    if ($FullCatalogue -or', "    Check full-catalogue @('run')\n    if ($FullCatalogue -or");
    assert.throws(() => checkQgisSuitePlan(early), /must follow the baseline suite/);
});

test('rejects weakened full-suite arguments or an additional differently configured suite', () => {
    const suite = "Check full-suite @('run','--rm','--env','T4_HTTP=1','check')";
    assert.throws(() => checkQgisSuitePlan(changed(runner, suite, "Check full-suite @('run','--rm','check')")), /arguments/);
    assert.throws(() => checkQgisSuitePlan(runner + "\nCheck full-suite @('run','--rm','check')"), /full-suite commands/);
});

test('rejects mode drift that skips or duplicates the suite', () => {
    for (const [before, after] of [
        ['if ($FullCatalogue -or $PublicationUpdates -or $MultiLayer)', 'if ($FullCatalogue -or $PublicationUpdates)'],
        ['if (-not $Development) {', 'if ($Development) {'],
        ['if ($Development -or (-not $FullCatalogue -and -not $PublicationUpdates -and -not $MultiLayer))',
            'if ($Development -or (-not $FullCatalogue -and -not $PublicationUpdates))']
    ]) assert.throws(() => checkQgisSuitePlan(changed(runner, before, after)), /Expected one/);
});

test('rejects the old small render and Identify canvases independently', () => {
    for (const [before, after, message] of [
        ['settings.setOutputSize(QSize(3201, 1801))', 'settings.setOutputSize(QSize(1204, 700))', /Render canvas must exceed/],
        ['canvas.resize(3201, 1801)', 'canvas.resize(1204, 700)', /Identify canvas must exceed/]
    ]) assert.throws(() => checkQgisDesktopPlan(wms, changed(desktop, before, after)), message);
});

test('detects drift when the published GetMap limit increases', () => {
    assert.throws(() => checkQgisDesktopPlan(changed(wms, 'MAX_MAP_SIZE = 3000', 'MAX_MAP_SIZE = 4000'), desktop), /GetMap limit 4000/);
});

test('rejects missing or incorrect actual viewport assertions', () => {
    const line = 'assert canvas.mapSettings().outputSize().width() == 3201';
    assert.throws(() => checkQgisDesktopPlan(wms, changed(desktop, line, '# ' + line)), /actual viewport width assertion/);
    assert.throws(() => checkQgisDesktopPlan(wms, changed(desktop, line, line.replace('3201', '638'))), /assertions differ/);
});

test('rejects an uninitialized hidden layout or a late viewport check', () => {
    assert.throws(() => checkQgisDesktopPlan(wms, changed(desktop, 'canvas.show()', '# canvas.show()')), /layout initialization/);
    assert.throws(() => checkQgisDesktopPlan(wms, changed(desktop, 'QApplication.processEvents()', '# QApplication.processEvents()')), /event processing/);
    const moved = changed(desktop, 'QApplication.processEvents()', '')
        .replace('context = QgsIdentifyContext()', 'QApplication.processEvents()\n        context = QgsIdentifyContext()');
    assert.throws(() => checkQgisDesktopPlan(wms, moved), /must precede Identify/);
});

test('source refactors fail clearly instead of silently passing an unknown plan', () => {
    assert.throws(() => checkQgisDesktopPlan(wms, changed(desktop, 'def identify_in_canvas(', 'def renamed_identify(')), /Expected one identify_in_canvas/);
    assert.throws(() => checkQgisDesktopPlan(wms + '\nMAX_MAP_SIZE = 5000\n', desktop), /Expected one GetMap limit/);
});

test('CLI returns nonzero for an invalid source plan without importing QGIS', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hmc-qgis-preflight-'));
    try {
        fs.writeFileSync(path.join(directory, 'wms.py'), wms);
        fs.writeFileSync(path.join(directory, 'desktop.py'), changed(desktop, 'canvas.resize(3201, 1801)', 'canvas.resize(640, 480)'));
        const result = spawnSync(process.execPath, [cli, path.join(directory, 'wms.py'), path.join(directory, 'desktop.py')], {encoding: 'utf8'});
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Identify canvas must exceed/);
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.match(path.basename(directory), /^hmc-qgis-preflight-/);
        fs.rmSync(directory, {recursive: true, force: true});
        assert.equal(fs.existsSync(directory), false);
    }
});

test('default CLI works outside the repository working directory', () => {
    const result = spawnSync(process.execPath, [cli], {cwd: os.tmpdir(), encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).proof, 'source-plan-only');
    assert.deepEqual(JSON.parse(result.stdout).suite, checkQgisSuitePlan(runner));
});

test('Windows local and manual CI run the guard and its regressions', () => {
    const local = read('tools/check-local.ps1').split("if ($Scope -in @('All', 'Windows'))")[1].split("if ($Scope -in @('All', 'Runtime'))")[0];
    assert.match(local, /Invoke-Check node @\('tools\/check-qgis-preflight\.mjs'\)/);
    assert.match(local, /Invoke-Check node @\('--test', 'tools\/test-qgis-preflight\.mjs'\)/);
    const ci = read('.github/workflows/checks.yml').split('  windows-process:')[1].split('  source-and-runtime:')[0];
    assert.match(ci, /node tools\/check-qgis-preflight\.mjs/);
    assert.match(ci, /node --test tools\/test-qgis-preflight\.mjs/);
});
