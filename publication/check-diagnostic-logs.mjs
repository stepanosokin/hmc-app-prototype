// Inspect only the current isolated report; never print environment values.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const directory = path.resolve(process.argv[2]);
const environment = fs.readFileSync(path.join(directory, 'environment.env'), 'utf8');
const secrets = environment.split(/\r?\n/).filter(line=>/PASSWORD=/.test(line)).map(line=>line.slice(line.indexOf('=')+1));
let clean = true;
const events = [];
for (const name of fs.readdirSync(directory).filter(name=>/\.(log|json|jsonl)$/.test(name))) {
    const target = path.join(directory, name);
    let contents = fs.readFileSync(target, 'utf8');
    for (const secret of secrets) {
        if (secret && contents.includes(secret)) {
            clean = false;
            contents = contents.replaceAll(secret, '[REDACTED]');
        }
    }
    if (!clean) fs.writeFileSync(target, contents);
    for (const line of contents.split(/\r?\n/)) {
        try { events.push(JSON.parse(line.slice(line.indexOf('{')))); } catch { /* Native logs are not JSON. */ }
    }
}
const gateway = events.filter(e=>e.service==='gateway' && e.event==='request');
const api = events.filter(e=>e.service==='api' && e.event==='response');
const correlated = gateway.filter(e=>api.some(a=>a.request_id===e.request_id && a.identity?.revision===e.revision));
const jobs = events.filter(e=>e.service==='worker' && e.event==='job_finished' && e.selection);
const result = {secrets_absent:clean, correlated_requests:correlated.length,
    correlated_publications:jobs.filter(j=>gateway.some(g=>g.selection===j.selection)).length};
fs.writeFileSync(path.join(directory,'log-check.json'),JSON.stringify(result,null,2)+'\n');
assert(clean, 'A credential was redacted; this attempt failed the secret-output gate');
assert(result.correlated_requests>0, 'No gateway/API request and publication correlation');
assert(result.correlated_publications>0, 'No worker/job and gateway selection correlation');
console.log(JSON.stringify(result));
