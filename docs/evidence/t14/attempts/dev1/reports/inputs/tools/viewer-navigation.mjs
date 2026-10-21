import assert from 'node:assert/strict';

// Delay real browser boundaries, retaining the real response bytes and GPU calls.
// The transport deliberately ignores cancellation to exercise late completions.
export const navigationDelays=`(()=>{
    const gate={stage:null,hit:false,released:false,history:[],resume:null};
    window.__navigationGate=gate;
    const hold=async(stage,url)=>{
        if(gate.stage!==stage||gate.hit)return;
        gate.hit=true;gate.history.push({stage,url,event:'held'});
        await new Promise(resolve=>gate.resume=resolve);
        gate.released=true;gate.history.push({stage,url,event:'released'});
    };
    const fetchOriginal=window.fetch;
    window.fetch=async(input,options)=>{
        const url=String(input),tile=url.includes('/native/')&&url.endsWith('.f32');
        const response=await fetchOriginal(input,tile||url.includes('/point?')?{...options,signal:undefined}:options);
        if(tile)await hold('fetch',url);
        return response;
    };
    const arrayBuffer=Response.prototype.arrayBuffer,text=Response.prototype.text;
    Response.prototype.arrayBuffer=async function(){const bytes=await arrayBuffer.call(this);
        if(this.url.includes('/native/'))await hold('decode',this.url);return bytes;};
    Response.prototype.text=async function(){const bytes=await text.call(this);
        if(this.url.includes('/point?'))await hold('point',this.url);return bytes;};
    const raf=window.requestAnimationFrame;
    window.requestAnimationFrame=callback=>raf(async time=>{
        if(gate.stage==='upload'&&gate.hit&&!gate.released)await new Promise(resolve=>gate.waiters.push(()=>resolve()));
        callback(time);
    });
    const upload=WebGL2RenderingContext.prototype.texSubImage3D;
    WebGL2RenderingContext.prototype.texSubImage3D=function(...args){
        const result=upload.apply(this,args);
        if(gate.stage==='upload'&&!gate.hit){gate.hit=true;gate.waiters=[];
            gate.history.push({stage:'upload',event:'real texture write before pause'});
            gate.resume=()=>{gate.released=true;for(const resume of gate.waiters)resume();gate.history.push({stage:'upload',event:'released'});};}
        return result;
    };
})()`;

export async function checkNavigation({call,evaluate,wait,select,click,capture,origin,report}){
    await call('Page.addScriptToEvaluateOnNewDocument',{source:navigationDelays});
    await call('Page.navigate',{url:origin+'/?validation=1&fixtures=1'});
    await wait("window.captureWeatherEvidence?.().ready",'overlapping fixture ready');
    const initial=await capture();
    assert.equal(initial.selected.fixture,'overlap','Newest usable run, explicit overlapping fixture');
    assert.equal(initial.selected.valid_time,'2026-10-15T01:00:00Z');
    assert.match(await evaluate("document.getElementById('forecastSummary').textContent"),/Тестовый/);
    const newest=initial.selected;
    const results=[];
    const missing=async()=>{
        const state=await capture();
        assert.equal(state.ready,false);assert.equal(state.selected,undefined);assert.equal(state.point,undefined);
        assert.equal(await evaluate("document.querySelectorAll('#pointContent strong,#mobilePoint strong').length>0&&[...document.querySelectorAll('#pointContent strong,#mobilePoint strong')].every(e=>!e.textContent.includes('°C')&&!e.textContent.includes(' K'))"),true);
        assert.match(await evaluate("document.getElementById('notice').textContent"),/срок отсутствует/);
        assert.equal(await evaluate("document.getElementById('reference').textContent.includes('01:00')&&document.getElementById('valid').textContent.includes('02:00')"),true);
    };
    await select('#time',true,2);
    await wait('window.captureWeatherEvidence().ready','last published time');
    let state=await capture();assert.equal(state.selected.run,newest.run);assert.equal(state.selected.revision,newest.revision);
    assert.equal(state.selected.valid_time,'2026-10-15T03:00:00Z');
    await click('#settings');await select('#run',true,1);await click('#closeDrawer');
    await wait('window.captureWeatherEvidence().ready','older run first time');
    state=await capture();assert.equal(state.selected.fixture,'actual');assert.equal(state.selected.valid_time,'2026-10-15T01:00:00Z');
    await click('#settings');await select('#run',true,0);await click('#closeDrawer');
    await wait('window.captureWeatherEvidence().ready','newest run first time');
    assert.equal((await capture()).selected.selection,newest.selection);
    report.checks.push('T14 newest usable run, run reset, pinned revision/time and explicitly marked overlap');
    for(const stage of ['fetch','decode','upload']){
        await evaluate(`Object.assign(window.__navigationGate,{stage:${JSON.stringify(stage)},hit:false,released:false,resume:null})`);
        await select('#time',true,2);
        await wait('window.__navigationGate.hit','held '+stage);
        // Clear partial textures and choose a gap while old work remains pending.
        await select('#time',true,1);await missing();
        await evaluate('window.__navigationGate.resume()');
        // A browser task barrier follows release and all pending microtasks/frames.
        await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
        await missing();
        results.push({stage,missing_after_release:true,history:await evaluate('window.__navigationGate.history.splice(0)')});
        await evaluate('window.__navigationGate.stage=null');
        await select('#time',true,0);await wait('window.captureWeatherEvidence().ready','first time restored');
        const view=(await capture(true)).view;
        assert.equal(view.cache_identity.identity.revision,newest.revision);
        assert.equal(view.cache_identity.identity.valid_time,newest.valid_time);
        assert.equal(view.cache_identity.encoding,'f32');
    }
    await evaluate("Object.assign(window.__navigationGate,{stage:'point',hit:false,released:false,resume:null})");
    const target=await evaluate("(()=>{const r=[...document.querySelectorAll('.mapLabel')].find(e=>e.textContent.includes('Москва')).getBoundingClientRect();return {x:r.x+3,y:r.y+3};})()");
    await call('Input.dispatchMouseEvent',{type:'mousePressed',...target,button:'left',clickCount:1});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',...target,button:'left',clickCount:1});
    await wait('window.__navigationGate.hit','held point response');
    await click('#settings');await select('#run',true,1);await click('#closeDrawer');
    await wait('window.captureWeatherEvidence().ready','different run while point pending');
    await evaluate('window.__navigationGate.resume()');
    await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
    state=await capture();assert.equal(state.point,undefined);assert.equal(state.position,undefined);assert.equal(state.selected.fixture,'actual');
    results.push({stage:'point',different_run_after_release:true,history:await evaluate('window.__navigationGate.history.splice(0)')});
    report.navigation={fixture:'Labelled synthetic overlap + real ICON-EU +1/+3 h; missing +2 h; real gateway responses',
        prototype:'docs/prototypes/forecast-interaction.prototype.html: newest/first, run reset, pinned revision, gap clears layer/value, stale point rejection',races:results};
    report.checks.push('T14 real tile fetch/decode/GPU upload and canonical point races reject obsolete completions');
}
