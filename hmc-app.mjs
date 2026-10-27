#!/usr/bin/env node
// One operator entry point. No shell command strings or host Python/PowerShell.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';

export const root = path.dirname(fileURLToPath(import.meta.url));
const stateRoot = path.join(root, 'data/live/hmc-app/projects');
const modes = ['deploy', 'remove', 'stop', 'start', 'status', 'refresh-grib'];
const bools = ['--dry-run', '--yes', '--remove-all', '--include-unlocated'];
const values = ['--folder', '--viewer-port', '--api-port', '--storage-budget-bytes'];
const services = ['db', 'geoserver', 'api', 'gateway', 'viewer'];
const budgetDefault = 64 * 1024 ** 3;
const fail = message => { throw Error(message); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function save(file, value) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temp = file + '.' + randomUUID();
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
    fs.renameSync(temp, file);
}
export function parse(args) {
    if (args.length === 0 || args.includes('--help')) return {help: true};
    const [mode, project, ...rest] = args;
    if (!modes.includes(mode)) fail('Неизвестный режим. Используйте --help.');
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(project ?? '')) fail('Укажите имя проекта: 2–63 строчных латинских символа, цифры и дефисы.');
    const options = {};
    for (let i = 0; i < rest.length; i++) {
        const flag = rest[i];
        if (Object.hasOwn(options, flag)) fail('Повторный параметр: ' + flag);
        if (bools.includes(flag)) options[flag] = true;
        else if (values.includes(flag) && rest[i+1] && !rest[i+1].startsWith('--')) options[flag] = rest[++i];
        else fail('Неизвестный параметр или отсутствует значение: ' + flag);
    }
    const allowed = mode === 'deploy' ? ['--viewer-port', '--api-port'] :
        mode === 'remove' ? ['--dry-run', '--yes'] : mode === 'refresh-grib' ?
        ['--folder', '--dry-run', '--yes', '--remove-all', '--include-unlocated', '--storage-budget-bytes'] : [];
    for (const flag of Object.keys(options)) if (!allowed.includes(flag)) fail('Параметр недоступен для этого режима: ' + flag);
    if (options['--remove-all'] && (options['--folder'] || options['--include-unlocated']))
        fail('--remove-all не использует --folder и --include-unlocated.');
    for (const flag of ['--viewer-port', '--api-port', '--storage-budget-bytes']) {
        if (options[flag] !== undefined && (!/^[1-9]\d*$/.test(options[flag]) || !Number.isSafeInteger(Number(options[flag])) ||
            (flag !== '--storage-budget-bytes' && Number(options[flag]) > 65535))) fail('Некорректное число: ' + flag);
    }
    return {mode, project, options};
}

export class Progress {
    constructor(stream = process.stderr) { this.stream = stream; this.tick = 0; this.timer = null; }
    update(stage, done, total) {
        this.stage = stage; this.done = done; this.total = total;
        if (!this.stream.isTTY) {
            if (stage !== this.previous) this.stream.write(stage + '\n');
            this.previous = stage;
            return;
        }
        if (!this.timer) this.timer = setInterval(() => this.draw(), 100);
        this.draw();
    }
    draw() {
        const width = 20, known = Number.isInteger(this.total) && this.total > 0;
        const count = known ? Math.min(width, Math.floor(width*this.done/this.total)) : this.tick++ % width;
        const bar = known ? '='.repeat(count) + ' '.repeat(width-count) : ' '.repeat(count) + '>' + ' '.repeat(width-count-1);
        this.stream.write('\r\x1b[2K' + this.stage + ' [' + bar + ']' + (known ? ` ${this.done}/${this.total} ${'|/-\\'[this.tick++ % 4]}` : ''));
    }
    stop() {
        clearInterval(this.timer); this.timer = null;
        if (this.stream.isTTY) this.stream.write('\r\x1b[2K');
    }
}

