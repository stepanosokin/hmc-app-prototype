// Regression for wide, short phones; actual visible controls, no app hooks.
export async function checkLandscape({call,evaluate,check,click,key,select,screenshot,viewports=[[1038,465],[844,390],[740,360],[667,375],[640,360]],report,url}) {
  const clearLayout="(()=>{const selectors=['.brand','#forecastPanel','.layers','#navigationPanel','#legendPanel','#timelinePanel','.notice','.fontPicker','.basemapAttribution','#drawer','#showPoint'];const rects=selectors.map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {s,r,visible:e.checkVisibility()&&r.width>0&&r.height>0};}).filter(x=>x.visible);return rects.every(({r})=>r.left>=0&&r.top>=0&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5)&&rects.every((a,i)=>rects.slice(i+1).every(b=>a.r.right<=b.r.left+.5||a.r.left>=b.r.right-.5||a.r.bottom<=b.r.top+.5||a.r.top>=b.r.bottom-.5));})()";
  for(const [width,height] of viewports){
    const name=`landscape-${width}x${height}`;
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true,screenOrientation:{type:'landscapePrimary',angle:90}});
    await call('Emulation.setTouchEmulationEnabled',{enabled:true});
    await call('Page.navigate',{url});
    await evaluate("new Promise(r=>document.readyState==='complete'?r():addEventListener('load',r,{once:true}))");
    await evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    report.landscape_repro??=[];
    report.landscape_repro.push(await evaluate("({viewport:[innerWidth,innerHeight],selection:document.querySelector('.selection').getBoundingClientRect().toJSON(),navigation:document.querySelector('.navigation').getBoundingClientRect().toJSON()})"));
    await check(name+' forecast and navigation do not overlap',"(()=>{const e=document.querySelector('.selection'),a=e.getBoundingClientRect(),b=document.querySelector('.navigation').getBoundingClientRect();return !e.checkVisibility()||!a.width||!a.height||a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom;})()");
    await check(name+' controls start collapsed',"['forecastPanel','navigationPanel','legendPanel','timelinePanel'].every(id=>!document.getElementById(id).open)");
    await screenshot(name+'-initial');
    await check(name+' collapsed panels are inside viewport without intersections',clearLayout);
    for(const id of ['forecastPanel','navigationPanel','legendPanel','timelinePanel']){
      await click('#'+id+'>summary',true);
      await check(name+' '+id+' is the only expanded group',`document.getElementById('${id}').open&&['forecastPanel','navigationPanel','legendPanel','timelinePanel'].filter(v=>v!=='${id}').every(v=>!document.getElementById(v).open)`);
      await check(name+' '+id+' expanded panels do not overlap',clearLayout);
      await screenshot(name+'-'+id);
    }
    await click('#timelinePanel>summary',true);
    for(const [index,mode] of [[0,'mercator'],[1,'orthographic'],[2,'laea']]){
      await select('#projection',index);
      for(const font of [0,1])for(const basemap of [0,1]){
        await select('#font',font);await select('#basemap',basemap);
        await check(name+' '+mode+' expanded controls '+font+basemap,clearLayout);
        await screenshot(name+'-'+mode+'-controls-'+font+basemap);
        await click('#forecastPanel>summary',true);
        await check(name+' '+mode+' collapsed controls '+font+basemap,clearLayout);
        await screenshot(name+'-'+mode+'-'+font+basemap);
        if(font!==1||basemap!==1)await click('#forecastPanel>summary',true);
      }
    }
    await select('#font',0);await select('#basemap',0);
    await click('#map',true);
    await check(name+' point drawer does not cover other widgets',clearLayout);
    await screenshot(name+'-point');
    const before=await evaluate("document.getElementById('apiLink').href");
    for(const id of ['forecastPanel','navigationPanel','legendPanel','timelinePanel']){
      await click('#'+id+'>summary',true);
      await check(name+' '+id+' replaces point drawer without losing selection',`document.getElementById('drawer').hidden&&document.getElementById('apiLink').href===${JSON.stringify(before)}`);
      await check(name+' '+id+' after point has clear layout',clearLayout);
      await click('#'+id+'>summary',true);await click('#showPoint',true);
    }
    await call('Emulation.setDeviceMetricsOverride',{width:height,height:width,deviceScaleFactor:1,mobile:true,screenOrientation:{type:'portraitPrimary',angle:0}});
    await evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    await check(name+' rotating to portrait retains forecast and point',`document.getElementById('apiLink').href===${JSON.stringify(before)}`);
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true,screenOrientation:{type:'landscapePrimary',angle:90}});
    await evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    await check(name+' rotating back retains point with clear layout',`document.getElementById('apiLink').href===${JSON.stringify(before)}&&(${clearLayout})`);
    await screenshot(name+'-rotated-back');
  }
}
