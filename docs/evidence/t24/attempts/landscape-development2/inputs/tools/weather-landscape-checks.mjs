// Regression for wide, short phones; actual visible controls, no app hooks.
export async function checkLandscape({call,evaluate,check,click,key,select,screenshot,report,url}) {
  for(const [width,height] of [[1038,465],[844,390],[740,360]]){
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
  }
}
