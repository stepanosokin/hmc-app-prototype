/** Explicit synthetic supplements for unavailable real level/race combinations. */
export async function checkWindFixtures(evaluate,origin){
    return evaluate(`(async()=>{
        const frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-10000px;width:320px;height:300px';document.body.append(frame);
        try{return await frame.contentWindow.eval('('+${JSON.stringify(String(windFixtures))}+')('+JSON.stringify(${JSON.stringify(origin)})+')');}
        finally{frame.remove();}
    })()`);
}

async function windFixtures(origin){
    document.body.innerHTML='<button id="windToggle"></button><select id="windLevel"></select><small id="windStatus"></small><button id="windRetry"></button>';
    const {WindOverlay}=await import(origin+'/build/wind-overlay.js');
    const {windVariant}=await import(origin+'/build/wind-values.js');
    const {PointChart}=await import(origin+'/build/point-chart.js');
    const checks=[],requests=[];
    const expect=(name,ok)=>{if(!ok)throw Error(name);checks.push(name);};
    const chart=new PointChart(()=>{});document.body.append(chart.element);
    const times=Array.from({length:8},(_,i)=>new Date(Date.UTC(2026,9,28,i)).toISOString());
    chart.setWind(new Map(times.map((time,i)=>[time,{time,state:'value',speed:i<4?90:200,direction:[0,90,180,270][i%4]}])),true,'synthetic','');
    chart.update({key:'strong-wind',entries:times.map(time=>({time,state:'value',result:{value:1,units:'Pa'}}))},0,String);
    const svg=chart.element.querySelector('svg'),symbols=[...svg.querySelectorAll('g[transform^="translate"]')];
    expect('Strong-wind barbs retain all marks inside the wind band at four directions',symbols.length===8&&symbols.every(g=>{
        const box=g.getBBox(),matrix=g.getCTM(),inverse=svg.getCTM().inverse();
        return [box.x,box.x+box.width].every(x=>[box.y,box.y+box.height].every(y=>{
            const p=new DOMPoint(x,y).matrixTransform(matrix).matrixTransform(inverse);
            return p.x>=.6&&p.x<=264-.6&&p.y>=.6&&p.y<=49.4;
        }));
    }));chart.element.remove();
    const css=document.createElement('link');css.rel='stylesheet';css.href=origin+'/style.css';
    await new Promise((resolve,reject)=>{css.onload=resolve;css.onerror=reject;document.head.append(css);});
    let chosen=-1;
    const responsive=new PointChart(index=>{chosen=index;});document.body.append(responsive.element);
    for(const count of [9,25])for(const width of [240,264,320])for(const enabled of [true,false]){
        responsive.element.style.width=width+'px';
        const entries=Array.from({length:count},(_,i)=>({time:new Date(Date.UTC(2026,9,28,i)).toISOString(),state:'value',result:{value:i,units:'Pa'}}));
        responsive.setWind(new Map(entries.map(e=>[e.time,{time:e.time,state:'value',speed:12,direction:270}])),enabled,'synthetic','');
        responsive.update({key:'responsive-'+count,entries},0,String);
        const plot=responsive.element.querySelector('.pointPlot');
        expect('No horizontal chart overflow: '+count+' times, '+width+'px, wind '+enabled,plot.clientWidth>0&&plot.scrollWidth<=plot.clientWidth);
        expect('Entire forecast remains rendered: '+count+' times, '+width+'px, wind '+enabled,responsive.element.querySelectorAll('.seriesValue,.selectedValue').length===count);
        expect('Every wind symbol remains rendered: '+count+' times, '+width+'px, wind '+enabled,responsive.element.querySelectorAll('g[transform^="translate"]').length===(enabled?count:0));
        const range=responsive.element.querySelector('input');range.value=String(count-1);range.dispatchEvent(new Event('input'));
        range.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));
        expect('Last time remains selectable by keyboard: '+count+' times, '+width+'px, wind '+enabled,chosen===count-1);
        const graph=responsive.element.querySelector('svg'),rect=graph.getBoundingClientRect();
        graph.dispatchEvent(new MouseEvent('click',{clientX:rect.right-rect.width*12/264,clientY:rect.top+rect.height/2}));
        expect('Last time remains selectable on fitted chart: '+count+' times, '+width+'px, wind '+enabled,chosen===count-1);
    }
    responsive.element.remove();css.remove();
    const reference=await(await fetch(origin+'/wind-reference.json')).json();
    const {earthComponents,screenVelocity}=await import(origin+'/build/wind.js');
    const {nativePosition}=await import(origin+'/build/source-crs.js');
    const definitions={mercator:'EPSG:3857',orthographic:'+proj=ortho +lat_0=60 +lon_0=90 +R=6378137',laea:'EPSG:3576','laea-rf':'hmc:laea-rf'};
    const projectionCounts={mercator:0,orthographic:0,laea:0,'laea-rf':0};let maximumError=0;
    for(const [index,item] of reference.cases.entries()){
        const spec=reference.specs[item.spec],p=nativePosition(spec,item.xy,true);
        const vector=earthComponents(item.u,item.v,{source_crs:spec,uv_relative_to_grid:item.grid_relative},item.xy,p,q=>nativePosition(spec,q,true));
        for(const [mode,expected] of Object.entries(item.expected.screens)){
            if(!expected.visible)continue;
            const actual=screenVelocity(p,vector,parent.proj4('EPSG:4326',definitions[mode]));
            if(!expected.direction){if(actual)throw Error('Unexpected calm screen vector '+index+' '+mode);continue;}
            if(!actual)throw Error('Missing screen vector '+index+' '+mode);
            const length=Math.hypot(actual.dx,actual.dy),error=Math.hypot(actual.dx/length-expected.direction[0],actual.dy/length-expected.direction[1]);
            if(error>.0002)throw Error('Independent projection direction '+index+' '+mode+': '+error);
            maximumError=Math.max(maximumError,error);projectionCounts[mode]++;
        }
    }
    expect('Grid/earth-relative vectors agree with independent PROJ in all four projections',Object.values(projectionCounts).every(n=>n>0));
    const base={model:'synthetic',run:'synthetic/2026-10-28T00:00:00Z',revision:'revision',member:null};
    const time='2026-10-28T00:00:00.000Z';
    const selections=new Map();
    function group(level,type='heightAboveGround'){
        const component=axis=>{const selection='fixture-'+level+'-'+axis;return {...base,selection,units:'m s**-1',state:'published',
            field:'GRIB2:'+(axis==='u'?'a':'b').repeat(64),level,field_profile:'grib2-fields/1',field_level_type:type,
            native_grid_sha256:'fixture-grid',valid_time:time,display_blocks:1,wind_axis:axis,
            uv_relative_to_grid:false,native_display:'/api/v1/fixture/'+selection+'/native.json'};};
        const u=component('u'),v=component('v');u.wind_v=v;selections.set(u.selection,u);selections.set(v.selection,v);
        return {selection:u,key:'group-'+level,start:Date.parse(time),times:[u]};
    }
    const ten=group(10),high=group(850,'isobaricInhPa'),hundred=group(100);
    let delay=false,fail=false,throwFetch=false,pointMode='value';
    window.fetch=async(input,options={})=>{
        requests.push(String(input));if(delay)await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,100);options.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});});
        options.signal?.throwIfAborted();
        if(throwFetch)throw new TypeError('Failed to fetch');
        if(fail)return new Response('unavailable',{status:503});
        const query=new URL(String(input),origin);
        if(query.pathname==='/api/v1/point'){
            const s=selections.get(query.searchParams.get('selection'));
            if(pointMode==='expire-next'&&s.selection.endsWith('-next'))return new Response('expired',{status:410});
            if(pointMode==='error'&&s.wind_axis==='v')return new Response('unavailable',{status:503});
            const reason=['outside_coverage','native_nodata'].includes(pointMode)?pointMode:null;
            const identity=Object.fromEntries(['model','run','revision','field','level','valid_time','native_grid_sha256','member'].map(k=>[k,s[k]]));
            const geo=nativePosition(reference.specs[0],[.5,.5],true);
            return new Response(JSON.stringify({selection:s.selection,run:s.run,revision:s.revision,valid_time:s.valid_time,field:s.field,units:s.units,
                value:reason?null:pointMode==='calm'?0:s.wind_axis==='u'?3:4,reason,identity,spatial_selection:'nearest-native-cell',temporal_selection:'exact',source:{synthetic_fixture:true},
                cell:reason?null:{row:pointMode==='mismatch'&&s.wind_axis==='v'?1:0,column:0,lon:geo[0],lat:geo[1]}}));
        }
        if(String(input).endsWith('native.json')){
            const s=selections.get(String(input).split('/').at(-2));
            const identity=Object.fromEntries(['model','run','revision','field','level','valid_time','native_grid_sha256','member'].map(k=>[k,s[k]]));
            return new Response(JSON.stringify({contract:'hmc-native-display/3',contract_sha256:'98c9e10367d9c4185647e22758c94913d8cc9d716561ff0b93f3b1dcd71db0eb',
                selection:s.selection,identity,grid:{shape_yx:[2,2],spacing_degrees_xy:[1,1],outer_cell_edges_wsen:[0,0,2,2]},
                columns:[0,0],rows:[0,0],source_crs:reference.specs[0],encoding:'f32',units:s.units,stored_size:[258,258],display_range:[-10,10],
                uv_relative_to_grid:false,url:'/api/v1/fixture/'+s.selection+'/{column}-{row}.f32'}));
        }
        const bytes=new ArrayBuffer(332820);new Float32Array(bytes,0,258*258).fill(1);new Uint8Array(bytes,258*258*4).fill(1);return new Response(bytes);
    };
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    const settled=async wind=>{for(let i=0;i<100&&wind.state==='loading';i++)await pause(10);};
    const make=(admit=()=>{})=>new WindOverlay(()=>{},admit);
    let wind=make();wind.update([high,ten],base,Date.parse(time));await settled(wind);
    expect('Initial 10 m preferred over other available levels',wind.level===windVariant(ten.selection)&&wind.state==='ready'&&wind.enabled);
    wind.update([high,ten],base,Date.parse(time),false);
    expect('Pending scalar keeps enabled level with an explicit waiting state',wind.enabled&&wind.level===windVariant(ten.selection)&&wind.state==='missing'&&wind.status.includes('ожидает'));
    wind.update([high,ten],base,Date.parse(time));await settled(wind);
    document.getElementById('windLevel').value=windVariant(high.selection);document.getElementById('windLevel').dispatchEvent(new Event('change'));
    await settled(wind);expect('Explicit level selection is independent',wind.level===windVariant(high.selection)&&wind.state==='ready');
    wind.update([ten],base,Date.parse(time));
    expect('Unavailable selected level retained without fallback',wind.level===windVariant(high.selection)&&wind.enabled&&wind.state==='missing'&&document.getElementById('windStatus').textContent.includes('недоступен'));
    wind.dispose();wind=make();wind.update([high],base,Date.parse(time));await settled(wind);
    expect('Sole non-10m level selected initially',wind.level===windVariant(high.selection)&&wind.state==='ready');
    wind.dispose();wind=make();wind.update([high,hundred],base,Date.parse(time));
    expect('Several non-default levels require a choice',wind.enabled&&wind.level===undefined&&wind.status.includes('Выберите'));
    wind.dispose();wind=make();const count=requests.length;wind.update([ten],base,Date.parse(time)+3600000);
    expect('Missing exact time never requests nearest time',wind.state==='missing'&&requests.length===count);
    wind.dispose();wind=make();delay=true;wind.update([ten],base,Date.parse(time));document.getElementById('windToggle').click();await pause(150);
    expect('Disabling aborts and retires a pending U/V pair',!wind.enabled&&wind.state==='missing'&&!wind.evidence().arrows&&wind.bytes()===0);
    delay=false;wind.dispose();wind=make();delay=true;wind.update([ten],base,Date.parse(time));wind.update([high],base,Date.parse(time));await pause(150);
    expect('Superseded completion cannot restore an unavailable level',wind.state==='missing'&&wind.level===windVariant(ten.selection)&&wind.evidence().selection==='');
    delay=false;wind.dispose();wind=make(()=>{throw Error('budget rejected');});const budgetCount=requests.length;wind.update([ten],base,Date.parse(time));await settled(wind);
    expect('Budget rejects before allocation or fetch',wind.state==='error'&&requests.length===budgetCount&&wind.bytes()===0);
    wind.dispose();wind=make();fail=true;wind.update([ten],base,Date.parse(time));await settled(wind);expect('Network failure is explicit',wind.state==='error');
    fail=false;document.getElementById('windRetry').click();await settled(wind);expect('Explicit retry recovers',wind.state==='ready');wind.dispose();
    wind=make();throwFetch=true;wind.update([ten],base,Date.parse(time));await settled(wind);
    expect('Native fetch errors are localized in Russian',wind.state==='error'&&!/[A-Za-z]/.test(wind.status)&&wind.status.includes('Повторите'));
    throwFetch=false;wind.dispose();
    const pointsSettled=async wind=>{for(let i=0;i<100&&[...wind.entries.values()].some(e=>e.state==='loading');i++)await pause(10);};
    for(const mode of ['value','calm','outside_coverage','native_nodata','error','mismatch']){
        pointMode=mode;wind=make();wind.update([ten],base,Date.parse(time));await settled(wind);wind.points({lng:1,lat:1});await pointsSettled(wind);
        const entry=[...wind.entries.values()][0];
        if(mode==='value')expect('Popup computes physical speed from both canonical components',entry.state==='value'&&entry.speed===5&&entry.direction!==null);
        else if(mode==='calm')expect('Popup calm has speed zero and no direction',entry.state==='value'&&entry.speed===0&&entry.direction===null);
        else expect('Popup '+mode+' is an explicit gap',entry.state===(mode==='mismatch'?'error':mode)&&entry.speed===undefined);
        wind.dispose();
    }
    const nextTime=new Date(Date.parse(time)+3600000).toISOString();
    const nextV={...ten.selection.wind_v,selection:ten.selection.wind_v.selection+'-next',valid_time:nextTime};
    const nextU={...ten.selection,selection:ten.selection.selection+'-next',valid_time:nextTime,wind_v:nextV};
    selections.set(nextU.selection,nextU);selections.set(nextV.selection,nextV);
    pointMode='expire-next';wind=make();wind.update([{...ten,key:'expiry-series',times:[ten.selection,nextU]}],base,Date.parse(time));await settled(wind);
    wind.points({lng:1,lat:1});await pointsSettled(wind);
    expect('Expiry removes already loaded wind values and retires the map frame',wind.state==='error'&&wind.status.includes('истекла')&&[...wind.entries.values()].every(e=>e.state==='error'&&e.speed===undefined)&&wind.bytes()===0);
    wind.dispose();
    return {scope:'Synthetic levels/races/failures and independent projected U/V references; not real forecast values',checks,requests:requests.length,projectionCounts,maximumError};
}
