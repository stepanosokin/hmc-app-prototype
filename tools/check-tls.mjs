// T21: two public seams, operator CLI and trusted HTTPS through real services.
// Called by run-access.ps1 after its HTTP/T8 gate; that runner retires the project.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash, X509Certificate} from 'node:crypto';
import {root, composeEnvironment} from '../hmc-app.mjs';

const [project, envFile, httpPort, tlsPort = '8443'] = process.argv.slice(2);
assert.match(project || '', /^hmc-publication-t8-[a-z0-9-]+$/);
assert.match(tlsPort, /^\d+$/);
const report = path.join(root, 'data/reports/t8', project);
const privateDir = path.join(root, 'data/live', project + '-tls');
const settingsDir = path.join(root, 'data/live/hmc-app/projects', project);
const settings = path.join(settingsDir, 'project.json');
const origin = 'https://localhost:' + tlsPort;
const state = {version: 1, root, project, envFile, files: [path.join(root, 'compose.publication.yaml')],
    env: {T4_PORT: httpPort, T13_PORT: String(Number(tlsPort) + 1), PUBLICATION_IMAGE: 'hmc-publication:t8',
        PUBLICATION_EVIDENCE_DIR: report, T6_TEST_FAULTS: '1', PUBLICATION_CLOCK: '2026-10-19T05:00:00Z'}};
