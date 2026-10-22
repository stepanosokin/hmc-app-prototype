import assert from 'node:assert/strict';

// Page Fetch interception also receives its dedicated workers' requests.
// Exercise page/worker/nested-worker probes rather than assuming CDP domain support.
export async function restrictRuntimeNetwork(call, origin, report) {
    const evidence=report.network={policy:'same origin only; page CDP Fetch before request; page and nested dedicated-worker probes',
        origin,blocked:[],allowed:[]};
    const pending=new Set(),canceled=new Set(),retired=[];
    evidence.retired_interceptions=[];
    let failure;
    const event=message=>{
        if(message.method==='Network.loadingFailed'&&message.params.canceled===true)
            canceled.add(message.params.requestId);
        if(message.method!=='Fetch.requestPaused')return;
        const operation=(async()=>{
            const {requestId,request,resourceType,networkId}=message.params;
            const url=new URL(request.url),local=url.origin===origin;
            const continueLocal=async()=>{
                try{await call('Fetch.continueRequest',{requestId});}
                catch(error){
                    let detail;try{detail=JSON.parse(error.message);}catch{}
                    if(!local||!networkId||detail?.code!==-32602||detail.message!=='Invalid InterceptionId.')throw error;
                    retired.push({request_id:requestId,network_id:networkId,url:request.url,error});
                }
            };
            if(!['http:','https:','ws:','wss:'].includes(url.protocol)){
                await continueLocal();return;
            }
            evidence[local?'allowed':'blocked'].push({url:request.url,resource_type:resourceType});
            if(local)await continueLocal();
            else await call('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});
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
        for(const item of retired){
            if(!canceled.has(item.network_id))throw item.error;
            const {error,...receipt}=item;evidence.retired_interceptions.push({...receipt,canceled:true});
        }
        for(const path of ['page','worker','nested-worker'])
            assert.ok(evidence.blocked.some(r=>r.url==='https://hmc-runtime-check.invalid/'+path),path+' external request was intercepted');
        assert.ok(evidence.allowed.length>0,'Local runtime traffic observed');
        assert.ok(evidence.blocked.every(r=>r.url.startsWith('https://hmc-runtime-check.invalid/')),'No application dependency attempted public access');
        evidence.status='passed';
    }};
}
