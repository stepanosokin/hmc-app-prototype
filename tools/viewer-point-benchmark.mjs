import assert from 'node:assert/strict';
import {nativePointPixel} from './viewer-fields.mjs';

export async function measurePointSeries({call,evaluate,wait,click,select,capture,report,variant,wind,model}){
    assert.ok(['before','after'].includes(variant));
    if(model&&(await capture()).selected.model!==model){
        await click('#settings');
        const index=await evaluate(`[...document.querySelector('#model').options].findIndex(option=>option.value===${JSON.stringify(model)})`);
        assert.ok(index>=0,'Benchmark model is published: '+model);
        await select('#model',true,index);
        await wait(`window.captureWeatherEvidence().ready&&window.captureWeatherEvidence().selected.model===${JSON.stringify(model)}`,'benchmark model ready');
        if(await evaluate("!document.getElementById('drawer').hidden"))await click('#closeDrawer');
        await click('#fit');
    }
    if((await capture()).wind_overlay.enabled!==wind)await click('#windToggle');
    if(wind)await wait("window.captureWeatherEvidence().wind_overlay.state==='ready'",'published U/V ready');
    report.point_benchmark={variant,wind,conditions:'First click after map readiness; warm click repeats the same position in the same browser and service processes.',rounds:[]};
    const pick=async pixel=>{
        await call('Input.dispatchMouseEvent',{type:'mousePressed',...pixel,button:'left',clickCount:1});
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',...pixel,button:'left',clickCount:1});
    };
    for(const cache of ['first','warm']){
        const pixel=await nativePointPixel(evaluate);
        assert.ok(pixel,'Unobstructed pixel in the published native grid');
        const start=report.requests.length;
        await evaluate(`(()=>{
            window.__pointBenchmark=null;
            document.addEventListener('click',()=>{
                const start=performance.now(),result=window.__pointBenchmark={};
                const observe=()=>{
                    const state=window.captureWeatherEvidence(),{series,point,wind_overlay:overlay}=state;
                    const graph=document.querySelector('#pointContent .realPointChart svg');
                    const visible=document.querySelector('#pointContent .pointValue')?.checkVisibility();
                    const elapsed=performance.now()-start;
                    if(visible&&typeof point?.value==='number'&&result.first_value_ms===undefined)result.first_value_ms=elapsed;
                    const scalar=series.entries.filter(entry=>entry.state==='value').length;
                    const samples=overlay.point_entries;
                    const scalarTimes=new Set(series.entries.map(entry=>entry.time));
                    const windValues=samples.filter(entry=>entry.state==='value'&&scalarTimes.has(entry.time)).length;
                    const symbols=graph?.querySelectorAll('g:has(>title),circle[stroke="currentColor"]').length;
                    const windReady=!${wind}||samples.length>0&&samples.every(entry=>entry.state!=='loading')&&symbols===windValues;
                    if(visible&&result.first_value_ms!==undefined&&series.entries.length&&!series.busy&&windReady&&graph?.checkVisibility()&&
                        graph.querySelectorAll('.seriesValue,.selectedValue').length===scalar){
                        Object.assign(result,{complete_ms:elapsed,scalar_times:series.entries.length,scalar_values:scalar,
                            wind_times:samples.length,wind_values:windValues,wind_symbols:symbols,
                            scalar_errors:series.entries.filter(entry=>entry.state==='error').length,
                            wind_errors:samples.filter(entry=>entry.state==='error').length,point:state.position,selection:state.selected});
                    }else if(elapsed<60000)requestAnimationFrame(observe);
                };
                requestAnimationFrame(observe);
            },{capture:true,once:true});
        })()`);
        await pick(pixel);
        await wait('window.__pointBenchmark?.complete_ms','visible forecast graph and wind panel');
        const result=await evaluate('window.__pointBenchmark');
        const requests=report.requests.slice(start).filter(({url})=>/\/api\/v1\/point(?:-series)?\?/.test(url));
        const requestIds=new Set(requests.map(item=>item.request_id));
        report.point_benchmark.rounds.push({cache,...result,requests:requests.length,
            responses:report.responses.filter(item=>requestIds.has(item.request_id)).map(item=>item.status)});
        assert.equal(result.scalar_errors+result.wind_errors,0,'All published samples settled successfully');
        assert.ok(result.scalar_values>0&&(!wind||result.wind_values>0),'Both requested panels have visible values');
        if(variant==='after'){
            assert.equal(requests.length,1,'One point-series request per click');
            const query=new URL(requests[0].url);
            assert.equal(query.pathname,'/api/v1/point-series');
            assert.equal(query.searchParams.has('wind_u'),wind);
            assert.equal(query.searchParams.has('wind_v'),wind);
        }
        await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});
        await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape'});
        await wait('!window.captureWeatherEvidence().position','previous point cleared');
    }
    if(variant==='after'&&wind){
        const originalField=(await capture()).selected.field;
        const other=await evaluate("document.querySelector('#fieldButtons button[aria-pressed=false]')?.id");
        assert.ok(other,'Published alternate field for selection race');
        const pixel=await nativePointPixel(evaluate);
        assert.ok(pixel,'Unobstructed pixel before the selection race');
        await evaluate(`(()=>{
            const fetchOriginal=window.fetch;
            window.__pointGroupRace={};
            window.fetch=async (input,options)=>{
                const first=String(input).includes('/point-series?')&&!window.__pointGroupRace.started;
                if(!first)return fetchOriginal(input,options);
                window.__pointGroupRace.started=true;
                const response=await fetchOriginal(input,{...options,signal:undefined});
                await new Promise(resolve=>window.__pointGroupRace.release=resolve);
                window.__pointGroupRace.released=true;
                return response;
            };
        })()`);
        await pick(pixel);
        await wait('window.__pointGroupRace.release','old field response held');
        const before=await capture();
        await click('#'+other);
        await click('#fieldMenu .fieldOption[aria-pressed=false]');
        await wait(`(()=>{const s=window.captureWeatherEvidence();return s.ready&&!s.series.busy&&
            s.point?.field===s.selected.field&&s.selected.field!==${JSON.stringify(originalField)};})()`,'replacement forecast series');
        const current=await capture();
        assert.deepEqual(current.position,before.position,'Field picker preserves the marked position');
        await evaluate('window.__pointGroupRace.release()');
        await wait('window.__pointGroupRace.released','old field response released');
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const final=await capture();
        assert.equal(final.series.key,current.series.key);
        assert.deepEqual(final.point,current.point);
        report.point_benchmark.late_group_response_rejected=true;
    }
    report.checks.push('Point series performance: first visible value, full chart and wind panel, actual HTTP requests');
}
