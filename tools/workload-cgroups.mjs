import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile),[project,output]=process.argv.slice(2);
assert.match(project,/^hmc-publication-t19-[a-z0-9-]+$/);
const {stdout}=await exec('docker',['ps','--filter','label=com.docker.compose.project='+project,'--format','{{.ID}} {{.Names}}'],{windowsHide:true});
const names=stdout.trim().split(/\r?\n/).filter(Boolean);
const files=['cpu.stat','io.stat','memory.current','memory.peak','cpu.max','memory.max'];
const containers=await Promise.all(names.map(async line=>{
    const [id,name]=line.split(' ');
    const {stdout}=await exec('docker',['exec',id,'cat',...files.map(f=>'/sys/fs/cgroup/'+f)],{windowsHide:true,maxBuffer:1024**2});
    const lines=stdout.trim().split(/\r?\n/),tail=lines.splice(-4),cpu={},io={};
    let ioDevices=0;
    for(const line of lines){
        if(/^\d+:\d+ /.test(line)){ioDevices++;for(const item of line.split(' ').slice(1)){const [key,value]=item.split('=');io[key]=(io[key]??0)+Number(value);}}
        else{const [key,value]=line.split(' ');cpu[key]=Number(value);}
    }
    let geoserver_data,postgres_data;
    if(name.endsWith('-geoserver-1')){
        const size=await exec('docker',['exec',id,'du','-sb','/opt/geoserver_data'],{windowsHide:true,maxBuffer:1024**2});
        geoserver_data={logical_bytes:Number(size.stdout.split(/\s+/)[0]),
            scope:'GeoServer data directory; du without symlink dereference; shared canonical assets counted by managed filesystem snapshot'};
    }
    if(name.endsWith('-db-1')){
        const size=await exec('docker',['exec',id,'du','-sb','/var/lib/postgresql'],{windowsHide:true,maxBuffer:1024**2});
        postgres_data={logical_bytes:Number(size.stdout.split(/\s+/)[0]),scope:'Postgres data tree including WAL and indexes; pg_database_size is a separate overlapping measurement'};
    }
    return {id,name,cpu,io,io_status:ioDevices?'reported cgroup block counters':'unavailable: empty io.stat; not zero physical I/O',
        geoserver_data,postgres_data,
        memory_current_bytes:Number(tail[0]),memory_peak_bytes:Number(tail[1]),cpu_max:tail[2],memory_max:tail[3]};
}));
await writeFile(output,JSON.stringify({observed_at:new Date().toISOString(),project,
    scope:'cgroup CPU totals, current/peak memory including page cache; not worker RSS; Docker/WSL2 I/O availability declared',containers},null,2)+'\n');
console.log(JSON.stringify({project,containers:containers.length,output}));
