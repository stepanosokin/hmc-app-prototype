// Disposable browser/profile cleanup check only; the page is an explicit UI stub.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
fs.mkdirSync('data/reports/t16',{recursive:true});
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html lang="ru"><p id="projectionStatus">Режим недоступен</p><button id="useMercator">Меркатор</button><select id="projection"><option value="mercator">Меркатор</option></select>');});
await new Promise(r=>server.listen(8161,'127.0.0.1',r));
try{
 const child=spawn(process.execPath,['tools/check-weather-viewer.mjs'],{windowsHide:true,stdio:'pipe',env:{...process.env,T13_VIEWER:'http://127.0.0.1:8161',T13_DISABLE_GPU:'1',T16_OFFLINE:'1',T13_BROWSER:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',T13_REPORT_DIRECTORY:'data/reports/t16/cleanup-dev1'}});
 const out=[],err=[];child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>err.push(b));
 const code=await new Promise((r,j)=>{child.on('error',j);child.on('exit',r);});
 fs.writeFileSync('docs/evidence/t16/checks/cleanup-development.stdout.log',Buffer.concat(out));fs.writeFileSync('docs/evidence/t16/checks/cleanup-development.stderr.log',Buffer.concat(err));
 const report=JSON.parse(fs.readFileSync('data/reports/t16/cleanup-dev1/browser.json','utf8'));
 fs.writeFileSync('docs/evidence/t16/checks/cleanup-development.json',JSON.stringify({scope:'Disposable real Edge/profile cleanup, explicit unavailable UI stub; NOT actual viewer/GPU acceptance',exit_code:code,browser:report.browser,cleanup:report.cleanup,status:report.status},null,2)+'\n');
 assert.equal(code,0);assert.equal(report.status,'passed');console.log(JSON.stringify({status:report.status,cleanup:report.cleanup}));
}finally{await new Promise(r=>server.close(r));}
