import test from 'node:test';
import assert from 'node:assert/strict';
import {parse, Progress, assertOwned, root, composeEnvironment, safeSettingsFile, Operator} from '../hmc-app.mjs';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

test('all agreed commands and scoped options', () => {
    for (const mode of ['deploy', 'remove', 'start', 'stop', 'status', 'refresh-grib'])
        assert.equal(parse([mode, 'hmc-app-live']).mode, mode);
    assert.equal(parse(['refresh-grib', 'live', '--folder', 'path with spaces', '--dry-run']).options['--folder'], 'path with spaces');
    assert.equal(parse(['refresh-grib', 'live', '--remove-all', '--yes']).options['--remove-all'], true);
    assert.equal(parse(['--help']).help, true);
});

test('Compose processing uses the current read-only decoder independently of the saved image', () => {
    const compose = fs.readFileSync(path.join(root, 'compose.publication.yaml'), 'utf8');
    assert.match(compose.split('services:')[0], /\.\/decoder:\/app\/decoder:ro/);
    assert.match(compose.split('  api:')[1].split('  gateway:')[0], /\.\/decoder:\/app\/decoder:ro/);
});
test('README and ADMIN examples use supported common commands', () => {
    let count = 0;
    for (const document of ['README.md', 'ADMIN.md']) {
        const text = fs.readFileSync(path.join(root, document), 'utf8');
        for (const match of text.matchAll(/^node hmc-app\.mjs (.+)$/gm)) {
            assert.doesNotThrow(() => parse(match[1].trim().split(/\s+/)), document + ': ' + match[0]); count++;
        }
    }
    assert.ok(count >= 15);
});
test('reject malformed, ambiguous and out-of-scope commands before Docker', () => {
    for (const args of [['refresh_grib', 'live'], ['deploy', '../live'], ['deploy', 'live', '--yes'],
        ['stop', 'live', '--folder', 'data/grib'], ['refresh-grib', 'live', '--remove-all', '--folder', 'x'],
        ['refresh-grib', 'live', '--yes', '--yes'], ['refresh-grib', 'live', '--storage-budget-bytes', '1e9'],
        ['deploy', 'live', '--api-port', '65536'], ['refresh-grib', 'live', '--folder']]) assert.throws(() => parse(args));
});

test('revision modes are explicit, exclusive and independently previewable', () => {
    for (const mode of ['--report', '--collect-view', '--collect-apply', '--keep-latest'])
        assert.equal(parse(['revisions', 'live', mode]).options[mode], true);
    assert.equal(parse(['revisions', 'live', '--keep-latest', '--dry-run']).options['--dry-run'], true);
    assert.equal(parse(['revisions', 'live', '--collect-apply', '--yes']).options['--yes'], true);
    for (const flags of [[], ['--report', '--collect-view'], ['--report', '--yes'], ['--collect-view', '--dry-run'],
        ['--keep-latest', '--yes', '--dry-run'], ['--keep-latest', '--folder', 'data/grib']])
        assert.throws(() => parse(['revisions', 'live', ...flags]));
});

