import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// Public operator boundary: reject damaged backups before allocating any Docker resources.
test('backup verification accepts intact bytes and rejects damaged data, decisions and configuration', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hmc-backup-'));
  const hash = data => ({ bytes: Buffer.byteLength(data), sha256: createHash('sha256').update(data).digest('hex') });
  try {
    const manifest = { format: 'hmc-stack-backup/1', files: {}, inputs: {}, decisions: {} };
    for (const name of ['database.dump', 'assets.tar', 'geoserver.tar']) {
      fs.writeFileSync(path.join(directory, name), 'retained bytes');
      manifest.files[name] = hash('retained bytes');
    }
    fs.mkdirSync(path.join(directory, 'runtime'));
    fs.writeFileSync(path.join(directory, 'runtime', 'compose.publication.yaml'), 'configuration');
    manifest.inputs['compose.publication.yaml'] = hash('configuration');
    fs.mkdirSync(path.join(directory, 'decisions'));
    for (const name of ['selection.json', 'browser.json', 'comparison.json', 'geoserver-numeric.json']) {
      fs.writeFileSync(path.join(directory, 'decisions', name), '{}');
      manifest.decisions[name] = hash('{}');
    }
    const save = () => fs.writeFileSync(path.join(directory, 'backup.json'), JSON.stringify(manifest));
    const verify = () => spawnSync(process.execPath, ['tools/publication-ops.mjs', 'verify', '--directory', directory], { encoding: 'utf8' });
    save();
    assert.equal(verify().status, 0);
    for (const name of ['database.dump', 'runtime/compose.publication.yaml', 'decisions/selection.json']) {
      const original = fs.readFileSync(path.join(directory, name));
      fs.appendFileSync(path.join(directory, name), 'corrupted');
      assert.equal(verify().status, 1, name);
      fs.writeFileSync(path.join(directory, name), original);
    }
    manifest.inputs['../outside'] = hash('configuration'); save();
    assert.equal(verify().status, 1, 'unsafe input path');
    delete manifest.inputs['../outside']; delete manifest.files['assets.tar']; save();
    assert.equal(verify().status, 1, 'incomplete bundle');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