export function normalized(value) {
    let resolved = value.replace(/^\/run\/desktop\/mnt\/host\/([a-z])\//i, '$1:/');
    resolved = path.resolve(resolved);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
function contained(file, directory) {
    const relative = path.relative(normalized(directory), normalized(file));
    return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}
export function assertOwned(containers, project) {
    for (const item of containers) {
        const labels = item.Config?.Labels ?? {};
        if (labels['com.docker.compose.project'] !== project ||
            normalized(labels['com.docker.compose.project.working_dir'] ?? '') !== normalized(root))
            fail('Не подтверждено владение ресурсами проекта из этого репозитория.');
    }
}
export function composeEnvironment(state, inherited = process.env) {
    const env = {...inherited};
    for (const file of state.files) {
        for (const match of fs.readFileSync(file, 'utf8').matchAll(/\$\{([A-Za-z_][A-Za-z_0-9]*)/g)) delete env[match[1]];
    }
    for (const name of ['COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'COMPOSE_ENV_FILES', 'COMPOSE_PROFILES']) delete env[name];
    return {...env, ...state.env};
}
export function safeSettingsFile(file) {
    const base = path.join(root, 'data/live');
    if (!contained(file, base)) return false;
    if (!contained(fs.realpathSync.native(base), fs.realpathSync.native(root))) fail('Каталог настроек находится вне репозитория.');
    if (!contained(fs.realpathSync.native(file), fs.realpathSync.native(base))) fail('Настройка находится вне каталога проекта: ' + file);
    let current = file;
    while (normalized(current) !== normalized(root)) {
        if (fs.lstatSync(current).isSymbolicLink()) fail('Ссылка в пути настройки: ' + file);
        current = path.dirname(current);
    }
    return true;
}
function sourceFolder(value) {
    const folder = path.resolve(root, value);
    const stat = fs.lstatSync(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Нужна существующая обычная папка GRIB.');
    return fs.realpathSync.native(folder);
}
function evidenceDirectory(project) {
    const base = path.resolve(root, process.env.HMC_EVIDENCE_ROOT || '../hmc-app-evidence');
    const directory = path.join(base, 'hmc-app', project, new Date().toISOString().replaceAll(/[:.]/g, '-') + '-' + randomUUID());
    fs.mkdirSync(directory, {recursive: true, mode: 0o777});
    if (process.platform !== 'win32') fs.chmodSync(directory, 0o777);
    for (const name of ['selection.json', 'browser.json', 'comparison.json', 'geoserver-numeric.json'])
        fs.copyFileSync(path.join(root, 'tests/fixtures/publication/tile-engine', name), path.join(directory, name));
    return directory;
}

export class Operator {
    constructor(command) {
        Object.assign(this, command); this.progress = new Progress(); this.cancelled = false;
        this.owned = new Map(); this.stage = 0;
        this.signal = () => { this.cancelled = true; this.child?.kill(); };
        process.on('SIGINT', this.signal); process.on('SIGTERM', this.signal);
    }
    async run(executable, args, {privateOutput = false, env = process.env, stage = executable} = {}) {
        if (this.cancelled) fail('Операция остановлена. Повторный запуск построит новый план.');
        if (!privateOutput) this.progress.update(stage);
        const log = !privateOutput && this.report ? fs.openSync(path.join(this.report, String(++this.stage).padStart(3, '0') + '.log'), 'w') : null;
        try {
            return await new Promise((resolve, reject) => {
                const child = spawn(executable, args, {cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
                this.child = child; let output = '', tail = '', line = '';
                child.stdout.on('data', chunk => {
                    if (log !== null) fs.writeSync(log, chunk);
                    output = (output + chunk.toString()).slice(-32 * 1024 ** 2);
                    line += chunk.toString();
                    const lines = line.split('\n'); line = lines.pop().slice(-65536);
                    for (const text of lines) {
                        try { const item = JSON.parse(text); if (item.hmc_progress) this.progress.update(item.hmc_progress, item.done, item.total); } catch { /* ordinary worker log */ }
                    }
                });
                child.stderr.on('data', chunk => { if (log !== null) fs.writeSync(log, chunk); tail = (tail + chunk).slice(-1200); });
                child.once('error', reject);
                child.once('close', code => {
                    this.child = null;
                    if (this.cancelled) reject(Error('Операция остановлена. Успешно выполненные изменения сохранены.'));
                    else if (code !== 0) reject(Error(`${stage}: ошибка (код ${code}). ${privateOutput ? 'Проверьте Docker и конфигурацию проекта.' : tail}`));
                    else resolve(output.trim());
                });
            });
        } finally { if (log !== null) fs.closeSync(log); }
    }
    docker(args, options) { return this.run('docker', args, options); }
    async json(args) { return JSON.parse(await this.docker(args, {privateOutput: true})); }
    async ids(kind, project = this.project) {
        return (await this.docker([kind, 'ls', ...(kind === 'container' ? ['--all'] : []), '--quiet', '--filter', 'label=com.docker.compose.project=' + project], {privateOutput: true})).split(/\r?\n/).filter(Boolean);
    }
    async containers() {
        const deadline = Date.now()+20000;
        while (Date.now() < deadline) {
            const ids = await this.ids('container');
            try {
                const result = ids.length ? await this.json(['inspect', ...ids]) : [];
                if (!result.some(item => item.State.Status === 'removing')) {
                    assertOwned(result, this.project);
                    return result;
                }
            } catch (error) {
                const current = await this.ids('container');
                if (current.slice().sort().join() === ids.slice().sort().join()) throw error;
                // --rm collectors can disappear between list and inspect.
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        fail('Docker ещё удаляет контейнер операции. Повторите команду после завершения.');
    }
    async configuration() {
        const file = path.join(stateRoot, this.project, 'project.json');
        const containers = await this.containers();
        if (fs.existsSync(file)) {
            const state = read(file);
            if (state.project !== this.project || normalized(state.root) !== normalized(root)) fail('Конфигурация принадлежит другому проекту или каталогу.');
            for (const name of [state.envFile, ...state.files]) if (!fs.statSync(name).isFile()) fail('Файл конфигурации отсутствует: ' + name);
            return {state, containers, file};
        }
        const api = containers.filter(item => item.Config.Labels['com.docker.compose.service'] === 'api');
        if (api.length !== 1) fail('Проект не найден. Сначала выполните deploy.');
        const labels = api[0].Config.Labels;
        const files = labels['com.docker.compose.project.config_files']?.split(',');
        const envFile = labels['com.docker.compose.project.environment_file'];
        if (!files?.length || !envFile || !fs.existsSync(envFile) || files.some(name => !fs.existsSync(name))) fail('Не удалось определить прежние Compose-файлы и файл настроек проекта.');
        const hostPort = service => {
            const item = containers.find(value => value.Config.Labels['com.docker.compose.service'] === service);
            return item ? Object.values(item.HostConfig.PortBindings ?? {}).flat().find(binding => binding?.HostPort)?.HostPort : null;
        };
        const state = {version: 1, project: this.project, root, files, envFile, adopted: true,
            env: {PUBLICATION_IMAGE: api[0].Image, T4_PORT: hostPort('gateway') || '8141', T13_PORT: hostPort('viewer') || '8140'}};
        const rendered = await this.jsonCompose(state);
        const input = rendered.services.worker.volumes.find(item => item.target === '/input');
        if (!input || input.type !== 'bind') fail('Не удалось определить каталог GRIB существующего проекта.');
        state.folder = fs.existsSync(input.source) ? sourceFolder(input.source) : path.resolve(input.source);
        state.env.PUBLICATION_INPUT_DIR = state.folder;
        return {state, containers, file};
    }
    compose(state, args, extraFiles = []) {
        return ['compose', '--project-directory', root, '--project-name', this.project, '--env-file', state.envFile,
            ...[...state.files, ...extraFiles].flatMap(file => ['--file', file]), ...args];
    }
    composeEnv(state) { return composeEnvironment(state); }
    async jsonCompose(state) {
        return JSON.parse(await this.docker(this.compose(state, ['config', '--format', 'json']), {privateOutput: true, env: this.composeEnv(state)}));
    }
    async composeRun(state, args, stage) {
        return this.docker(this.compose(state, args), {env: this.composeEnv(state), stage});
    }
    async confirm(nameRequired = false) {
        this.progress.stop();
        if (this.options['--dry-run']) return false;
        if (this.options['--yes']) return true;
        if (!process.stdin.isTTY) fail('Для запуска без терминала укажите --yes или --dry-run.');
        const terminal = createInterface({input: process.stdin, output: process.stdout});
        try {
            const answer = await terminal.question(nameRequired ? `Для удаления введите имя проекта ${this.project}: ` : 'Для применения введите ДА: ');
            return answer === (nameRequired ? this.project : 'ДА');
        } finally { terminal.close(); }
    }
    async worker(state, operation, extra = [], detached = false) {
        if (detached && await this.docker(['ps', '--quiet', '--filter', 'label=com.docker.compose.project=' + this.project,
            '--filter', 'label=hmc.app.kind=cleanup'], {privateOutput: true})) return;
        const owner = randomUUID(), name = 'hmc-' + (detached ? 'cleanup-' : 'operation-') + owner;
        const override = path.join(this.report, 'operation.compose.json');
        const volumes = [{type: 'bind', source: this.report, target: '/evidence'}];
        volumes.push({type: 'bind', source: state.folder && this.mode === 'refresh-grib' && !this.options['--remove-all'] ? state.folder : this.report,
            target: '/input', read_only: true});
        save(override, {services: {worker: {volumes}}});
        const args = this.compose(state, ['run', '--rm', '--no-deps', ...(detached ? ['--detach'] : []), '--name', name,
            '--label', 'hmc.app.owner=' + owner, '--label', 'hmc.app.kind=' + (detached ? 'cleanup' : 'operation'),
            '--env', 'PUBLICATION_STORAGE_BYTES=' + (this.options['--storage-budget-bytes'] || budgetDefault),
            ...(operation[0] === '-c' && operation[1].startsWith('import os; os.chown') ? ['--user', '0:0'] : []),
            ...(state.folder ? ['--env', 'GRIB_SOURCE_DIRECTORY=' + state.folder.replaceAll('\\', '/')] : []),
            '--entrypoint', 'python', 'worker', ...operation, ...extra], [override]);
        this.owned.set(name, owner);
        try {
            await this.docker(args, {env: {...this.composeEnv(state), PUBLICATION_EVIDENCE_DIR: this.report}, stage: 'Обработка данных'});
            if (detached) {
                this.owned.delete(name); // durable collector belongs to the project
                this.progress.stop(); console.log('Отложенная очистка запущена; используемые данные и защитный интервал сохраняются.');
            }
        } finally { if (!detached) await this.removeOwned(name); }
    }
    async removeOwned(name) {
        const owner = this.owned.get(name);
        if (!owner) return;
        // Cleanup must still run after Ctrl+C.
        const cancelled = this.cancelled; this.cancelled = false;
        try {
            const ids = (await this.docker(['ps', '--all', '--quiet', '--filter', 'name=^/' + name + '$'], {privateOutput: true})).split(/\r?\n/).filter(Boolean);
            if (ids.length) {
                const items = await this.json(['inspect', ...ids]);
                if (items.some(item => item.Config.Labels['hmc.app.owner'] !== owner)) fail('Владелец контейнера операции не подтверждён.');
                await this.removeContainers(ids);
            }
            if (await this.docker(['ps', '--all', '--quiet', '--filter', 'name=^/' + name + '$'], {privateOutput: true})) fail('Контейнер операции не удалён.');
            this.owned.delete(name);
        } finally { this.cancelled = cancelled; }
    }
    async removeContainers(ids) {
        for (const id of ids) {
            const deadline = Date.now()+20000;
            while (true) {
                const present = await this.docker(['ps', '--all', '--quiet', '--no-trunc', '--filter', 'id=' + id], {privateOutput: true});
                if (!present) break;
                try { await this.docker(['rm', '--force', id], {stage: 'Удаление контейнера'}); }
                catch (error) {
                    const remaining = await this.docker(['ps', '--all', '--quiet', '--no-trunc', '--filter', 'id=' + id], {privateOutput: true});
                    if (!remaining) break;
                    if (Date.now() > deadline) throw error;
                }
                if (Date.now() > deadline) fail('Docker не завершил удаление контейнера операции.');
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
    }
    async ready(state) {
        await this.worker(state, ['-m', 'publication.verify_revisions', '--ready-only']);
        const configuration = await this.jsonCompose(state);
        const viewer = configuration.services.viewer.ports[0].published;
        for (const url of [`http://127.0.0.1:${state.env.T4_PORT || 8141}/health`, `http://127.0.0.1:${viewer}/`]) {
            const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
            if (!response.ok) fail('Проверка готовности не пройдена: ' + url);
        }
    }
    async deploy() {
        if (fs.existsSync(path.join(stateRoot, this.project, 'project.json')) || (await this.ids('container')).length ||
            (await this.ids('volume')).length || (await this.ids('network')).length) fail('Проект уже существует. Используйте start, status или refresh-grib.');
        const viewerPort = Number(this.options['--viewer-port'] || 8140), apiPort = Number(this.options['--api-port'] || 8141);
        if (viewerPort === apiPort) fail('Порты карты и API должны различаться.');
        for (const port of [viewerPort, apiPort]) await portAvailable(port);
        const directory = path.join(stateRoot, this.project);
        if (fs.existsSync(directory)) fail('Каталог настройки уже существует; проверьте незавершённое развёртывание.');
        fs.mkdirSync(directory, {recursive: true, mode: 0o700});
        const envFile = path.join(directory, 'environment.env');
        const secrets = ['POSTGRES_PASSWORD', 'WORKER_PASSWORD', 'API_PASSWORD', 'GATEWAY_PASSWORD', 'MOSAIC_PASSWORD', 'GEOSERVER_ADMIN_PASSWORD'];
        fs.writeFileSync(envFile, 'GEOSERVER_ADMIN_USER=hmcoperator\n' + secrets.map(name => name + '=' + randomBytes(24).toString('hex')).join('\n') + '\n', {mode: 0o600});
        const state = {version: 1, root, project: this.project, files: [path.join(root, 'compose.publication.yaml')], envFile, folder: null,
            env: {T4_PORT: String(apiPort), T13_PORT: String(viewerPort), PUBLICATION_IMAGE: 'hmc-publication:app-' + this.project,
                PUBLICATION_EVIDENCE_DIR: this.report, PUBLICATION_INPUT_DIR: path.join(root, 'data/grib'), PUBLICATION_CLOCK: '2026-10-19T05:00:00Z'}};
        save(path.join(directory, 'project.json'), state); // recoverable even if build/start fails
        const npmCandidates = [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
            path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'), '/usr/share/nodejs/npm/bin/npm-cli.js'];
        const npm = npmCandidates.find(file => fs.existsSync(file));
        if (!npm) fail('Не найден npm. Установите стандартный комплект Node.js с npm; настройки проекта сохранены.');
        await this.run(process.execPath, [npm, '--prefix', 'viewer', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], {stage: 'Подготовка просмотрщика'});
        await this.run(process.execPath, ['viewer/build.mjs'], {stage: 'Сборка просмотрщика'});
        await this.run(process.execPath, ['viewer/prepare.mjs'], {stage: 'Подготовка ресурсов карты'});
        await this.composeRun(state, ['build', 'worker'], 'Сборка приложения');
        state.env.PUBLICATION_IMAGE = (await this.json(['image', 'inspect', state.env.PUBLICATION_IMAGE]))[0].Id;
        save(path.join(directory, 'project.json'), state);
        await this.composeRun(state, ['up', '--detach', ...services], 'Запуск служб');
        await this.worker(state, ['-c', "import os; os.chown('/assets',65532,65532); os.chmod('/assets',0o777)"]);
        await this.worker(state, ['-m', 'publication.verify_revisions', '--ready-only']);
        await this.worker(state, ['-c', 'from publication.recovery import migrate; migrate()']);
        await this.ready(state);
        return {state: 'deployed', viewer: `http://127.0.0.1:${viewerPort}`, api: `http://127.0.0.1:${apiPort}`};
    }
    async refresh(configuration) {
        const {state, containers, file} = configuration;
        for (const service of ['db', 'geoserver', 'api', 'gateway'])
            if (!containers.some(item => item.Config.Labels['com.docker.compose.service'] === service && item.State.Running)) fail('Служба ' + service + ' остановлена. Выполните start.');
        const removeAll = Boolean(this.options['--remove-all']);
        if (!removeAll) {
            const folder = sourceFolder(this.options['--folder'] || state.folder || 'data/grib');
            if (state.folder && normalized(folder) !== normalized(state.folder)) fail('За проектом закреплена другая папка GRIB: ' + state.folder);
            state.folder = folder;
        }
        const target = createHash('sha256').update(JSON.stringify({project: this.project, db: containers.find(item => item.Config.Labels['com.docker.compose.service'] === 'db').Id,
            folder: state.folder, budget: this.options['--storage-budget-bytes'] || budgetDefault, removeAll, include: Boolean(this.options['--include-unlocated'])})).digest('hex');
        const args = ['--target', target, ...(removeAll ? ['--remove-all'] : ['--source-directory', state.folder.replaceAll('\\', '/'),
            '--source-directory', path.relative(root, state.folder).replaceAll('\\', '/')]), ...(this.options['--include-unlocated'] ? ['--include-unlocated'] : [])];
        await this.worker(state, ['-m', 'publication.hmc_refresh', 'preview', ...args]);
        const plan = read(path.join(this.report, 'plan.json'));
        this.progress.stop();
        console.log('Снять публикаций: ' + plan.withdrawal.actions.length + '; загрузить файлов: ' + plan.load.length + '; оставить файлов: ' + plan.keep.length + '.');
        for (const name of [...new Set(plan.withdrawal.actions.flatMap(item => item.missing))]) console.log('Снять: ' + name);
        for (const name of plan.load) console.log('Загрузить: ' + name);
        for (const name of plan.keep) console.log('Оставить: ' + name);
        console.log('Непроверенных публикаций: ' + plan.withdrawal.unchecked.length + '; старых без каталога в области: ' + plan.withdrawal.assumed.length + '.');
        if (!plan.withdrawal.actions.length && !plan.load.length && !plan.interrupted.length) {
            if (plan.cleanup_pending.length && !this.options['--dry-run']) await this.worker(state, ['-m', 'publication.hmc_refresh', 'collect'], [], true);
            return {state: 'unchanged'};
        }
        if (!await this.confirm(removeAll)) return {state: this.options['--dry-run'] ? 'planned' : 'cancelled'};
        save(file, state); // bind before the first publication change, never on dry-run
        try {
            await this.worker(state, ['-m', 'publication.hmc_refresh', 'apply', ...args]);
            await this.composeRun(state, ['restart', 'api', 'gateway'], 'Обновление API');
            await this.ready(state);
            return {state: 'completed'};
        } finally {
            if (plan.withdrawal.actions.length) {
                const cancelled = this.cancelled; this.cancelled = false;
                try { await this.worker(state, ['-m', 'publication.hmc_refresh', 'collect'], [], true); }
                finally { this.cancelled = cancelled; }
            }
        }
    }
    async removal({state, containers, file}) {
        if (containers.some(item => item.State.Running && item.Config.Labels['hmc.app.kind'] === 'operation')) fail('Выполняется операция проекта. Сначала завершите её.');
        const volumes = await this.ids('volume'), networks = await this.ids('network');
        const ownedIds = new Set(containers.map(item => item.Id));
        const mounted = [...new Set(containers.flatMap(item => item.Mounts.filter(mount => mount.Type === 'volume').map(mount => mount.Name)))];
        if (mounted.some(name => !volumes.includes(name))) fail('Есть том без подтверждённого владения проектом. Удаление остановлено.');
        for (const volume of volumes) {
            const users = (await this.docker(['ps', '--all', '--quiet', '--no-trunc', '--filter', 'volume=' + volume], {privateOutput: true})).split(/\r?\n/).filter(Boolean);
            if (users.some(id => !ownedIds.has(id))) fail('Том используется другим проектом. Удаление остановлено.');
        }
        const settings = [state.envFile, ...state.files, file].filter(target => fs.existsSync(target) && safeSettingsFile(target));
        this.progress.stop(); console.log(`Удалить ${this.project}: контейнеров ${containers.length}, томов ${volumes.length}, сетей ${networks.length}. Исходные GRIB и отчёты сохраняются.`);
        if (!await this.confirm(true)) return {state: this.options['--dry-run'] ? 'planned' : 'cancelled'};
        await this.removeContainers(containers.map(item => item.Id));
        if (networks.length) await this.docker(['network', 'rm', ...networks], {stage: 'Удаление сетей'});
        if (volumes.length) await this.docker(['volume', 'rm', ...volumes], {stage: 'Удаление томов'});
        for (const kind of ['container', 'volume', 'network']) if ((await this.ids(kind)).length) fail('После удаления остались ресурсы проекта: ' + kind);
        for (const target of settings) {
            if (fs.existsSync(target) && safeSettingsFile(target)) {
                if (fs.lstatSync(target).isSymbolicLink() || !fs.statSync(target).isFile()) fail('Небезопасный файл настройки: ' + target);
                fs.unlinkSync(target);
            }
        }
        const ownDirectory = path.join(stateRoot, this.project);
        if (fs.existsSync(ownDirectory) && fs.readdirSync(ownDirectory).length === 0) fs.rmdirSync(ownDirectory);
        return {state: 'removed'};
    }
    async execute() {
        this.report = evidenceDirectory(this.project);
        const receipt = {mode: this.mode, project: this.project, started: new Date().toISOString()};
        let unlock;
        try {
            if (this.mode !== 'status') unlock = acquireLock(this.project);
            if (this.mode === 'deploy') Object.assign(receipt, await this.deploy());
            else {
                const configuration = await this.configuration();
                if (this.mode === 'refresh-grib') Object.assign(receipt, await this.refresh(configuration));
                if (this.mode === 'remove') Object.assign(receipt, await this.removal(configuration));
                if (this.mode === 'status') {
                    this.progress.stop();
                    for (const item of configuration.containers) console.log((item.Config.Labels['hmc.app.kind'] === 'cleanup' ? 'Очистка данных' :
                        item.Config.Labels['com.docker.compose.service']) + ': ' + (item.State.Running ? 'работает' : 'остановлен'));
                    console.log('Карта: http://127.0.0.1:' + (configuration.state.env.T13_PORT || 8140));
                    console.log('API: http://127.0.0.1:' + (configuration.state.env.T4_PORT || 8141));
                    console.log('Папка GRIB: ' + (configuration.state.folder || 'не привязана'));
                    receipt.state = 'observed';
                }
                if (['start', 'stop'].includes(this.mode)) {
                    save(configuration.file, configuration.state);
                    if (this.mode === 'stop') {
                        // Compose stop excludes run --rm containers. Stop the
                        // project's one-off workers before shutting down its DB.
                        for (const item of configuration.containers.filter(value => value.State.Running &&
                            (value.Config.Labels['hmc.app.kind'] || String(value.Config.Labels['com.docker.compose.oneoff']).toLowerCase() === 'true'))) {
                            try { await this.docker(['stop', '--time', '20', item.Id], {stage: 'Остановка обработки данных'}); }
                            catch (error) { if ((await this.containers()).some(value => value.Id === item.Id && value.State.Running)) throw error; }
                        }
                    }
                    await this.composeRun(configuration.state, this.mode === 'start' ? ['up', '--detach', ...services] : ['stop'], this.mode === 'start' ? 'Запуск проекта' : 'Остановка проекта');
                    if (this.mode === 'stop' && (await this.containers()).some(item => item.State.Running))
                        fail('В проекте остались работающие контейнеры. Проверьте status и повторите stop.');
                    if (this.mode === 'start') {
                        await this.worker(configuration.state, ['-c', "import os; os.chown('/assets',65532,65532); os.chmod('/assets',0o777)"]);
                        await this.worker(configuration.state, ['-c', 'from publication.recovery import migrate; migrate()']);
                        await this.ready(configuration.state);
                        await this.worker(configuration.state, ['-m', 'publication.hmc_refresh', 'collect'], [], true);
                    }
                    receipt.state = this.mode === 'start' ? 'started' : 'stopped';
                }
            }
        } catch (error) { receipt.state = 'failed'; receipt.error = error.message; throw error; }
        finally {
            try { for (const name of this.owned.keys()) await this.removeOwned(name); }
            finally {
                this.progress.stop(); unlock?.();
                process.removeListener('SIGINT', this.signal); process.removeListener('SIGTERM', this.signal);
                receipt.finished = new Date().toISOString(); save(path.join(this.report, 'operation.json'), receipt);
                console.log('План и журналы: ' + this.report);
            }
        }
        console.log(({unchanged: 'Изменений нет.', planned: 'Предварительный просмотр завершён.', cancelled: 'Операция отменена.',
            completed: 'Обновление завершено. В карте нажмите «Проверить обновления».', deployed: 'Проект развёрнут без данных GRIB.',
            removed: 'Проект удалён.', started: 'Проект запущен.', stopped: 'Проект остановлен.'})[receipt.state] || 'Готово.');
        return receipt;
    }
}

function acquireLock(project) {
    const directory = path.join(root, 'data/live/hmc-app/locks');
    fs.mkdirSync(directory, {recursive: true});
    const file = path.join(directory, project + '.json');
    if (fs.existsSync(file)) {
        const old = read(file);
        let running = true;
        try { process.kill(old.pid, 0); } catch (error) { if (error.code === 'ESRCH') running = false; }
        if (running) fail('Уже выполняется команда для этого проекта.');
        fs.unlinkSync(file);
    }
    const fd = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({pid: process.pid})); fs.closeSync(fd);
    return () => fs.unlinkSync(file);
}
async function portAvailable(port) {
    await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', () => reject(Error('Порт занят или недоступен: ' + port)));
        server.listen(port, '127.0.0.1', () => server.close(resolve));
    });
}
function help() {
    console.log(`Использование: node hmc-app.mjs <режим> <проект> [параметры]
deploy        Создать и запустить стенд без GRIB. --viewer-port 8140 --api-port 8141
remove        Удалить стенд, настройки и тома; сохранить исходники и отчёты.
stop / start  Остановить / запустить ранее развёрнутый стенд.
status        Показать состояние, адреса и каталог GRIB.
refresh-grib  Снять отсутствующие, загрузить новые, пропустить опубликованные файлы.
  --folder ПАПКА           Исходный каталог; по умолчанию привязанный либо data/grib.
  --remove-all             Только удалить все GRIB-публикации; исходники сохранить.
  --include-unlocated      Явно включить старые публикации без каталога.
  --storage-budget-bytes N Бюджет обновления (по умолчанию 68719476736).
remove и refresh-grib: --dry-run — просмотр; --yes — без подтверждения.
Одинаковый запуск в Windows и Linux. Требуются Node.js с npm и Docker Compose.
Публикации снимаются сразу; физическая очистка может завершиться позже.
Внимание: используется явное демонстрационное время 2026-10-19T05:00:00Z.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const command = parse(process.argv.slice(2));
        if (command.help) help(); else await new Operator(command).execute();
    } catch (error) { console.error('Операция остановлена: ' + error.message); process.exitCode = 1; }
}
