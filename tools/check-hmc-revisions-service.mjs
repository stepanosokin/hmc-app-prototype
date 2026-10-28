// Runs only against an explicitly isolated T7 project, never the live stand.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {root} from '../hmc-app.mjs';

const [project, envFile, directory, port] = process.argv.slice(2);
assert.match(project || '', /^hmc-publication-t7-revisions-[a-z0-9-]+$/);
const report = path.resolve(directory, 'operator');
fs.mkdirSync(report, {recursive: true});
// Keep operation archives outside the T7 report tree: nesting two project
// names and operation UUIDs exceeds Windows PowerShell's copy-path limit.
const operations = path.join(root, 'data/reports/revisions70-operations', project);
const environment = {...process.env, HMC_EVIDENCE_ROOT: operations};
let step = 0;
function run(program, args, expected = 0) {
    const result = spawnSync(program, args, {cwd: root, env: environment, encoding: 'utf8', windowsHide: true,
        timeout: 600000, maxBuffer: 16 * 1024**2});
    fs.writeFileSync(path.join(report, `${++step}.log`), (result.stdout || '') + (result.stderr || ''));
    assert.equal(result.error, undefined);
    assert.equal(result.status, expected, (result.stderr || '').slice(-2000));
    return result.stdout.trim();
}
function worker(args) {
    return run('docker', ['compose', '--project-name', project, '--env-file', envFile, '--file', 'compose.publication.yaml',
        'run', '--rm', '--no-deps', '--entrypoint', 'python', 'worker', ...args]);
}
const cli = args => run(process.execPath, ['hmc-app.mjs', 'revisions', project, ...args]);
function latestPlan() {
    const base = path.join(operations, 'hmc-app', project);
    const latest = fs.readdirSync(base).sort().at(-1);
    return JSON.parse(fs.readFileSync(path.join(base, latest, 'revisions-plan.json')));
}
async function catalogue() {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/catalogue`, {signal: AbortSignal.timeout(90000)});
    assert.equal(response.status, 200);
    return (await response.json()).selections;
}
// The test policy is explicitly isolated. The CLI itself must never replace it.
worker(['-m', 'publication.retention', 'configure', '--clock', '2026-10-19T05:00:00Z',
    '--superseded-grace-seconds', '2592000', '--reader-grace-seconds', '0']);
for (const [hours, fixture] of [['1', 'actual'], ['24', 'actual'], ['1', 'correction']]) {
    worker(['-m', 'publication.worker', 'submit', '--clock', '2026-10-19T05:00:00Z', '--hours', hours, '--fixture', fixture]);
    worker(['-m', 'publication.worker', 'once']);
}
const before = await catalogue();
cli(['--report']);
const policy = latestPlan().policy;
cli(['--collect-view']);
assert.deepEqual(await catalogue(), before);
cli(['--collect-apply', '--dry-run']);
assert.deepEqual(await catalogue(), before);
cli(['--keep-latest', '--dry-run']);
const planned = latestPlan();
assert.ok(planned.selected.length >= 2);
assert.deepEqual(await catalogue(), before);
cli(['--keep-latest', '--yes']);
const after = await catalogue();
assert.equal(new Set(after.map(item => item.revision)).size, 1);
assert.deepEqual(new Set(after.map(item => item.valid_time)), new Set(before.map(item => item.valid_time)));
cli(['--keep-latest', '--yes']); // A repeated apply is harmless.
cli(['--collect-apply', '--yes']);
cli(['--report']);
assert.deepEqual(latestPlan().policy, policy);
assert.deepEqual(await catalogue(), after);
assert.equal(run('docker', ['ps', '--all', '--quiet', '--filter', 'label=com.docker.compose.project=' + project,
    '--filter', 'label=hmc.app.kind=operation']), '');
fs.writeFileSync(path.join(report, 'result.json'), JSON.stringify({status: 'passed', project,
    before_selections: before.length, after_selections: after.length, policy_unchanged: true, operation_containers: 0, operations}, null, 2));
console.log('Команды revisions: отчёт, просмотры, применение и повторная очистка прошли.');