test('revision command previews before confirmation and pins apply to that plan', async () => {
    for (const mode of ['--report', '--collect-view', '--collect-apply', '--keep-latest']) {
        const operator = new Operator(parse(['revisions', 'live', mode]));
        const report = fs.mkdtempSync(path.join(os.tmpdir(), 'hmc-revisions-'));
        operator.report = report;
        const calls = [];
        const plan = {fingerprint: 'frozen-plan', roots: [], selected: [], storage: {logical_bytes: 0}, reclaimable: {logical_bytes: 0}};
        operator.worker = async (_state, args) => {
            calls.push(args);
            fs.writeFileSync(path.join(report, args.includes('--apply') ? 'revisions-result.json' : 'revisions-plan.json'),
                JSON.stringify({...plan, removed: []}));
        };
        operator.confirm = async () => { calls.push('confirm'); return true; };
        const containers = ['db', 'geoserver', 'api', 'gateway'].map(service => ({Id: service, State: {Running: true},
            Config: {Labels: {'com.docker.compose.service': service}}}));
        try {
            await operator.revisions({state: {}, containers});
            assert.equal(calls[0][2], 'report');
            assert.equal(calls[0].includes('--keep-latest'), mode === '--keep-latest');
            if (['--collect-apply', '--keep-latest'].includes(mode)) {
                assert.equal(calls[1], 'confirm');
                assert.equal(calls[2][calls[2].indexOf('--expected') + 1], 'frozen-plan');
            } else assert.equal(calls.length, 1);
            calls.length = 0;
            operator.options = {'--keep-latest': true, '--dry-run': true};
            operator.confirm = Operator.prototype.confirm;
            assert.equal((await operator.revisions({state: {}, containers})).state, 'planned');
            assert.equal(calls.length, 1);
            calls.length = 0;
            operator.options = {'--keep-latest': true};
            operator.confirm = async () => false;
            assert.equal((await operator.revisions({state: {}, containers})).state, 'cancelled');
            assert.equal(calls.length, 1);
            await assert.rejects(operator.revisions({state: {}, containers: []}), /остановлена/);
        } finally {
            for (const name of fs.readdirSync(report)) fs.unlinkSync(path.join(report, name));
            fs.rmdirSync(report);
            process.removeListener('SIGINT', operator.signal); process.removeListener('SIGTERM', operator.signal);
        }
    }
});
test('TTY progress replaces a single line, including changing stages', () => {
    let text = '';
    const stream = {isTTY: true, write: value => {text += value;}};
    const progress = new Progress(stream);
    try {
        progress.update('Чтение'); progress.draw(); progress.update('Загрузка', 2, 4); progress.draw();
        assert.match(text, /2\/4/); assert.match(text, /\r\x1b\[2K/); assert.equal(text.includes('\n'), false);
    } finally { progress.stop(); }
});
test('redirected logs have stage messages without animation or per-file lines', () => {
    let text = '';
    const progress = new Progress({isTTY: false, write: value => {text += value;}});
    progress.update('Загрузка', 0, 100); progress.update('Загрузка', 1, 100); progress.update('Загрузка', 100, 100);
    progress.update('Очистка'); progress.stop();
    assert.equal(text, 'Загрузка\nОчистка\n'); assert.equal(text.includes('\r'), false);
});
test('project name alone cannot authorize removal of a foreign repository', () => {
    const own = {Config: {Labels: {'com.docker.compose.project': 'live', 'com.docker.compose.project.working_dir': root}}};
    assert.doesNotThrow(() => assertOwned([own], 'live'));
    assert.throws(() => assertOwned([own], 'other'));
    assert.throws(() => assertOwned([{Config: {Labels: {'com.docker.compose.project': 'live', 'com.docker.compose.project.working_dir': '/foreign'}}}], 'live'));
});
test('ambient Compose values cannot override project secrets, folder or ports', () => {
    const state = {files: [path.join(root, 'compose.publication.yaml')], env: {T4_PORT: '8162'}};
    const env = composeEnvironment(state, {WORKER_PASSWORD: 'poison', API_PASSWORD: 'poison',
        PUBLICATION_INPUT_DIR: '/foreign', T4_PORT: '1', PATH: 'preserve', COMPOSE_FILE: '/foreign'});
    assert.equal(env.WORKER_PASSWORD, undefined); assert.equal(env.API_PASSWORD, undefined);
    assert.equal(env.PUBLICATION_INPUT_DIR, undefined); assert.equal(env.T4_PORT, '8162');
    assert.equal(env.PATH, 'preserve'); assert.equal(env.COMPOSE_FILE, undefined);
});
test('a junction parent cannot redirect settings deletion outside data/live', () => {
    fs.mkdirSync(path.join(root, 'data/live'), {recursive: true});
    const inside = fs.mkdtempSync(path.join(root, 'data/live/hmc-security-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hmc-security-'));
    const marker = path.join(outside, 'keep.txt'), link = path.join(inside, 'link');
    fs.writeFileSync(marker, 'preserve');
    try {
        fs.symlinkSync(outside, link, 'junction');
        assert.throws(() => safeSettingsFile(path.join(link, 'keep.txt')));
        assert.equal(fs.readFileSync(marker, 'utf8'), 'preserve');
    } finally {
        if (fs.existsSync(link)) fs.unlinkSync(link);
        fs.unlinkSync(marker); fs.rmdirSync(outside); fs.rmdirSync(inside);
    }
});
test('inventory retries a disappearing --rm container without masking stable errors', async () => {
    const operator = new Operator({mode: 'status', project: 'live', options: {}});
    try {
        let lists = 0, inspections = 0;
        const own = {Config: {Labels: {'com.docker.compose.project': 'live', 'com.docker.compose.project.working_dir': root}}, State: {Status: 'running'}};
        operator.ids = async () => ++lists === 1 ? ['gone', 'api'] : ['api'];
        operator.json = async () => {if (++inspections === 1) throw Error('gone'); return [own];};
        assert.deepEqual(await operator.containers(), [own]); assert.equal(inspections, 2);
        operator.json = async () => {throw Error('stable failure');};
        await assert.rejects(operator.containers(), /stable failure/);
    } finally {
        process.removeListener('SIGINT', operator.signal); process.removeListener('SIGTERM', operator.signal);
    }
});
