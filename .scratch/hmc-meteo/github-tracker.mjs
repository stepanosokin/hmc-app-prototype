// Narrow repository-scoped REST helper for issue tracking when the connector is read-only.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const directory=path.dirname(fileURLToPath(import.meta.url));
const repository='stepanosokin/hmc-app-prototype';
const root=path.resolve(directory,'../..');
const operations=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
for(const op of operations) if(!['GET','POST','PATCH'].includes(op.method)||!/^\/(?:issues|labels)(?:[/?]|$)/.test(op.path)) throw Error('Only this repository issue/label API is allowed.');
for(const op of operations) if(op.body && Object.hasOwn(op.body,'body') && typeof op.body.body !== 'string') throw Error('Issue body must be a plain JSON string; no request was sent.');
let credential;
try {
  credential=execFileSync('git',['credential','fill'],{cwd:root,input:'protocol=https\nhost=github.com\nusername=stepanosokin\n\n',encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'}});
} catch {
  throw Error('GitHub credential helper failed; credential output is not logged.');
}
const token=credential.split(/\r?\n/).find(line=>line.startsWith('password='))?.slice(9);
if(!token) throw Error('No scoped GitHub authentication available.');
const output=[];
for(const op of operations) {
  const response=await fetch(`https://api.github.com/repos/${repository}${op.path}`,{method:op.method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'hmc-wayfinder-tracker',...(op.body?{'Content-Type':'application/json'}:{})},body:op.body?JSON.stringify(op.body):undefined});
  if(!response.ok) throw Error(`${op.method} ${op.path}: ${response.status} ${(await response.text()).slice(0,250)}`);
  const data=response.status===204?null:await response.json();
  output.push({tag:op.tag??null,path:op.path,data});
  fs.writeFileSync(process.argv[3]??path.join(directory,'github-last-result.json'),JSON.stringify(output,null,2));
  console.log(JSON.stringify({tag:op.tag??null,path:op.path,id:data?.id,number:data?.number,url:data?.html_url,state:data?.state,sub_issues_summary:data?.sub_issues_summary,issue_dependencies_summary:data?.issue_dependencies_summary,count:Array.isArray(data)?data.length:undefined}));
}
