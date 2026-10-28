import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkFieldNoData({call,evaluate,wait,click,select,origin,report,directory,width,height}){
    const selections=(await(await fetch(origin+'/api/v1/catalogue')).json()).selections;
    const cases=[];
    for(const selection of selections){
        const response=await fetch(origin+selection.native_display);
        assert.equal(response.status,200,'Native metadata must be available before selecting browser fixtures');
        const metadata=await response.json();
        if(metadata.all_nodata&&!cases.some(item=>item.kind==='empty'))cases.push({kind:'empty',selection,metadata});
        else if(metadata.zero_transparent&&metadata.all_transparent&&!metadata.all_nodata&&!cases.some(item=>item.kind==='zero'))cases.push({kind:'zero',selection,metadata});
        else if(metadata.display_range?.[0]===280&&!cases.some(item=>item.kind==='mixed'))cases.push({kind:'mixed',selection,metadata});
        else if(metadata.units==='Pa'&&metadata.display_range?.[0]===100000&&!cases.some(item=>item.kind==='pressure'))cases.push({kind:'pressure',selection,metadata});
        else if(metadata.units==='kg kg**-1'){
            const kind=selection.field_short_name==='2sh'?'humidity-2m':'humidity-surface';
            if(!cases.some(item=>item.kind===kind))cases.push({kind,selection,metadata});
        }
    }
    assert.equal(cases.length,6,'Real empty, valid-zero, pressure, temperature and two specific-humidity fixtures exist');
    report.nodata??=[];
    for(const fixture of cases){
        // Restrict discovery to one real field; every metadata/block/point is served unchanged.
        const {selection}=fixture;
        const script=await call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
            const original=fetch;
            window.fetch=async(input,options)=>{
                const response=await original(input,options);
                if(String(input).includes('/api/v1/catalogue?view=compact')){
                    const body=await response.json();
                    body.revisions=body.revisions.filter(root=>root.revision===${JSON.stringify(selection.revision)});
                    for(const root of body.revisions)root.batches=root.batches.filter(index=>body.templates[body.batches[index].template].field===${JSON.stringify(selection.field)});
                    return Response.json(body);
                }
                return response;
            };})()`});
        try{
            await call('Page.navigate',{url:origin+'/?validation=1'});
            await wait('window.captureWeatherEvidence?.().ready','real NoData field loads');
            const state=await evaluate('window.captureWeatherEvidence(true,true)');
            assert.equal(state.selected.valid_time,selection.valid_time);
            const ramp=await evaluate("getComputedStyle(document.querySelector('.ramp')).display");
            assert.equal(ramp==='none',['empty','zero'].includes(fixture.kind));
            if(fixture.kind==='empty')assert.ok(await evaluate("document.getElementById('legendSummary').textContent.includes('Нет данных')"));
            if(fixture.kind==='zero'){
                const valid=state.view.samples.filter(sample=>sample[3]===1);
                assert.ok(valid.length>0,'GPU numerical readback retains valid zero');
                assert.ok(valid.every(sample=>sample[2]===0));
            }
            if(['empty','zero'].includes(fixture.kind))assert.ok(state.color_view.samples.every(sample=>sample[5]===0),'Thematic alpha is exactly zero');
            else assert.ok(state.color_view.samples.some(sample=>sample[5]>.7),'Nonempty corrected field is visible');
            const legend=await evaluate("Array.from(document.querySelectorAll('.ticks span'),node=>node.textContent)");
            if(fixture.kind.startsWith('humidity-')){
                const [low,high]=fixture.metadata.display_range;
                const format=new Intl.NumberFormat('ru-RU',{maximumSignificantDigits:3,useGrouping:false});
                assert.deepEqual(legend,Array.from({length:4},(_,i)=>format.format(low+(high-low)*i/3)));
                assert.ok(await evaluate("document.querySelector('.unit').textContent.includes('кг/кг')"));
                assert.ok(state.view.samples.some(sample=>sample[3]===0),'Humidity rejected cells remain invalid on GPU');
            }
            const shot=await call('Page.captureScreenshot',{format:'png'});
            await writeFile(join(directory,`nodata-${fixture.kind}-${width}x${height}.png`),Buffer.from(shot.data,'base64'));
            report.nodata.push({kind:fixture.kind,width,height,selection,metadata:fixture.metadata,ramp,legend,state});
        }finally{await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:script.identifier});}
    }
    report.checks.push(`${width}x${height}: six field cases, NoData, valid-zero transparency and specific-humidity legend`);
}
