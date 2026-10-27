// Actual lifecycle acceptance; deliberately allocates only a fresh disposable project.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {root} from '../hmc-app.mjs';

const [project, api = '8162', viewer = '8163', scope = 'full'] = process.argv.slice(2);
assert.ok(['full', 'clear-fixtures'].includes(scope));
assert.match(project || '', /^hmc-publication-cli60-[a-z0-9-]+$/);
const report = path.join(root, 'data/reports/hmc-cli-service', project);
assert.equal(fs.existsSync(report), false, 'Use fresh report/project');
const sample = path.join(root, 'data/grib/ICON_EU_T_G_2026101500.grib2');
assert.equal(createHash('sha256').update(fs.readFileSync(sample)).digest('hex'), 'dddfd6c63ba73e5e7337c21e105f16417003429f8179a44ca58bb110cb43736a');
fs.mkdirSync(report, {recursive: true});
const evidence = path.join(root, 'data/reports/cli60ops', project);
const env = {...process.env, HMC_EVIDENCE_ROOT: evidence};
let step = 0;
function command(program, args, expected = 0, extraEnv = env) {
    const result = spawnSync(program, args, {cwd: root, env: extraEnv, encoding: 'utf8', timeout: 1800000, maxBuffer: 8*1024**2, windowsHide: true});
    fs.writeFileSync(path.join(report, String(++step).padStart(3, '0') + '.log'), (result.stdout || '') + (result.stderr || ''));
    assert.equal(result.error, undefined);
    assert.equal(result.status, expected, args[0] + ': ' + (result.stderr || '').slice(-1600));
    return result.stdout.trim();
}
const cli = (mode, args = [], expected = 0) => command(process.execPath, ['hmc-app.mjs', mode, project, ...args], expected);
const docker = args => command('docker', args);
const stateFile = path.join(root, 'data/live/hmc-app/projects', project, 'project.json');
function records() {
    return fs.readdirSync(path.join(evidence, 'hmc-app', project)).sort().map(name =>
        JSON.parse(fs.readFileSync(path.join(evidence, 'hmc-app', project, name, 'operation.json'), 'utf8')));
}
function latest() { return records().at(-1); }
function latestDirectory() {
    const base = path.join(evidence, 'hmc-app', project);
    return path.join(base, fs.readdirSync(base).sort().at(-1));
}
async function cleanupComplete() {
    const file = path.join(latestDirectory(), 'cleanup.json');
    const deadline = Date.now()+120000;
    while (!fs.existsSync(file)) {
        if (Date.now() > deadline) throw Error('Deferred cleanup did not complete');
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const result = JSON.parse(fs.readFileSync(file));
    assert.equal(result.apply, true);
    assert.ok(result.removed.length > 0);
}
function probe(program) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return command('docker', ['compose', '--project-directory', root, '--project-name', project, '--env-file', state.envFile,
        ...state.files.flatMap(file => ['--file', file]), 'run', '--rm', '--no-deps', '--entrypoint', 'python', 'worker', '-c', program], 0, {...env, ...state.env});
}
function seedFixture(fixture, hours, legacy = false) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const compose = ['compose', '--project-directory', root, '--project-name', project, '--env-file', state.envFile,
        ...state.files.flatMap(file => ['--file', file]), 'run', '--rm', '--no-deps', 'worker'];
    command('docker', [...compose, 'submit', '--clock', '2026-10-19T05:00:00Z', '--hours', hours,
        '--fixture', fixture, ...(legacy ? ['--legacy-one-time'] : [])], 0, {...env, ...state.env});
    command('docker', [...compose, 'once'], 0, {...env, ...state.env});
}
async function catalogue() {
    const response = await fetch(`http://127.0.0.1:${api}/api/v1/catalogue`, {signal: AbortSignal.timeout(90000)});
    assert.equal(response.status, 200); return (await response.json()).selections;
}
async function assertActiveWriterBlocksClear() {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const marker = path.join(state.env.PUBLICATION_EVIDENCE_DIR, 'guard-held');
    const name = project + '-guard';
    const compose = ['compose', '--project-directory', root, '--project-name', project, '--env-file', state.envFile,
        ...state.files.flatMap(file => ['--file', file])];
    command('docker', [...compose, 'run', '--rm', '--detach', '--no-deps', '--name', name, '--entrypoint', 'python', 'worker', '-c',
        "import time\nfrom pathlib import Path\nfrom publication.domain import database\nwith database() as c:\n c.execute('SELECT pg_advisory_lock(16001)')\n Path('/evidence/guard-held').write_text('held')\n time.sleep(60)"], 0, {...env, ...state.env});
    try {
        const deadline = Date.now()+30000;
        while (!fs.existsSync(marker)) {
            if (Date.now()>deadline) throw Error('External writer guard did not become ready');
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        cli('refresh-grib', ['--remove-all', '--yes'], 1);
        assert.equal((await catalogue()).length > 0, true);
    } finally { docker(['rm', '--force', name]); }
}
function assertStopIncludesOneOff() {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const name = project+'-waiting-cleanup';
    command('docker', ['compose', '--project-directory', root, '--project-name', project, '--env-file', state.envFile,
        ...state.files.flatMap(file => ['--file', file]), 'run', '--rm', '--detach', '--no-deps', '--name', name,
        '--label', 'hmc.app.kind=cleanup', '--entrypoint', 'python', 'worker', '-c', 'import time; time.sleep(120)'], 0, {...env, ...state.env});
    cli('stop');
    assert.equal(docker(['ps', '--quiet', '--filter', 'label=com.docker.compose.project='+project]), '');
    cli('start');
}
async function assertLinuxCancellationAndRetry(input) {
    // Native POSIX signals are exercised here; Windows unit/progress gates run
    // the same operator, while Windows console delivery is outside this runner.
    const original = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const override = path.join(report, 'pause.compose.json');
    fs.writeFileSync(override, JSON.stringify({services: {worker: {environment: {T6_PAUSE_STAGE: 'normalization'}}}}));
    fs.writeFileSync(stateFile, JSON.stringify({...original, files: [...original.files, override]}));
    const bytes = fs.readFileSync(sample);
    const source = path.join(input, 'interrupted.grib2');
    fs.writeFileSync(source, bytes.subarray(0, Number(bytes.readBigUInt64BE(8))));
    const log = fs.openSync(path.join(report, String(++step).padStart(3, '0')+'.log'), 'w');
    const child = spawn(process.execPath, ['hmc-app.mjs', 'refresh-grib', project, '--yes'], {cwd: root, env,
        stdio: ['ignore', log, log]});
    const exited = new Promise((resolve, reject) => {child.once('error', reject); child.once('exit', resolve);});
    try {
        const deadline = Date.now()+90000;
        while (!fs.readdirSync(latestDirectory()).some(name => name.startsWith('pause-'))) {
            if (child.exitCode !== null || Date.now()>deadline) throw Error('Worker did not reach interruption checkpoint');
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        child.kill('SIGINT');
        let timer;
        try { assert.equal(await Promise.race([exited, new Promise((_, reject) => {timer=setTimeout(() => reject(Error('SIGINT cleanup timed out')), 30000);})]), 1); }
        finally { clearTimeout(timer); }
        assert.equal(docker(['ps', '--all', '--quiet', '--filter', 'label=com.docker.compose.project='+project,
            '--filter', 'label=hmc.app.kind=operation']), '');
        assert.equal(latest().state, 'failed');
    } finally {
        if (child.exitCode === null) {child.kill('SIGKILL'); await exited;}
        fs.closeSync(log); fs.writeFileSync(stateFile, JSON.stringify(original)); fs.unlinkSync(override);
    }
    cli('refresh-grib', ['--yes']);
    assert.equal(new Set((await catalogue()).map(item => item.valid_time)).size, 1);
    cli('refresh-grib', ['--yes']); assert.equal(latest().state, 'unchanged');
    fs.unlinkSync(source); cli('refresh-grib', ['--yes']);
    assert.equal((await catalogue()).length, 0); await cleanupComplete();
}
const input = path.join(report, 'input with spaces');
const events = [];
let failed;
function archiveBeforeRemoval() {
    const archive = path.join(report, 'before-remove');
    fs.mkdirSync(archive);
    const index = [];
    function visit(directory, prefix) {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            if (entry.name === 'before-remove' || entry.isSymbolicLink()) continue;
            const file = path.join(directory, entry.name), relative = prefix + '/' + entry.name;
            if (entry.isDirectory()) visit(file, relative);
            else if (/\.(json|log)$/.test(entry.name)) {
                const bytes = fs.readFileSync(file), sha256 = createHash('sha256').update(bytes).digest('hex');
                const target = createHash('sha256').update(relative).digest('hex').slice(0, 24) + path.extname(file);
                fs.writeFileSync(path.join(archive, target), bytes);
                assert.equal(createHash('sha256').update(fs.readFileSync(path.join(archive, target))).digest('hex'), sha256);
                index.push({source: relative, archived: target, bytes: bytes.length, sha256});
            }
        }
    }
    visit(report, 'reports'); if (fs.existsSync(evidence)) visit(evidence, 'operations');
    fs.writeFileSync(path.join(archive, 'index.json'), JSON.stringify(index, null, 2)+'\n');
}
try {
    for (const kind of ['container', 'volume', 'network']) assert.equal(docker([kind, 'ls', ...(kind === 'container' ? ['--all'] : []), '--quiet', '--filter', 'label=com.docker.compose.project=' + project]), '');
    cli('deploy', ['--api-port', api, '--viewer-port', viewer]); events.push('deploy');
    if (scope === 'clear-fixtures') {
        seedFixture('actual', '1,2'); seedFixture('correction', '1'); seedFixture('overlap', '1');
        seedFixture('actual', '1', true);
        const before = await catalogue(); assert.ok(before.length > 0);
        assert.ok(before.some(item => item.run.startsWith('SYNTHETIC-')));
        assert.ok(before.some(item => !item.selection.includes('.')));
        probe("from publication import retention; p,_,_=retention.snapshot(); retention.configure({**p,'reader_grace_seconds':1})");
        cli('refresh-grib', ['--remove-all', '--dry-run']);
        assert.equal(JSON.parse(fs.readFileSync(path.join(latestDirectory(),'plan.json'))).withdrawal.unchecked.length, 0);
        cli('refresh-grib', ['--remove-all', '--yes']);
        assert.equal((await catalogue()).length, 0);
        for (const item of before) assert.equal((await fetch(`http://127.0.0.1:${api}`+item.native_display)).status, 410);
        await cleanupComplete();
        events.push('all GRIB actual/correction/overlap/mixed/legacy publications removed');
    } else {
    cli('deploy', [], 1); events.push('duplicate deploy refused');
    fs.renameSync(stateFile, stateFile + '.saved');
    try {
        command(process.execPath, ['hmc-app.mjs', 'start', project], 0, {...env, WORKER_PASSWORD: 'poison',
            API_PASSWORD: 'poison', PUBLICATION_INPUT_DIR: path.join(report, 'foreign'), T4_PORT: '1'});
        const adopted = JSON.parse(fs.readFileSync(stateFile));
        assert.equal(adopted.adopted, true);
        assert.equal(adopted.folder, fs.realpathSync.native(path.join(root, 'data/grib')));
        assert.equal(adopted.env.T4_PORT, api);
    } finally { fs.renameSync(stateFile + '.saved', stateFile); }
    events.push('adoption with poisoned environment');
    cli('status'); cli('stop'); cli('status'); cli('start'); events.push('stop/start');
    assertStopIncludesOneOff(); events.push('stop includes deferred one-off worker');
    fs.mkdirSync(input); fs.copyFileSync(sample, path.join(input, 'old-without-extension'));
    cli('refresh-grib', ['--folder', input, '--dry-run']);
    assert.equal(latest().state, 'planned'); assert.equal(JSON.parse(fs.readFileSync(stateFile)).folder, null);
    cli('refresh-grib', ['--folder', input, '--yes']); events.push('initial load');
    const before = await catalogue(); assert.equal(new Set(before.map(item => item.valid_time)).size, 24);
    const beforeIds = before.map(item => item.selection).sort();
    const oldUrl = before[0].native_display;
    probe(`from publication import revisions
from publication.domain import database
from publication.grib_sync import source_manifest
with database() as c:
 c.execute('SELECT manifest_path,manifest_sha256 FROM app.revisions ORDER BY published_at DESC LIMIT 1')
 r=c.fetchone()
m=revisions.load_revision(r['manifest_path'],r['manifest_sha256'])
assert all(source_manifest(e['manifest_path'],e['manifest_sha256'])['source']['directory']==${JSON.stringify(input.replaceAll('\\', '/'))} for e in m['batches'])`);
    cli('refresh-grib', ['--yes']); assert.equal(latest().state, 'unchanged');
    fs.appendFileSync(path.join(input, 'old-without-extension'), 'changed bytes ignored by name');
    cli('refresh-grib', ['--yes']); assert.equal(latest().state, 'unchanged');
    assert.deepEqual((await catalogue()).map(item => item.selection).sort(), beforeIds); events.push('unchanged and same-name bytes skipped');
    fs.writeFileSync(path.join(input, 'broken.grib2'), 'GRIBbroken');
    cli('refresh-grib', ['--yes'], 1);
    assert.deepEqual((await catalogue()).map(item => item.selection).sort(), beforeIds);
    fs.unlinkSync(path.join(input, 'broken.grib2'));
    cli('refresh-grib', ['--yes']); assert.equal(latest().state, 'unchanged'); events.push('failed file preserves completed deliveries');
    fs.unlinkSync(path.join(input, 'old-without-extension'));
    const sampleBytes = fs.readFileSync(sample);
    fs.writeFileSync(path.join(input, 'new.grib2'), sampleBytes.subarray(0, Number(sampleBytes.readBigUInt64BE(8))));
    // Shorten only this disposable project's grace; the wall clock stays pinned.
    probe("from publication import retention; p,_,_=retention.snapshot(); retention.configure({**p,'reader_grace_seconds':1})");
    cli('refresh-grib', ['--yes']); events.push('simultaneous removal/addition');
    assert.equal(new Set((await catalogue()).map(item => item.valid_time)).size, 1);
    assert.equal((await fetch(`http://127.0.0.1:${api}` + oldUrl)).status, 410);
    await cleanupComplete(); events.push('physical cleanup after grace');
    await assertActiveWriterBlocksClear(); events.push('active writer blocks clear');
    cli('refresh-grib', ['--folder', path.join(root, 'data/grib'), '--yes'], 1); events.push('different folder refused');
    cli('refresh-grib', ['--remove-all', '--dry-run']); assert.equal((await catalogue()).length > 0, true);
    fs.renameSync(input, input + '-hidden');
    cli('refresh-grib', ['--remove-all', '--yes']); assert.equal((await catalogue()).length, 0);
    await cleanupComplete();
    assert.equal(fs.existsSync(input), false); assert.equal(fs.existsSync(path.join(input + '-hidden', 'new.grib2')), true);
    events.push('remove-all without source directory');
    fs.renameSync(input + '-hidden', input);
    cli('refresh-grib', ['--yes']); assert.equal((await catalogue()).length > 0, true); events.push('reload after remove-all');
    fs.unlinkSync(path.join(input, 'new.grib2'));
    cli('refresh-grib', ['--yes']); assert.equal((await catalogue()).length, 0); events.push('empty folder');
    await cleanupComplete();
    if (process.platform === 'linux') {
        await assertLinuxCancellationAndRetry(input); events.push('SIGINT cleanup and interrupted delivery retry');
    }
    }
    cli('remove', ['--dry-run']); assert.equal(latest().state, 'planned');
} catch (error) { failed = error; }
finally {
    try {
        fs.writeFileSync(path.join(report, 'before-removal.json'), JSON.stringify({events, error: failed?.message,
            containers: docker(['ps', '--all', '--quiet', '--filter', 'label=com.docker.compose.project=' + project]),
            volumes: docker(['volume', 'ls', '--quiet', '--filter', 'label=com.docker.compose.project=' + project]),
            networks: docker(['network', 'ls', '--quiet', '--filter', 'label=com.docker.compose.project=' + project])}, null, 2)+'\n');
        archiveBeforeRemoval();
        if (fs.existsSync(stateFile)) cli('remove', ['--yes']);
        for (const kind of ['container', 'volume', 'network']) assert.equal(docker([kind, 'ls', ...(kind === 'container' ? ['--all'] : []), '--quiet', '--filter', 'label=com.docker.compose.project=' + project]), '');
        events.push('all project resources removed');
        assert.equal(fs.existsSync(stateFile), false);
        assert.equal(fs.existsSync(sample), true);
    } catch (cleanup) { failed = failed || cleanup; }
    fs.writeFileSync(path.join(report, 'acceptance.json'), JSON.stringify({state: failed ? 'failed' : 'passed', scope, platform: process.platform,
        node: process.version, project, events, cleanup: events.includes('all project resources removed'), error: failed?.message}, null, 2) + '\n');
}
if (failed) throw failed;
console.log(JSON.stringify({state: 'passed', project, platform: process.platform, events}));