const env = {...process.env, HMC_EVIDENCE_ROOT: path.join(root, 'data/reports/t21/operations', project)};
const events = [];
const inputs = ['hmc-app.mjs', 'tools/check-tls.mjs', 'publication/tls/nginx.conf', 'compose.tls.yaml'];
const inputHashes = Object.fromEntries(inputs.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
for (const file of inputs) {
    const snapshot = path.join(report, 'tls-inputs', file);
    fs.mkdirSync(path.dirname(snapshot), {recursive: true});
    fs.copyFileSync(path.join(root, file), snapshot);
}
let step = 0;
function run(executable, args, expected = 0, environment = env, capture = true) {
    const result = spawnSync(executable, args, {cwd: root, env: environment, windowsHide: true, encoding: 'utf8', maxBuffer: 16*1024**2});
    if (capture) fs.writeFileSync(path.join(report, 'tls-' + String(++step).padStart(3, '0') + '.log'), (result.stdout || '') + (result.stderr || ''));
    assert.equal(result.status, expected, executable + ' failed; see TLS step ' + step);
    return (result.stdout || '').trim();
}
function compose(args, expected = 0, capture = true) {
    const current = JSON.parse(fs.readFileSync(settings, 'utf8'));
    return run('docker', ['compose', '--project-directory', root, '--project-name', project, '--env-file', envFile,
        ...current.files.flatMap(file => ['--file', file]), ...args], expected, composeEnvironment(current), capture);
}
function cli(mode, args = [], expected = 0) { return run(process.execPath, ['hmc-app.mjs', mode, project, ...args], expected); }
function openssl(args) {
    return run('docker', ['run', '--rm', '--network', 'none', '--user', process.platform === 'win32' ? '0:0' : process.getuid() + ':' + process.getgid(), '--volume', privateDir + ':/certs',
        '--workdir', '/certs', '--entrypoint', 'openssl', 'hmc-publication:t8', ...args]);
}
function request(url, {ca, headers = {}, expected = 200} = {}) {
    return new Promise((resolve, reject) => {
        const req = (url.startsWith('https:') ? https : http).get(url, {ca, headers, agent: false, timeout: 100000}, res => {
            const serial = res.socket?.getPeerCertificate?.().serialNumber;
            const chunks = [];
            res.on('data', part => chunks.push(part));
            res.on('end', () => {
                if (!(Array.isArray(expected) ? expected : [expected]).includes(res.statusCode)) {
                    reject(Error(`HTTP ${res.statusCode}, expected ${expected}: ${new URL(url).pathname}`)); return;
                }
                resolve({body: Buffer.concat(chunks), serial});
            });
        });
        req.on('timeout', () => req.destroy(Error('HTTPS timeout')));
        req.on('error', reject);
    });
}
async function waitReady(ca, serial) {
    const deadline = Date.now() + 45000;
    while (true) {
        try {
            const result = await request(origin + '/health', {ca});
            if (serial && result.serial !== serial) throw Error('Certificate reload not yet observed: expected ' + serial + ', observed ' + result.serial);
            return result;
        }
        catch (error) { if (Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 500)); }
    }
}
async function closedHTTP() {
    await assert.rejects(request('http://127.0.0.1:' + httpPort + '/org/api/v1/catalogue'));
    // Sending plain HTTP to the TLS port must not serve a protected resource.
    await request('http://localhost:' + tlsPort + '/org/api/v1/catalogue', {expected: 400});
}
assert.ok(!fs.existsSync(privateDir) && !fs.existsSync(settingsDir), 'Use a fresh TLS fixture');
fs.mkdirSync(privateDir, {recursive: true});
fs.mkdirSync(settingsDir, {recursive: true});
fs.writeFileSync(settings, JSON.stringify(state));
const secretKeyFile = path.join(report, 't21.key');
let failure;
try {
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=HMC test CA', '-keyout', 'ca.key', '-out', 'ca.pem']);
    fs.writeFileSync(path.join(privateDir, 'san.cnf'), 'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n');
    for (const name of ['first', 'second']) {
        openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', name + '.key', '-out', name + '.csr']);
        openssl(['x509', '-req', '-in', name + '.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '1',
            '-extfile', 'san.cnf', '-out', name + '.pem']);
    }
    const install = name => {
        fs.writeFileSync(path.join(privateDir, 'fullchain.pem'), fs.readFileSync(path.join(privateDir, name + '.pem')));
        fs.writeFileSync(path.join(privateDir, 'privkey.pem'), fs.readFileSync(path.join(privateDir, name + '.key')));
        fs.chmodSync(path.join(privateDir, 'privkey.pem'), 0o600);
        // Exercise rapid replacement/rollback even when filesystem timestamps coincide.
        const timestamp = new Date('2026-01-01T00:00:00Z');
        for (const file of ['fullchain.pem', 'privkey.pem']) fs.utimesSync(path.join(privateDir, file), timestamp, timestamp);
        if (process.platform !== 'win32') run('docker', ['run', '--rm', '--network', 'none', '--user', '0:0', '--volume', privateDir + ':/certs',
            '--entrypoint', 'python', 'hmc-publication:t8', '-c', "import os; os.chown('/certs/privkey.pem'," + process.getuid() + ",65532); os.chmod('/certs/privkey.pem',0o640)"]);
    };
    install('first');
    const ca = fs.readFileSync(path.join(privateDir, 'ca.pem'));
    await request('http://127.0.0.1:' + httpPort + '/health');
    // The CLI rejects a mismatched pair before replacing working HTTP listeners.
    fs.copyFileSync(path.join(privateDir, 'second.key'), path.join(privateDir, 'privkey.pem'));
    cli('tls-enable', ['--origin', origin, '--cert-dir', privateDir], 1);
    install('first');
    cli('tls-enable', ['--origin', origin, '--cert-dir', privateDir]);
    await waitReady(ca);
    await closedHTTP();
    await assert.rejects(request(origin + '/health'), /certificate|issuer|self.signed/i);
    await assert.rejects(request('https://127.0.0.1:' + tlsPort + '/health', {ca}), /IP|altname|certificate/i);
    events.push('HTTP before activation; trusted CA and SAN; wrong name and untrusted CA rejected; HTTP closed');
    await request(origin + '/', {ca});
    const created = JSON.parse(compose(['run', '--rm', '--no-deps', '--entrypoint', 'python', 'worker', '-m', 'publication.access',
        'create', '--organization', 'tls-test', '--profile', 'all', '--out', '/evidence/t21.key']));
    const token = run('docker', ['run', '--rm', '--log-driver', 'none', '--network', 'none', '--user', '65532:65532',
        '--label', 'com.docker.compose.project=' + project, '--label', 'com.docker.compose.project.working_dir=' + root,
        '--label', 'com.docker.compose.project.environment_file=' + envFile, '--volume', report + ':/evidence:ro',
        '--entrypoint', 'python', 'hmc-publication:t8', '-c',
        "from pathlib import Path; print(Path('/evidence/t21.key').read_text().strip())"], 0, env, false);
    fs.unlinkSync(secretKeyFile);
    const headers = {Authorization: 'Bearer ' + token, Forwarded: 'host=evil.invalid;proto=http',
        'X-Forwarded-Host': 'evil.invalid', 'X-Forwarded-Proto': 'http', 'X-Publication-Prefix': 'http://evil.invalid'};
    const getJSON = async (url, protectedRoute = false) => JSON.parse((await request(url, {ca, headers: protectedRoute ? headers : {}})).body);
    const publicItems = await getJSON(origin + '/api/v1/catalogue');
    const selected = publicItems.selections.find(item => item.fixture === 'actual');
    const protectedItems = await getJSON(origin + '/org/api/v1/catalogue', true);
    const protectedItem = protectedItems.selections.find(item => item.selection === selected.selection);
    for (const item of [selected, protectedItem]) {
        const isOrg = item === protectedItem;
        const prefix = origin + (isOrg ? '/org' : '');
        for (const name of ['point', 'tiles', 'wms', 'collection', 'native_display']) assert.ok(item[name].startsWith(prefix + '/'), name);
        assert.ok(item.wms.includes('/revisions/' + item.revision + '/'));
        const metadata = await getJSON(item.tiles, isOrg);
        assert.ok(metadata.url.startsWith(prefix + '/api/'));
        const tile = metadata.url.replace('{z}', '3').replace('{x}', '4').replace('{y}', '2');
        await request(tile, {ca, headers: isOrg ? headers : {}});
        const native = await getJSON(item.native_display, isOrg);
        assert.ok(native.url_template.startsWith(prefix + '/api/'));
        const query = new URLSearchParams(Object.fromEntries(['selection', 'run', 'revision', 'valid_time'].map(key => [key, item[key]])));
        query.set('layer', item.field); query.set('lon', '-23.5'); query.set('lat', '29.5');
        assert.equal((await getJSON(item.point + '?' + query, isOrg)).value, 298.2274169921875);
        const wmsHeaders = isOrg ? headers : {};
        const capabilities = (await request(item.wms + '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities', {ca, headers: wmsHeaders})).body.toString();
        const hrefs = [...capabilities.matchAll(/xlink:href="([^"]+)"/g)].map(match => match[1]);
        assert.ok(hrefs.length && hrefs.every(href => href.startsWith(item.wms + '?')));
        const map = await request(item.wms + '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=temperature&STYLES=&TIME=' +
            encodeURIComponent(item.valid_time) + '&CRS=EPSG:3857&BBOX=-1000000,5000000,3000000,9000000&WIDTH=64&HEIGHT=64&FORMAT=image/png', {ca, headers: wmsHeaders});
        assert.equal(map.body.subarray(1, 4).toString(), 'PNG');
        if (isOrg) {
            // Prove a warm-cache response while cold generation fails.
            const warm = (await request(tile, {ca, headers})).body;
            compose(['run', '--rm', '--no-deps', '--entrypoint', 'python', 'worker', '-c', "from pathlib import Path; Path('/assets/.t6-generation').touch()"]);
            try {
                await request(tile.replace('/3/4/2.f32', '/6/32/20.f32'), {ca, headers, expected: 503});
                assert.deepEqual((await request(tile, {ca, headers})).body, warm);
                await request(tile, {ca, expected: 401});
                await request(tile, {ca, headers: {...headers, Authorization: 'Bearer invalid'}, expected: 401});
                compose(['run', '--rm', '--no-deps', '--entrypoint', 'python', 'worker', '-m', 'publication.access', 'revoke', '--id', created.id]);
                await request(tile, {ca, headers, expected: 401});
            } finally {
                compose(['run', '--rm', '--no-deps', '--entrypoint', 'python', 'worker', '-c', "from pathlib import Path; Path('/assets/.t6-generation').unlink(missing_ok=True)"]);
            }
        }
    }
    events.push('HTTPS website, public/org catalogue, point, numeric/native metadata and tiles, WMS capabilities/map; origin/run/revision preserved; spoofed headers ignored; warm-cache key rejection');
    const inventory = JSON.parse(run('docker', ['inspect', ...run('docker', ['ps', '--all', '--quiet', '--filter', 'label=com.docker.compose.project=' + project]).split(/\s+/)], 0, env, false));
    for (const item of inventory) {
        const service = item.Config.Labels['com.docker.compose.service'];
        if (service !== 'tls-proxy') {
            assert.equal(Object.keys(item.HostConfig.PortBindings || {}).length, 0, 'backend port: ' + service);
            assert.ok(!item.Mounts.some(mount => mount.Source === privateDir));
        } else {
            assert.equal(item.Config.User, '65532:65532');
            assert.equal(item.Mounts.find(mount => mount.Destination === '/certs').RW, false);
        }
    }
    // Do not archive full inspect (contains environment secrets).
    fs.writeFileSync(path.join(report, 'tls-isolation.json'), JSON.stringify(inventory.map(item => ({
        service: item.Config.Labels['com.docker.compose.service'], image: item.Image, ports: item.HostConfig.PortBindings,
        networks: Object.keys(item.NetworkSettings.Networks), certificate_mount: item.Mounts.some(mount => mount.Destination === '/certs')})), null, 2));
    run('docker', ['run', '--rm', '--network', project + '_edge', '--entrypoint', 'python', 'hmc-publication:t8', '-c',
        "import socket\nfor name,port in [('gateway',8000),('viewer',8000),('api',8000),('db',5432),('geoserver',8080)]:\n try: socket.create_connection((name,port),2)\n except OSError: continue\n raise RuntimeError('backend reachable: '+name)"]);
    events.push('only TLS proxy publishes a host port; edge cannot reach gateway/viewer/backends; certificate mount read-only and proxy-only');
    cli('tls-check');
    install('second'); cli('tls-reload');
    await waitReady(ca, new X509Certificate(fs.readFileSync(path.join(privateDir, 'second.pem'))).serialNumber);
    // A failed reload keeps the previous valid TLS context; no HTTP fallback.
    for (const bad of ['missing', 'unreadable', 'mismatched']) {
        install('second');
        if (bad === 'missing') fs.unlinkSync(path.join(privateDir, 'privkey.pem'));
        if (bad === 'unreadable') { fs.unlinkSync(path.join(privateDir, 'privkey.pem')); fs.mkdirSync(path.join(privateDir, 'privkey.pem')); }
        if (bad === 'mismatched') fs.copyFileSync(path.join(privateDir, 'first.key'), path.join(privateDir, 'privkey.pem'));
        cli('tls-reload', [], 1);
        await waitReady(ca); await closedHTTP();
        compose(['stop', 'tls-proxy']);
        compose(['run', '--rm', '--no-deps', 'tls-proxy', '-t'], 1);
        await closedHTTP().catch(error => {
            // With proxy stopped both HTTPS port and old HTTP port are closed.
            if (error.code !== 'ECONNREFUSED') throw error;
        });
        if (bad === 'unreadable') fs.rmdirSync(path.join(privateDir, 'privkey.pem'));
        install('second'); compose(['start', 'tls-proxy']); await waitReady(ca);
    }
    install('first'); cli('tls-reload');
    await waitReady(ca, new X509Certificate(fs.readFileSync(path.join(privateDir, 'first.pem'))).serialNumber);
    cli('stop'); cli('start'); await waitReady(ca); await closedHTTP(); cli('status');
    events.push('certificate replacement/reload and rollback; missing/unreadable/mismatched files fail closed; CLI stop/start keeps TLS');
    compose(['stop', 'gateway']);
    try { await request(origin + '/api/v1/catalogue?api_key=' + encodeURIComponent(token), {ca, expected: [502, 504]}); }
    finally { compose(['start', 'gateway']); await waitReady(ca); }
    // Audit log bytes and the proxy image layers for the exact fixture secrets.
    const secrets = [token, ...['ca.key', 'first.key', 'second.key'].flatMap(name => {
        const key = fs.readFileSync(path.join(privateDir, name), 'utf8');
        return [key, key.trim().split(/\r?\n/).at(-3)];
    })];
    const audit = directory => {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) audit(file);
            else if (!file.endsWith('.key') && !file.endsWith('.env')) {
                const bytes = fs.readFileSync(file);
                assert.ok(secrets.every(secret => !bytes.includes(Buffer.from(secret))), 'secret in report: ' + entry.name);
            }
        }
    };
    compose(['logs', '--no-color', 'tls-proxy', 'gateway', 'api', 'viewer']);
    audit(report);
    const proxyImage = inventory.find(item => item.Config.Labels['com.docker.compose.service'] === 'tls-proxy').Image;
    const imageTar = path.join(privateDir, 'proxy-image.tar');
    run('docker', ['image', 'save', '--output', imageTar, proxyImage]);
    const imageBytes = fs.readFileSync(imageTar);
    assert.ok(secrets.every(secret => !imageBytes.includes(Buffer.from(secret))), 'secret in image');
    events.push('exact test private keys/API token absent from captured logs and TLS image; private files outside archive');
    for (const file of inputs) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), inputHashes[file], 'TLS input changed: ' + file);
} catch (error) {
    failure = error;
    try {
        const proxy = run('docker', ['ps', '--all', '--quiet', '--filter', 'label=com.docker.compose.project=' + project,
            '--filter', 'label=com.docker.compose.service=tls-proxy']);
        if (proxy) run('docker', ['logs', proxy]);
    } catch { /* Preserve the original failure; parent captures remaining service logs. */ }
}
finally {
    if (fs.existsSync(secretKeyFile)) fs.unlinkSync(secretKeyFile);
    // Delete only these explicitly created private fixture files (never user certificates).
    for (const entry of fs.readdirSync(privateDir)) {
        const file = path.join(privateDir, entry);
        if (fs.statSync(file).isDirectory()) fs.rmdirSync(file); else fs.unlinkSync(file);
    }
    fs.rmdirSync(privateDir); fs.unlinkSync(settings); fs.rmdirSync(settingsDir);
    fs.writeFileSync(path.join(report, 'tls-gate.json'), JSON.stringify({status: failure ? 'failed' : 'passed',
        error: failure?.message, origin, checks: events, inputs: inputHashes, private_fixtures_removed: !fs.existsSync(privateDir)}, null, 2) + '\n');
}
if (failure) throw failure;
console.log('T21 TLS gate passed. Parent T8 runner must retire all service resources.');
