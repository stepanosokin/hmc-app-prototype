// Read-only audit of existing publications before/after the 10m wind policy change.
import fs from 'node:fs';
import path from 'node:path';
import {docker,standConfiguration} from './sync-grib.mjs';
const phase=process.argv[2],project='hmc-app-live';
if(!['before','after'].includes(phase))throw Error('Use before or after');
const ids=docker(['container','ls','--all','--quiet','--filter','label=com.docker.compose.project='+project]).split(/\r?\n/).filter(Boolean);
const containers=JSON.parse(docker(['inspect',...ids])),stand=standConfiguration(containers,project);
const env={...process.env,DB_PASSWORD:stand.password};
const geoserver=containers.find(c=>c.Config.Labels['com.docker.compose.service']==='geoserver');
for(const key of ['GEOSERVER_ADMIN_USER','GEOSERVER_ADMIN_PASSWORD'])env[key]=geoserver.Config.Env.find(e=>e.startsWith(key+'=')).slice(key.length+1);
const report=path.resolve('data/reports/wind-threshold/live');fs.mkdirSync(report,{recursive:true});
console.log(docker(['run','--rm','--name','hmc-wind-threshold-audit-'+phase,'--read-only','--cap-drop=ALL','--network',stand.network,
 '--tmpfs','/tmp:mode=1777','--env','PYTHONPATH=/app','--env','DB_USER=hmc_worker',...['DB_PASSWORD','GEOSERVER_ADMIN_USER','GEOSERVER_ADMIN_PASSWORD'].flatMap(k=>['--env',k]),
 '--mount',`type=volume,source=${stand.assets},target=/assets,readonly`,
 ...['decoder','publication','config'].flatMap(d=>['--mount',`type=bind,source=${path.resolve(d)},target=/app/${d},readonly`]),
 '--mount',`type=bind,source=${path.resolve('tools/check-wind-threshold-live.py')},target=/audit.py,readonly`,
 '--mount',`type=bind,source=${report},target=/report`,
 '--entrypoint','python',stand.image,'-B','/audit.py',phase],env));
