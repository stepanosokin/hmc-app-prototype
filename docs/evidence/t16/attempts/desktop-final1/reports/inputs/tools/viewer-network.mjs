import assert from 'node:assert/strict';

// Page Fetch interception also receives its dedicated workers' requests.
// Exercise page/worker/nested-worker probes rather than assuming CDP domain support.
export async function restrictRuntimeNetwork(call, origin, report) {
    const evidence=report.network={policy:'same origin only; page CDP Fetch before request; page and nested dedicated-worker probes',
        origin,blocked:[],allowed:[]};
    const pending=new Set();
    let failure;
    const event=message=>{
        if(message.method!=='Fetch.requestPaused')return;
        const operation=(async()=>{
            const {requestId,request,resourceType}=message.params;
            const url=new URL(request.url),local=url.origin===origin;
            if(!['http:','https:','ws:','wss:'].includes(url.protocol)){
                await call('Fetch.continueRequest',{requestId});return;
            }
            evidence[local?'allowed':'blocked'].push({url:request.url,resource_type:resourceType});
            await call(local?'Fetch.continueRequest':'Fetch.failRequest',local?{requestId}:{requestId,errorReason:'BlockedByClient'});
        })();
        pending.add(operation);
        operation.catch(error=>{failure??=error;}).finally(()=>pending.delete(operation));
    };
    return {event,start:async()=>{
        await call('Network.setCacheDisabled',{cacheDisabled:true});
        await call('Network.setBypassServiceWorker',{bypass:true});
        await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
    },finish:async()=>{
        while(pending.size)await Promise.allSettled([...pending]);
        if(failure)throw failure;
        for(const path of ['page','worker','nested-worker'])
            assert.ok(evidence.blocked.some(r=>r.url==='https://hmc-runtime-check.invalid/'+path),path+' external request was intercepted');
        assert.ok(evidence.allowed.length>0,'Local runtime traffic observed');
        assert.ok(evidence.blocked.every(r=>r.url.startsWith('https://hmc-runtime-check.invalid/')),'No application dependency attempted public access');
        evidence.status='passed';
    }};
}
