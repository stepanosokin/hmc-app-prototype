// Acceptance at the existing visible-control seam, with actual mouse/touch input.
import assert from 'node:assert/strict';

export async function checkProjections({call,evaluate,check,click,key,select,screenshot,report,url}) {
  const snapshot=()=>evaluate("JSON.stringify({identity:document.getElementById('selectionIdentity').textContent,time:document.getElementById('time').value,units:document.getElementById('units').value,point:document.querySelector('#pointContent strong')?.textContent,coords:document.querySelector('#pointContent p:not(.pointVisibility)')?.textContent,api:document.getElementById('apiLink').href,wms:document.getElementById('wmsLink').href})");
  async function inputPoint(lon,lat,touch){
    const p=await evaluate(`(()=>{const p=project(${lon},${lat});return {x:p[0],y:p[1]};})()`);
    await evaluate("document.getElementById('map').addEventListener('click',e=>window.lastProbeClick={x:e.clientX,y:e.clientY},{once:true})");
    assert.ok(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id==='map'`),'Point is not covered by controls');
    if(touch){await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    else{await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});}
    const observed=await evaluate("({screen:window.lastProbeClick,api:document.getElementById('apiLink').href,viewport:[innerWidth,innerHeight]})");
    report.point_inputs??=[];report.point_inputs.push({requested:p,observed});
    const selected=new URL(observed.api);
    assert.ok(Math.abs(Number(selected.searchParams.get('lon'))-lon)<=.5&&Math.abs(Number(selected.searchParams.get('lat'))-lat)<=.5,'Geographic input within half degree (integer DOM coordinates on small viewport)');
  }
  for(const [width,height,mobile] of [[1440,900,false],[390,844,true],[360,740,true]]) {
    const name=`projection-${width}x${height}`;
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
    await call('Emulation.setTouchEmulationEnabled',{enabled:mobile});
    await call('Page.navigate',{url});await evaluate("new Promise(r=>document.readyState==='complete'?r():addEventListener('load',r,{once:true}))");
    await check(name+' initial Mercator',"document.getElementById('projection').value==='mercator'");
    if(!mobile){
      await call('Input.dispatchMouseEvent',{type:'mousePressed',x:1300,y:40,button:'left',clickCount:1});
      await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:1300,y:40,button:'left',clickCount:1});
      report.point_collision=await evaluate("({point:document.getElementById('pointCard').getBoundingClientRect().toJSON(),control:document.querySelector('.projectionControl').getBoundingClientRect().toJSON()})");
      await check('projection control does not cover a point near top right',"(()=>{const a=document.getElementById('pointCard').getBoundingClientRect(),b=document.querySelector('.projectionControl').getBoundingClientRect();return a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom;})()");
      await click('#closePoint');
    }
    await inputPoint(12.5,41.9,mobile);
    await check(name+' geographic point input',"!document.getElementById('pointMarker').hidden");
    const pinned=await snapshot();
    for(const [index,mode] of [[1,'orthographic'],[2,'laea'],[0,'mercator']]) {
      await select('#projection',index);
      assert.equal(await snapshot(),pinned,name+' projection keeps forecast units and geographic point');
      report.checks.push(name+' '+mode+' keeps pinned selection and UTC API');
      await check(name+' '+mode+' selector has free hit area',"(()=>{const e=document.getElementById('projection'),r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e&&r.height>=30;})()");
      if(mode==='laea'){
        await check(name+' southern point retained with hidden marker and reason',"document.getElementById('pointMarker').hidden&&document.querySelector('#pointContent .pointVisibility').textContent.includes('южнее 45°')&&document.getElementById('projectionStatus').textContent.includes('45°')");
        await screenshot(name+'-southern-point');
      }else await check(name+' '+mode+' marker restored',"!document.getElementById('pointMarker').hidden");
    }
    await click(mobile?'#closeDrawer':'#closePoint',mobile);
    for(const [index,mode] of [[0,'mercator'],[1,'orthographic'],[2,'laea']]) {
      await select('#projection',index);await click('#fit',mobile);
      report.geometry??=[];
      report.geometry.push(await evaluate(`(()=>{const g=view.geometry?.projection,R=6378137,scale=g?g.scale()/R:view.scale*180/Math.PI/R;return {mode:${JSON.stringify(mode)},viewport:[innerWidth,innerHeight],center:[...state.center],scale,origin:g?g.translate():[view.x-view.lon*view.scale,view.y+view.lat*view.scale*180/Math.PI],controls:[[37.62,55.75],[20,55],[0,45],[90,90],[179,65],[-179,65],[30,44.9]].map(geo=>({geo,pixel:project(...geo),visible:!view.geometry||view.geometry.visible(geo),roundtrip:unproject(...project(...geo))}))};})()`));
      for(const font of [0,1])for(const basemap of [0,1]){
        await select('#font',font);await select('#basemap',basemap);
        await check(name+' '+mode+' layout '+font+basemap,"(()=>{const a=document.querySelector('.projectionControl').getBoundingClientRect(),b=document.querySelector('.selection').getBoundingClientRect(),t=document.querySelector('.timeline').getBoundingClientRect(),l=document.querySelector('.legend').getBoundingClientRect();return a.left>=b.right&&a.bottom<l.top&&l.bottom<=t.top&&document.documentElement.scrollWidth===innerWidth;})()");
        await screenshot(name+'-'+mode+'-'+(font?'courier':'system')+'-'+(basemap?'light':'dark'));
      }
      await select('#font',0);await select('#basemap',0);
      await inputPoint(20,55,mobile);
      await check(name+' '+mode+' inverse click matches geography',"!document.getElementById('pointMarker').hidden");
      await screenshot(name+'-'+mode+'-point');
      await click(mobile?'#closeDrawer':'#closePoint',mobile);
    }
    await select('#projection',1);await click('#fit',mobile);
    const location=await evaluate("(()=>{const p=project(19.5,53);return {x:p[0],y:p[1]};})()");
    const before=await evaluate("document.getElementById('map').toDataURL()");
    if(mobile)await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[location]});
    else await call('Input.dispatchMouseEvent',{type:'mousePressed',...location,button:'left',clickCount:1});
    for(let i=1;i<=4;i++){
      const p={x:location.x+8*i,y:location.y-3*i};
      await call(mobile?'Input.dispatchTouchEvent':'Input.dispatchMouseEvent',mobile?{type:'touchMove',touchPoints:[p]}:{type:'mouseMoved',...p,button:'left',buttons:1});
    }
    await check(name+' globe redraws while pointer held',`document.getElementById('map').toDataURL()!==${JSON.stringify(before)}`);
    await call(mobile?'Input.dispatchTouchEvent':'Input.dispatchMouseEvent',mobile?{type:'touchEnd',touchPoints:[]}:{type:'mouseReleased',x:location.x+32,y:location.y-12,button:'left',clickCount:1});
    await check(name+' drag does not select point',"document.getElementById('pointCard').hidden");
    await click('#zoomIn',mobile);await screenshot(name+'-rotated-zoomed');
    // Rotate a previously selected point behind the limb using visible controls.
    await click('#fit',mobile);await inputPoint(20,32,mobile);const keep=await snapshot();
    if(mobile){await click('#settings',true);await click('#settings',true);}
    for(let i=0;i<18;i++)await click('#east',mobile);
    await check(name+' horizon hides marker with explanation',"document.getElementById('pointMarker').hidden&&document.querySelector('#pointContent .pointVisibility').textContent.includes('за горизонтом')");
    assert.equal(await snapshot(),keep,name+' point remains selected behind horizon');
    await screenshot(name+'-horizon');await click('#fit',mobile);
    await check(name+' fitting restores marker',"!document.getElementById('pointMarker').hidden");
    await click(mobile?'#closeDrawer':'#closePoint',mobile);
    await select('#projection',2);
    await call('Page.reload');await evaluate("new Promise(r=>document.readyState==='complete'?r():addEventListener('load',r,{once:true}))");
    await check(name+' reopening resets projection and first forecast',"document.getElementById('projection').value==='mercator'&&document.getElementById('time').value==='1'&&document.getElementById('pointCard').hidden");
  }
  // A missing local CRS dependency is a real capability failure, not an internal hook.
  await call('Network.setBlockedURLs',{urls:['*proj4.js']});await call('Page.reload');
  await evaluate("new Promise(r=>document.readyState==='complete'?r():addEventListener('load',r,{once:true}))");
  await select('#projection',2);
  await check('unavailable LAEA stays selected and offers explicit Mercator',"document.getElementById('projection').value==='laea'&&document.getElementById('projectionStatus').textContent.includes('недоступен')&&!document.getElementById('useMercator').hidden");
  await screenshot('projection-unavailable');await click('#useMercator',true);
  await check('explicit fallback restores Mercator',"document.getElementById('projection').value==='mercator'&&document.getElementById('useMercator').hidden");
  await call('Network.setBlockedURLs',{urls:[]});
}
