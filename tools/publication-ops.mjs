#!/usr/bin/env node
// Offline, coherent backups. Rendered Compose configuration and secrets never leave memory.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const format = 'hmc-stack-backup/1';
const volumes = ['postgres', 'assets', 'geoserver'];
const runtime = ['publication', 'decoder', 'config'];
const top = ['compose.publication.yaml', 'Dockerfile.publication', 'requirements.lock',
  'requirements.adapters.lock', 'requirements.publication.lock', 'tools/publication-ops.mjs'];
function fail(message, code = 'OperationFailed') { const error = new Error(message); error.code = code; throw error; }
function digest(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try { let size; while ((size = fs.readSync(fd, buffer)) > 0) hash.update(buffer.subarray(0, size)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function record(file) { return { bytes: fs.statSync(file).size, sha256: digest(file) }; }
function inputs() {
  const files = [...top];
  function walk(directory) {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const name = directory + '/' + entry.name;
      if (entry.isDirectory() && entry.name !== '__pycache__') walk(name);
      else if (entry.isFile() && !name.endsWith('.pyc')) files.push(name);
    }
  }
  runtime.forEach(walk);
  return Object.fromEntries(files.sort().map(name => [name, record(path.join(root, name))]));
}
function docker(args, output) {
  const result = spawnSync('docker', args, { cwd: root, encoding: output ? undefined : 'utf8',
    stdio: output ? ['ignore', output, 'pipe'] : 'pipe', timeout: 600_000, maxBuffer: 32 * 1024 ** 2 });
  // Docker errors may contain environment secrets. Report operation and status only.
  if (result.error || result.status !== 0) fail(`Docker: ${args[0]} — ошибка (код ${result.status ?? 'нет ответа'}). Проверьте Docker и закрытый журнал оператора.`);
  return result.stdout?.toString().trim() ?? '';
}
function json(args) { return JSON.parse(docker(args)); }
function hostPath(value) {
  if (process.platform !== 'win32') return path.resolve(value);
  return path.resolve(value.replace(/^\/run\/desktop\/mnt\/host\/([a-z])\//i, '$1:/')).replaceAll('\\', '/').toLowerCase();
}
function ids(kind, project) {
  if (kind === 'container') {
    const deadline = Date.now() + 15_000;
    // Docker Desktop can briefly list --rm containers after their labels disappear.
    while (docker(['container', 'ls', '--all', '--quiet', '--filter', `label=com.docker.compose.project=${project}`,
      '--filter', 'status=removing'])) {
      if (Date.now() > deadline) fail('Docker ещё удаляет завершённый контейнер; повторите операцию после удаления.');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
  return docker([kind, 'ls', ...(kind === 'container' ? ['--all'] : []), '--quiet',
    '--filter', `label=com.docker.compose.project=${project}`]).split(/\r?\n/).filter(Boolean);
}
function verify(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'backup.json'), 'utf8'));
  if (manifest.format !== format || JSON.stringify(Object.keys(manifest.files).sort()) !==
      JSON.stringify(['assets.tar', 'database.dump', 'geoserver.tar'].sort())) fail('Неполный комплект резервной копии.');
  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = path.join(directory, name);
    if (fs.lstatSync(file).isSymbolicLink() || JSON.stringify(record(file)) !== JSON.stringify(expected))
      fail(`Нарушена целостность: ${name}`, 'BackupIntegrity');
  }
  for (const [name, expected] of Object.entries(manifest.inputs)) {
    if (name.includes('..') || path.isAbsolute(name) || name.includes('\\') ||
        !(top.includes(name) || runtime.some(prefix => name.startsWith(prefix + '/')))) fail('Некорректный путь конфигурации.');
    const file = path.join(directory, 'runtime', name);
    if (!fs.lstatSync(file).isFile() || JSON.stringify(record(file)) !== JSON.stringify(expected)) fail(`Повреждена конфигурация: ${name}`);
  }
  if (JSON.stringify(Object.keys(manifest.decisions).sort()) !==
      JSON.stringify(['selection.json', 'browser.json', 'comparison.json', 'geoserver-numeric.json'].sort())) fail('Нет решения по кодированию.');
  for (const [name, expected] of Object.entries(manifest.decisions)) {
    if (JSON.stringify(record(path.join(directory, 'decisions', name))) !== JSON.stringify(expected)) fail(`Повреждено решение: ${name}`);
  }
  return manifest;
}
function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!['backup', 'verify', 'restore', 'health', 'restart'].includes(command) || rest.length % 2)
    fail('Команды: backup|verify|restore|health|restart --project ИМЯ --env-file ФАЙЛ --directory КАТАЛОГ');
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    if (!['--project', '--env-file', '--directory'].includes(rest[index]) || options[rest[index]]) fail('Неизвестный или повторный параметр.');
    options[rest[index]] = rest[index + 1];
  }
  const directory = options['--directory'] && path.resolve(options['--directory']);
  if (['backup', 'verify', 'restore'].includes(command) && !directory) fail('Укажите --directory.');
  if (command === 'verify') { verify(directory); return { status: 'проверено', format }; }
  const project = options['--project'];
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(project ?? '')) fail('Укажите корректное имя проекта.');
  if (!options['--env-file'] || !fs.statSync(options['--env-file']).isFile()) fail('Нужен внешний файл секретов --env-file.');
  const compose = ['compose', '--project-name', project, '--env-file', path.resolve(options['--env-file']),
    '--file', path.join(root, 'compose.publication.yaml')];
  const run = (...args) => docker([...compose, ...args]);
  const configuration = json([...compose, 'config', '--format', 'json']);
  const image = configuration.services.worker.image;
  const credentials = createHash('sha256').update(JSON.stringify([
    configuration.services.db.environment, configuration.services.geoserver.environment])).digest('hex');
  const imageIds = Object.fromEntries([...new Set(Object.values(configuration.services).map(service => service.image))]
    .sort().map(name => [name, json(['image', 'inspect', name])[0].Id]));
  // Do not permit environment overrides to redirect recovery into shared volumes.
  for (const name of volumes) {
    const value = configuration.volumes[name];
    if (value.external || value.name !== `${project}_${name}`) fail('Нужны отдельные тома проекта Compose.');
  }
  for (const service of ['worker', 'api']) {
    const mount = configuration.services[service].volumes.find(item => item.target === (service === 'api' ? '/assets' : '/input'));
    if (!mount?.read_only) fail('Исходники и данные API должны быть смонтированы только для чтения.');
  }
  function health() {
    run('run', '--rm', '--entrypoint', 'python', 'check', '-m', 'publication.verify_revisions', '--ready-only');
  }
  if (command === 'health') { health(); return { status: 'работает' }; }
  if (command === 'restart') {
    run('restart', 'db', 'geoserver', 'api', 'gateway'); health();
    return { status: 'перезапущено', cache: 'Процессные кеши сброшены; сохранённые ревизии проверяются при чтении.' };
  }
  const resources = ids('container', project);
  const containers = resources.length ? json(['inspect', ...resources]) : [];
  function transfer(name, restore) {
    const program = restore ? `
import os,tarfile
def owned(member,destination):
    filtered=tarfile.data_filter(member,destination)
    if filtered is not None:
        filtered.uid,filtered.gid=member.uid,member.gid
    return filtered
with tarfile.open('/backup/${name}.tar') as archive:
    archive.extractall('/volume',filter=owned)
` : `
import os,tarfile
os.umask(0o077)
with tarfile.open('/backup/${name}.tar','x') as archive:
    archive.add('/volume',arcname='.')
`;
    docker(['run', '--rm', '--name', `${project}-backup-${randomUUID()}`, '--label', `com.docker.compose.project=${project}`,
      '--label', `com.docker.compose.project.working_dir=${root}`, '--network', 'none', '--read-only', '--user', '0:0',
      '--mount', `type=volume,src=${project}_${name},dst=/volume${restore ? '' : ',readonly'}`,
      '--mount', `type=bind,src=${directory},dst=/backup${restore ? ',readonly' : ''}`,
      '--entrypoint', 'python', image, '-c', program]);
  }
  if (command === 'restore') {
    const saved = verify(directory);
    if (JSON.stringify(saved.inputs) !== JSON.stringify(inputs())) fail('Исходный код/контракты отличаются. Используйте сохранённую ревизию развёртывания.');
    if (JSON.stringify(saved.images) !== JSON.stringify(imageIds)) fail('Образы отличаются от резервной копии.');
    if (saved.credentials_sha256 !== credentials) fail('Требуется исходный внешний комплект секретов.');
    if (resources.length || ids('volume', project).length || ids('network', project).length)
      fail('Восстановление разрешено только в новый пустой проект. Существующие ресурсы сохранены.', 'ExistingProject');
    // Names can exist without Compose labels: reject those before any up/create.
    const existing = docker(['volume', 'ls', '--format', '{{.Name}}']).split(/\r?\n/);
    if (volumes.some(name => existing.includes(`${project}_${name}`))) fail('Имена томов уже заняты.');
    const evidence = configuration.services.worker.volumes.find(item => item.target === '/evidence').source;
    fs.mkdirSync(evidence, { recursive: true });
    for (const [name, expected] of Object.entries(saved.decisions)) {
      const target = path.join(evidence, name);
      if (fs.existsSync(target) && digest(target) !== expected.sha256) fail('Каталог решений содержит другую конфигурацию.');
    }
    for (const name of Object.keys(saved.decisions)) {
      const target = path.join(evidence, name);
      if (!fs.existsSync(target)) fs.copyFileSync(path.join(directory, 'decisions', name), target, fs.constants.COPYFILE_EXCL);
    }
    run('up', '--detach', '--wait', 'db');
    for (const name of ['assets', 'geoserver']) {
      docker(['volume', 'create', '--label', `com.docker.compose.project=${project}`,
        '--label', `com.docker.compose.volume=${name}`, `${project}_${name}`]);
      transfer(name, true);
    }
    const db = run('ps', '--quiet', 'db');
    docker(['cp', path.join(directory, 'database.dump'), `${db}:/tmp/hmc-restore.dump`]);
    run('exec', '--no-TTY', 'db', 'pg_restore', '--username=postgres', '--dbname=hmc',
      '--clean', '--if-exists', '--exit-on-error', '/tmp/hmc-restore.dump');
    run('exec', '--no-TTY', 'db', 'rm', '/tmp/hmc-restore.dump');
    // Keep edge/readers stopped until an explicit operator health/selection check.
    return { status: 'восстановлено', next: 'Запустите geoserver api gateway; выполните health и сравнение сохранённых выборок до открытия внешнего доступа.' };
  }
  if (!containers.length || !containers.some(item => item.Config.Labels['com.docker.compose.service'] === 'db'))
    fail('Проект не содержит базы данных.');
  if (containers.some(item => item.Config.Labels['com.docker.compose.oneoff'] === 'True')) fail('Завершите одноразовые команды перед копированием.');
  for (const item of containers) {
    const owner = item.Config.Labels['com.docker.compose.project.working_dir'];
    if (!owner || path.resolve(owner) !== root) fail('Проект содержит ресурс без подтверждённой принадлежности checkout; дождитесь удаления завершённых одноразовых контейнеров.');
    const service = configuration.services[item.Config.Labels['com.docker.compose.service']];
    if (!service || item.Image !== imageIds[service.image]) fail('Фактический образ сервиса отличается от конфигурации.');
    const environment = Object.fromEntries(item.Config.Env.map(value => {
      const index = value.indexOf('='); return [value.slice(0, index), value.slice(index + 1)];
    }));
    if (Object.entries(service.environment ?? {}).some(([name, value]) => environment[name] !== String(value)))
      fail('Фактическое окружение сервиса отличается от конфигурации; исходный проект сохранён.');
    for (const mount of service.volumes ?? []) {
      const actual = item.Mounts.find(value => value.Destination === mount.target);
      const source = mount.type === 'volume' ? configuration.volumes[mount.source].name : mount.source;
      if (!actual || (mount.type === 'volume' ? actual.Name !== source : hostPath(actual.Source) !== hostPath(source)) ||
          Boolean(actual.RW) === Boolean(mount.read_only)) fail('Фактические mounts сервиса отличаются от конфигурации.');
    }
  }
  if (fs.existsSync(directory)) fail('Каталог копии уже существует. Выберите новый.');
  fs.mkdirSync(directory, { mode: 0o700, recursive: true });
  const running = containers.filter(item => item.State.Running).map(item => item.Config.Labels['com.docker.compose.service']);
  const frozen = inputs();
  try {
    run('stop');
    run('up', '--detach', '--wait', 'db');
    const fd = fs.openSync(path.join(directory, 'database.dump'), 'wx', 0o600);
    try { docker([...compose, 'exec', '--no-TTY', 'db', 'pg_dump', '--username=postgres', '--dbname=hmc', '--format=custom'], fd); }
    finally { fs.closeSync(fd); }
    run('stop', 'db');
    transfer('assets', false); transfer('geoserver', false);
    for (const name of Object.keys(frozen)) {
      const destination = path.join(directory, 'runtime', name);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.copyFileSync(path.join(root, name), destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, 0o600);
    }
    // The accepted encoder decision is needed to resume queued publication, not only to read it.
    const evidenceMount = configuration.services.worker.volumes.find(item => item.target === '/evidence');
    fs.mkdirSync(path.join(directory, 'decisions'), { mode: 0o700 });
    const decisions = {};
    for (const name of ['selection.json', 'browser.json', 'comparison.json', 'geoserver-numeric.json']) {
      const source = path.join(evidenceMount.source, name);
      fs.copyFileSync(source, path.join(directory, 'decisions', name), fs.constants.COPYFILE_EXCL);
      decisions[name] = record(source);
    }
    if (JSON.stringify(frozen) !== JSON.stringify(inputs())) fail('Код изменился во время копирования. Копия не принята.');
    const manifest = { format, created_at: new Date().toISOString(), project, inputs: frozen, images: imageIds, decisions, credentials_sha256: credentials,
      files: Object.fromEntries(['database.dump', 'assets.tar', 'geoserver.tar'].map(name => [name, record(path.join(directory, name))])),
      secrets: 'Внешний файл секретов и API-ключи не копируются. GeoServer archive содержит закрытые настройки: хранить защищённо.',
      cache: 'Процессные числовые кеши не копируются; детерминированная генерация из сохранённых manifest/Zarr.' };
    fs.writeFileSync(path.join(directory, 'backup.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    verify(directory);
  } finally {
    run('stop', 'db');
    if (running.length) run('start', ...running);
  }
  return { status: 'скопировано', format, services_resumed: running };
}
try { console.log(JSON.stringify(main())); }
catch (error) { console.error(`[${error.code ?? 'OperationFailed'}] Операция не выполнена: ${error.message}`); process.exitCode = 1; }
