// Read-only #106 compatibility probe. Never changes the upstream publication.
import http from 'node:http';
import fs from 'node:fs';
const [configPath,report]=process.argv.slice(2);
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
fs.mkdirSync(report,{recursive:false});
let generation=1;
const observations=[];
const server=http.createServer(async(req,res)=>{
    const incoming=new URL(req.url,'http://localhost');
    if(incoming.pathname==='/advance'){
        generation=2;res.end('2');return;
    }
    const selected=incoming.pathname==='/wms'?generation:Number(incoming.pathname.split('/')[2]);
    const operation=[...incoming.searchParams].find(([key])=>key.toUpperCase()==='REQUEST')?.[1]??'';
    try{
        const response=await fetch(config.origin+config.route+incoming.search,{signal:AbortSignal.timeout(30000)});
        let body=Buffer.from(await response.arrayBuffer());
        if(operation.toLowerCase()==='getcapabilities'&&response.ok){
            const frozen=`http://127.0.0.1:${server.address().port}/snapshot/${selected}/wms?`;
            body=Buffer.from(body.toString('utf8').replace(/xlink:href="([^"]*)"/g,(_,url)=>{
                const query=url.includes('?')?url.slice(url.indexOf('?')+1):'';
                return `xlink:href="${frozen}${query}"`;
            }));
            fs.writeFileSync(`${report}/capabilities-${selected}.xml`,body);
        }
        observations.push({path:incoming.pathname,operation,generation:selected,status:response.status});
        fs.writeFileSync(`${report}/requests.json`,JSON.stringify(observations,null,2));
        res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')??'application/octet-stream',
            'Cache-Control':'no-store','Content-Length':body.length});
        res.end(body);
    }catch(error){
        observations.push({path:incoming.pathname,operation,error:error.message});
        fs.writeFileSync(`${report}/requests.json`,JSON.stringify(observations,null,2));
        res.writeHead(502);res.end('Probe upstream failure');
    }
});
server.listen(0,'127.0.0.1',()=>{
    const state={...config,proxy_port:server.address().port,kind:'compatibility-probe-not-acceptance'};
    fs.writeFileSync(`${report}/config.json`,JSON.stringify(state,null,2));
    console.log(JSON.stringify({port:state.proxy_port}));
});
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
