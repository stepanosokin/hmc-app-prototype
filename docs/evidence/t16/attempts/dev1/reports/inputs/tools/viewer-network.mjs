import assert from 'node:assert/strict';

// Apply to the page and every descendant worker before it can execute.
export async function restrictRuntimeNetwork(call, origin, report) {
    const evidence=report.network={policy:'same origin only; CDP Fetch before request, page and descendant workers',
        origin,targets:[],blocked:[],allowed:[]};
    const pending=new Set();
    let failure;
    const track=promise=>{
        pending.add(promise);
        promise.catch(error=>{failure??=error;}).finally(()=>pending.delete(promise));
    };
    const enable=async sessionId=>{
        await call('Network.enable',{},sessionId);
        await call('Network.setCacheDisabled',{cacheDisabled:true},sessionId);
        await call('Network.setBypassServiceWorker',{bypass:true},sessionId);
        await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]},sessionId);
        await call('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true},sessionId);
    };
    const event=message=>{
        if(message.method==='Target.attachedToTarget')track((async()=>{
            const {sessionId,targetInfo}=message.params;
            evidence.targets.push({type:targetInfo.type,url:targetInfo.url});
            await enable(sessionId);
            await call('Runtime.runIfWaitingForDebugger',{},sessionId);
        })());
        if(message.method==='Fetch.requestPaused')track((async()=>{
            const {requestId,request,resourceType}=message.params;
            const url=new URL(request.url),local=url.origin===origin;
            if(!['http:','https:','ws:','wss:'].includes(url.protocol)){
                await call('Fetch.continueRequest',{requestId},message.sessionId);return;
            }
            evidence[local?'allowed':'blocked'].push({url:request.url,resource_type:resourceType,worker:Boolean(message.sessionId)});
            await call(local?'Fetch.continueRequest':'Fetch.failRequest',local?{requestId}:{requestId,errorReason:'BlockedByClient'},message.sessionId);
        })());
    };
    // The caller attaches the event handler before enabling interception.
    return {event,start:()=>enable(),finish:async()=>{
        while(pending.size)await Promise.allSettled([...pending]);
        if(failure)throw failure;
        assert.ok(evidence.blocked.some(r=>r.url=== 'https://hmc-runtime-check.invalid/page'),'Page external request was blocked');
        assert.ok(evidence.blocked.some(r=>r.url=== 'https://hmc-runtime-check.invalid/worker'&&r.worker),'Worker external request was blocked');
        assert.ok(evidence.targets.some(t=>t.type==='worker'),'Worker interception active');
        assert.ok(evidence.allowed.length>0,'Local runtime traffic observed');
        evidence.status='passed';
    }};
}
