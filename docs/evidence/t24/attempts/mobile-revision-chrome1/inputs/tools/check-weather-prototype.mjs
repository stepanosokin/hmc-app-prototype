// Visible-control checks for the T22 mockup. No API/GPU or real-device claim.
import {spawn, execFileSync} from 'node:child_process';
import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {resolve, join, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID, createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const projections=process.argv.includes('--projections');
const root=resolve('.'), directory=resolve(process.env.T22_REPORT_DIRECTORY || (projections?'data/reports/t24':'data/reports/t22'));
const profile=resolve('data', 't22-browser-'+randomUUID());
const executable=process.env.T22_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
await mkdir(directory,{recursive:true});
const report={scope:'T22 visual mockup; desktop Chrome and emulated mobile viewport, not real mobile hardware',starting_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),checks:[],screenshots:[],errors:[],external_requests:[],inputs:{},cleanup:{}};
if(projections)report.scope='T24 projection mockup; desktop browser and emulated mobile viewport, not real hardware or production GPU/API';
for(const path of ['docs/prototypes/weather-map.prototype.html','docs/prototypes/weather-map.prototype.css','docs/prototypes/weather-map.prototype.js','docs/prototypes/weather-map.projections.js','docs/prototypes/assets/land.js',...['d3-array.min.js','d3-geo.min.js','proj4.js'].map(f=>'docs/prototypes/assets/vendor/'+f),'tools/check-weather-prototype.mjs',...(projections?['tools/weather-projection-checks.mjs','tools/check-weather-geometry.py']:[])]){
  const bytes=await readFile(path);report.inputs[path]=createHash('sha256').update(bytes).digest('hex');
  if(projections){const target=join(directory,'inputs',path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);}
}
report.owned_profile=profile;
report.browser_executable=executable;
const child=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let socket,call;
try{
  let port;
  for(let i=0;i<100;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{}await delay(100);}
  assert.ok(port,'Browser debugging endpoint started');
  const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{socket.onopen=res;socket.onerror=rej;});
  let id=0;const pending=new Map();
  socket.onmessage=e=>{const message=JSON.parse(e.data);if(pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);clearTimeout(p.timeout);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')report.errors.push(message.params.exceptionDetails);else if(message.method==='Network.requestWillBeSent'&&/^https?:/.test(message.params.request.url))report.external_requests.push(message.params.request.url);};
  call=(method,params={})=>new Promise((res,rej)=>{const n=++id;const timeout=setTimeout(()=>{pending.delete(n);rej(Error('CDP timeout: '+method));},10000);pending.set(n,{resolve:res,reject:rej,timeout});socket.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const check=async(name,expression)=>{const value=await evaluate(expression);if(value!==true)report.failure_dom=await evaluate("({focus:document.activeElement?.id,timezone:document.getElementById('timezone').value,point:document.getElementById('pointContent').textContent,reference:document.getElementById('reference').textContent,widgets:[...document.querySelectorAll('details[id]')].map(e=>[e.id,e.open])})");assert.equal(value,true,name);report.checks.push(name);};
  const click=async(selector,touch=false)=>{
    if(selector==='#map')await collapseWidgets();
    if(selector==='#closeDrawer'&&await evaluate("matchMedia('(max-width:700px)').matches&&document.getElementById('drawer').hidden")){await collapseWidgets();await click('#showPoint',true);}
    const ancestors=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),ids=[];for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open&&e!==p.querySelector(':scope>summary'))ids.unshift(p.id);return ids;})()`);
    for(const id of ancestors)await click('#'+id+'>summary',touch);
    if(ancestors.length)await evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    const box=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})()`);
    const hit=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),hit=document.elementFromPoint(${box.x},${box.y});return {visible:!!hit&&(hit===e||e.contains(hit)),actual:hit?.id||hit?.tagName};})()`);
    if(!hit.visible){report.failed_input={selector,box,hit};throw Error('Input target is covered: '+JSON.stringify(report.failed_input));}
    if(touch){await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[box]});await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    else{await call('Input.dispatchMouseEvent',{type:'mousePressed',...box,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...box,button:'left',clickCount:1});}
    if(selector.endsWith('>summary'))await evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  };
  const collapseWidgets=async()=>{
    for(const id of ['forecastPanel','navigationPanel'])if(await evaluate(`matchMedia('(max-width:700px)').matches&&document.getElementById('${id}').open`))await click('#'+id+'>summary',true);
    if(await evaluate("matchMedia('(max-width:700px)').matches&&!document.getElementById('drawer').hidden&&!document.getElementById('collapsePoint').hidden"))await click('#collapsePoint',true);
  };
  const key=async key=>{const code={Home:36,ArrowDown:40,Enter:13,Tab:9,Escape:27}[key];await call('Input.dispatchKeyEvent',{type:'rawKeyDown',key,windowsVirtualKeyCode:code});await call('Input.dispatchKeyEvent',{type:'keyUp',key,windowsVirtualKeyCode:code});};
  const select=async(selector,index)=>{await click(selector);await key('Escape');await key('Home');for(let i=0;i<index;i++)await key('ArrowDown');await key('Tab');};
  const screenshot=async(name,clip)=>{await delay(150);const r=await call('Page.captureScreenshot',{format:'png',...(clip?{clip}:{})});await writeFile(join(directory,name+'.png'),Buffer.from(r.data,'base64'));report.screenshots.push(name+'.png');};
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
  report.browser=await call('Browser.getVersion');
  for(const [width,height,mobile] of [[1440,900,false],[390,844,true],[360,740,true]]){
    const prefix=`${width}x${height}`;
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
    await call('Emulation.setTouchEmulationEnabled',{enabled:mobile});
    await call('Emulation.setTimezoneOverride',{timezoneId:'Europe/Moscow'});
    await call('Page.navigate',{url:pathToFileURL(resolve('docs/prototypes/weather-map.prototype.html')).href});
    for(let i=0;i<100;i++){if(await evaluate("!!document.getElementById('selectionIdentity')?.textContent"))break;await delay(50);}
    if(projections)await check(prefix+' accessible projection selector starts in Mercator',"document.getElementById('projection')?.value==='mercator' && document.getElementById('projection').options.length===3");
    if(mobile){
      await check(prefix+' mobile widgets start collapsed',"['forecastPanel','navigationPanel','legendPanel','timelinePanel'].every(id=>!document.getElementById(id).open)");
      await screenshot(prefix+'-mobile-collapsed');
    }
    await check(prefix+' initial drawer collapsed',"document.getElementById('drawer').hidden && !document.getElementById('selectionIdentity').textContent.includes('undefined')");
    await check(prefix+' local basemap loaded',"window.land.length>0 && document.documentElement.lang==='ru'");
    await check(prefix+' widgets have 90 percent transparent backgrounds',"[...document.querySelectorAll('.panel')].every(e=>getComputedStyle(e).backgroundColor==='rgba(12, 32, 63, 0.1)' && getComputedStyle(e).opacity==='1')");
    await check(prefix+' compact selection and legend',"document.querySelector('.selection').getBoundingClientRect().width<=290 && document.querySelector('.legend').getBoundingClientRect().width<=204");
    await check(prefix+' layer uses thermometer icon and hidden name',"!!document.querySelector('#temperature svg') && document.getElementById('temperature').getAttribute('aria-label')==='Температура' && getComputedStyle(document.getElementById('temperatureTooltip')).visibility==='hidden'");
    await select('#model',0);
    await check(prefix+' independent model selector offers only implemented model',"document.getElementById('model').value==='icon-eu' && document.getElementById('model').options.length===1 && document.getElementById('model').closest('.model')!==null && document.getElementById('drawer').hidden");
    await check(prefix+' newest usable run and first time selected',"document.getElementById('reference').textContent.includes('06:00') && document.getElementById('time').value==='1' && document.getElementById('valid').textContent.includes('07:00')");
    await check(prefix+' coverage fully within viewport',"(()=>{const a=project(-23.5,70.5),b=project(62.5,29.5);return a[0]>=0&&a[1]>=0&&b[0]<=innerWidth&&b[1]<=innerHeight;})()");
    await screenshot(prefix+'-initial');
    if(!mobile)await screenshot('city-label-system',await evaluate("(()=>{const [x,y]=project(12.5,41.9);return {x:Math.floor(x-40),y:Math.floor(y-28),width:80,height:38,scale:1};})()"));
    await check(prefix+' tiny labeled font selector matches attribution below timeline',"(()=>{const f=document.getElementById('font'),a=document.querySelector('.basemapAttribution'),r=f.getBoundingClientRect(),t=document.querySelector('.timeline').getBoundingClientRect();return f.closest('label').textContent.startsWith('Шрифт:')&&f.options.length===2&&f.value==='system'&&getComputedStyle(f).fontSize===getComputedStyle(a).fontSize&&r.top>=t.bottom&&r.right<=a.getBoundingClientRect().left;})()");
    await select('#font',1);
    await check(prefix+' Courier New changes page controls and map labels',"[document.body,document.getElementById('time'),document.getElementById('font')].every(e=>getComputedStyle(e).fontFamily.includes('Courier New'))&&document.getElementById('map').getContext('2d').font.includes('Courier New')");
    await check(prefix+' Courier footer labels do not overlap',"document.getElementById('font').getBoundingClientRect().right<=document.querySelector('.basemapAttribution').getBoundingClientRect().left && document.documentElement.scrollWidth===innerWidth");
    await screenshot(prefix+'-courier');
    if(!mobile)await screenshot('city-label-courier',await evaluate("(()=>{const [x,y]=project(12.5,41.9);return {x:Math.floor(x-40),y:Math.floor(y-28),width:80,height:38,scale:1};})()"));
    await select('#font',0);
    await check(prefix+' original font restored',"getComputedStyle(document.body).fontFamily.includes('system-ui')&&!document.getElementById('map').getContext('2d').font.includes('Courier New')");
    await check(prefix+' basemap selector retains source attribution',"document.getElementById('basemap').value==='dark'&&document.getElementById('basemap').options.length===2&&[...document.getElementById('basemap').options].every(o=>o.textContent.includes('Natural Earth'))&&document.getElementById('basemap').closest('label').textContent.startsWith('Подложка:')");
    const darkPixel=await evaluate("JSON.stringify([...document.getElementById('map').getContext('2d').getImageData(0,0,1,1).data])");
    await select('#basemap',1);
    await check(prefix+' light basemap changes rendered map',`document.body.classList.contains('basemapLight')&&JSON.stringify([...document.getElementById('map').getContext('2d').getImageData(0,0,1,1).data])!==${JSON.stringify(darkPixel)}`);
    await screenshot(prefix+'-basemap-light');
    await select('#basemap',0);
    await check(prefix+' dark basemap restores original rendering',`!document.body.classList.contains('basemapLight')&&JSON.stringify([...document.getElementById('map').getContext('2d').getImageData(0,0,1,1).data])===${JSON.stringify(darkPixel)}`);
    if(!mobile){
      const position=await evaluate("(()=>{const b=document.getElementById('temperature').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})()");
      await call('Input.dispatchMouseEvent',{type:'mouseMoved',...position});
      await check(prefix+' layer name appears on hover',"getComputedStyle(document.getElementById('temperatureTooltip')).visibility==='visible'");
      await screenshot(prefix+'-layer-hover');
      await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:400,y:350});
      await check(prefix+' layer name hides after hover',"getComputedStyle(document.getElementById('temperatureTooltip')).visibility==='hidden'");
    }
    await click('#map',mobile);
    await check(prefix+' point selected',"!document.getElementById('pointMarker').hidden && document.getElementById('pointCard').textContent.includes('условное значение')");
    await check(prefix+' point chart distinguishes demo history forecast and now',"(()=>{const f=document.querySelector('#pointContent .pointChart');return !!f?.querySelector('svg[role=img]')&&f.textContent.includes('Прошлое · демо')&&f.textContent.includes('Прогноз · демо')&&f.textContent.includes('сейчас')&&f.textContent.includes('UTC');})()");
    await check(prefix+' chart preserves missing forecast time as gap',"document.querySelector('#pointContent .forecastLine').getAttribute('d').split('M').length===3");
    await check(prefix+' chart selected sample matches displayed point',"document.querySelector('#pointContent .selectedValue title').textContent.includes(document.querySelector('#pointContent strong').textContent)");
    await check(prefix+' point chart fits visible popup',"(()=>{const mobile=matchMedia('(max-width:700px)').matches,f=document.querySelector(mobile?'#mobilePoint .pointChart':'#pointContent .pointChart').getBoundingClientRect(),p=document.getElementById(mobile?'drawer':'pointCard').getBoundingClientRect();return f.left>=p.left&&f.right<=p.right&&f.bottom<=p.bottom;})()");
    await check(prefix+' point close is a compact corner square without separate row',"(()=>{const b=document.getElementById(matchMedia('(max-width:700px)').matches?'closeDrawer':'closePoint');const r=b.getBoundingClientRect();return b.textContent==='×'&&r.width===24&&r.height===24&&getComputedStyle(b).position==='absolute'&&b.getAttribute('aria-label')==='Закрыть значение точки';})()");
    if(mobile)await check(prefix+' point opens half-height shared drawer',"!document.getElementById('drawer').hidden && document.getElementById('settingsBody').hidden && document.getElementById('drawer').getBoundingClientRect().height<=innerHeight/2");
    await screenshot(prefix+'-point');
    const chartRoot=mobile?'#mobilePoint':'#pointContent';
    const chartPosition=async hour=>evaluate(`(()=>{const r=document.querySelector('${chartRoot} .pointChart svg').getBoundingClientRect();return {x:r.left+(28+(${hour}-1)/17*230)/278*r.width,y:r.top+55/118*r.height};})()`);
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',...await chartPosition(7)});
    await check(prefix+' graph hover popup shows exact time value and cursor',`(()=>{const f=document.querySelector('${chartRoot} .pointChart'),t=f.querySelector('.chartTooltip');return !t.hidden&&t.querySelector('.tooltipTime').textContent.includes('07:00 UTC')&&t.querySelector('.tooltipValue').textContent===document.querySelector('${chartRoot} strong').textContent&&!f.querySelector('.chartCursor').hasAttribute('hidden');})()`);
    await screenshot(prefix+'-chart-hover');
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',...await chartPosition(9)});
    await check(prefix+' hover on missing forecast hour shows no value',`(()=>{const f=document.querySelector('${chartRoot} .pointChart');return f.querySelector('.tooltipValue').textContent==='Нет срока'&&f.querySelector('.tooltipTime').textContent.includes('09:00 UTC')&&f.querySelector('.chartCursor circle').hasAttribute('hidden');})()`);
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
    await check(prefix+' graph hover popup disappears on pointer leave',`document.querySelector('${chartRoot} .chartTooltip').hidden`);
    const pointBeforeBasemap=await evaluate("JSON.stringify({value:document.querySelector('#pointContent strong').textContent,api:document.getElementById('apiLink').href,time:document.getElementById('time').value,identity:document.getElementById('selectionIdentity').textContent})");
    await select('#basemap',1);
    await check(prefix+' basemap switch preserves forecast and selected point',`!document.getElementById('pointMarker').hidden&&JSON.stringify({value:document.querySelector('#pointContent strong').textContent,api:document.getElementById('apiLink').href,time:document.getElementById('time').value,identity:document.getElementById('selectionIdentity').textContent})===${JSON.stringify(pointBeforeBasemap)}`);
    await screenshot(prefix+'-basemap-light-point');
    await select('#basemap',0);
    await select('#timezone',1);
    await check(prefix+' local Moscow converts all main time labels and retains selection',"document.getElementById('reference').textContent.includes('09:00 UTC+03:00')&&document.getElementById('valid').textContent.includes('10:00 UTC+03:00')&&document.getElementById('timeLabel').textContent.includes('10:00 UTC+03:00')&&document.getElementById('selectionIdentity').textContent.includes('демочасы 10:00 UTC+03:00')&&document.getElementById('run').options[1].textContent.includes('09:00 UTC+03:00')&&document.getElementById('time').selectedOptions[0].textContent.includes('10:00')&&document.getElementById('time').value==='1'&&!document.getElementById('pointMarker').hidden");
    await check(prefix+' local chart axis details and connection labels convert but API stays UTC',"document.querySelector('#pointContent .pointChart figcaption').textContent.includes('UTC+03:00')&&[...document.querySelectorAll('#pointContent .chartTime')].map(e=>e.textContent).join(',')==='04:00,10:00,21:00'&&document.querySelector('#pointContent .pointDetails').textContent.includes('10:00 UTC+03:00')&&document.getElementById('linkSelection').textContent.includes('10:00 UTC+03:00')&&new URL(document.getElementById('apiLink').href).searchParams.get('valid_time')==='2026-10-15T07:00:00Z'");
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',...await chartPosition(7)});
    await check(prefix+' graph hover uses local system timezone',`document.querySelector('${chartRoot} .tooltipTime').textContent.includes('10:00 UTC+03:00')&&!document.querySelector('${chartRoot} .chartTooltip').hidden`);
    await screenshot(prefix+'-local-time');
    for(const [zone,description,reference,valid,ticks] of [
      ['America/Los_Angeles','previous calendar day','14.10.2026, 23:00 UTC-07:00','15.10.2026, 00:00 UTC-07:00','18:00,00:00,11:00'],
      ['Asia/Kolkata','half-hour offset','15.10.2026, 11:30 UTC+05:30','15.10.2026, 12:30 UTC+05:30','06:30,12:30,23:30'],
      ['Pacific/Kiritimati','next calendar day','15.10.2026, 20:00 UTC+14:00','15.10.2026, 21:00 UTC+14:00','15:00,21:00,08:00']
    ]){
      await call('Emulation.setTimezoneOverride',{timezoneId:zone});await select('#timezone',0);await select('#timezone',1);
      await check(prefix+' local timezone handles '+description,`document.getElementById('reference').textContent.includes(${JSON.stringify(reference)})&&document.getElementById('valid').textContent.includes(${JSON.stringify(valid)})&&[...document.querySelectorAll('#pointContent .chartTime')].map(e=>e.textContent).join(',')===${JSON.stringify(ticks)}&&document.getElementById('timezoneInfo').textContent.includes('Местное время системы:')`);
    }
    await check(prefix+' local chart identifies date rollover',"document.querySelector('#pointContent .pointChart figcaption').textContent.includes('15.10–16.10')");
    await call('Emulation.setTimezoneOverride',{timezoneId:'Europe/Moscow'});await select('#timezone',0);
    await check(prefix+' UTC restored without changing pinned point time or API',"document.getElementById('reference').textContent.includes('06:00 UTC')&&document.getElementById('valid').textContent.includes('07:00 UTC')&&document.getElementById('time').value==='1'&&!document.getElementById('pointMarker').hidden&&new URL(document.getElementById('apiLink').href).searchParams.get('valid_time')==='2026-10-15T07:00:00Z'");
    await click(mobile?'#closeDrawer':'#closePoint',mobile);
    await check(prefix+' close button dismisses point and marker',"document.getElementById('pointMarker').hidden && document.getElementById('pointCard').hidden && document.getElementById('drawer').hidden");
    await click('#map',mobile);
    await check(prefix+' point can be reopened after close',"!document.getElementById('pointMarker').hidden && document.getElementById('pointContent').textContent.includes('условное значение')");
    await key('Escape');
    await check(prefix+' Escape dismisses point and marker',"document.getElementById('pointMarker').hidden && document.getElementById('pointCard').hidden && document.getElementById('drawer').hidden");
    await click('#map',mobile);
    await click('#next',mobile);
    await check(prefix+' time change clears old point',"document.getElementById('pointMarker').hidden && document.getElementById('time').value==='2'");
    await click('#zoomIn',mobile);await click('#east',mobile);await click('#fit',mobile);
    await check(prefix+' fit preserves pinned selection',"state.zoom===1&&state.offset===0&&document.getElementById('time').value==='2'&&state.revision===1");
    await click('#settings',mobile);
    await check(prefix+' source details expanded',"!document.getElementById('drawer').hidden && !document.getElementById('settingsBody').hidden && document.getElementById('metadata').textContent.includes('не воздух на высоте 2 м')");
    await check(prefix+' WMS and API demo links pin selection without keys',"(()=>{const w=new URL(document.getElementById('wmsLink').href),a=new URL(document.getElementById('apiLink').href);return w.hostname==='demo.invalid'&&a.hostname==='demo.invalid'&&w.pathname.includes('/runs/demo-20261015T0600Z/revisions/00000000000000000000000000000001/wms')&&w.searchParams.get('REQUEST')==='GetCapabilities'&&a.pathname==='/api/v1/point'&&a.searchParams.get('valid_time')==='2026-10-15T08:00:00Z'&&a.searchParams.get('layer')==='T_G'&&a.searchParams.get('lon')==='19.5000'&&a.searchParams.get('lat')==='50.0000'&&![...a.searchParams.keys(),...w.searchParams.keys()].some(k=>/key|token/i.test(k));})()");
    await select('#units',1);
    await check(prefix+' Kelvin legend matches units',"document.querySelector('.unit').textContent==='K'&&document.querySelector('.ticks').textContent.includes('253.15')");
    await select('#units',0);
    await select('#run',0);
    await check(prefix+' older run selected explicitly',"document.getElementById('reference').textContent.includes('00:00')&&document.getElementById('time').value==='1'");
    await select('#run',1);
    await check(prefix+' run explicitly selected',"document.getElementById('reference').textContent.includes('06:00')&&document.getElementById('time').value==='1'");
    await click('#closeDrawer',mobile);await select('#time',2);
    await check(prefix+' missing time explicit',"document.getElementById('availability').textContent==='Срок отсутствует'&&document.getElementById('pointMarker').hidden");
    await screenshot(prefix+'-missing');
    await click('#map',mobile);
    await check(prefix+' missing time has explicit unavailable chart',"!document.querySelector('#pointContent .pointChart')&&document.querySelector('#pointContent .chartUnavailable').textContent.includes('недоступен')");
    await click(mobile?'#closeDrawer':'#closePoint',mobile);
    await click('#settings',mobile);await click('#publish',mobile);
    await check(prefix+' new revision waits for explicit acceptance',"document.getElementById('selectionIdentity').textContent.startsWith('Редакция 1')&&document.getElementById('updateStatus').textContent.includes('закреплена')");
    await click('#refresh',mobile);
    await check(prefix+' refresh keeps time and clears point',"document.getElementById('selectionIdentity').textContent.startsWith('Редакция 2')&&document.getElementById('time').value==='3'&&document.getElementById('availability').textContent.includes('Доступно')&&document.getElementById('pointMarker').hidden");
    await check(prefix+' connection links adopt accepted revision and retain time',"(()=>{const w=new URL(document.getElementById('wmsLink').href),a=new URL(document.getElementById('apiLink').href);return w.pathname.includes('/revisions/00000000000000000000000000000002/')&&a.searchParams.get('revision')==='00000000000000000000000000000002'&&a.searchParams.get('valid_time')==='2026-10-15T09:00:00Z';})()");
    await click('#failure',mobile);
    await check(prefix+' failed update preserves published selection',"document.getElementById('updateStatus').textContent.includes('Сбой')&&document.getElementById('selectionIdentity').textContent.startsWith('Редакция 2')&&document.getElementById('time').value==='3'");
    await screenshot(prefix+'-settings');
    await click('#closeDrawer',mobile);await click('#map',mobile);await click('#settings',mobile);
    await check(prefix+' API link uses selected point and exposes demo provenance',"(()=>{const a=new URL(document.getElementById('apiLink').href),text=document.querySelector('#pointContent p').textContent;return text.includes(Number(a.searchParams.get('lat')).toFixed(2)+'°')&&text.includes(Number(a.searchParams.get('lon')).toFixed(2)+'°')&&document.getElementById('linkPoint').textContent.includes('выбранная точка')&&document.querySelector('.connectionLinks').textContent.includes('идентификаторы вымышлены');})()");
    await evaluate("document.querySelector('.connectionLinks').scrollIntoView({block:'center'})");
    await screenshot(prefix+'-connections');
    await check(prefix+' timeline remains accessible',"(()=>{const r=document.querySelector('.timeline').getBoundingClientRect(),d=document.getElementById('drawer').getBoundingClientRect();return r.bottom<=innerHeight && (!matchMedia('(max-width:700px)').matches||d.bottom<=r.top);})()");
    await check(prefix+' no horizontal overflow',"document.documentElement.scrollWidth===innerWidth");
  }
  if(projections){const {checkProjections}=await import('./weather-projection-checks.mjs');await checkProjections({call,evaluate,check,click,key,select,screenshot,collapseWidgets,report,url:pathToFileURL(resolve('docs/prototypes/weather-map.prototype.html')).href});}
  assert.deepEqual(report.errors,[],'No JavaScript runtime errors');assert.deepEqual(report.external_requests,[],'No external page requests');
  report.status='passed';
}catch(error){report.status='failed';report.failure=String(error.stack||error);process.exitCode=1;
  if(call){try{const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,'failure.png'),Buffer.from(r.data,'base64'));}catch{}}
}finally{
  try{
    if(call){try{await call('Browser.close');}catch{ /* Still retire the owned process if CDP is unavailable. */ }}
    socket?.close();
    for(let i=0;i<50&&child.exitCode===null;i++)await delay(100);
    if(child.exitCode===null)execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});
    const remaining=execFileSync('powershell',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:T22_BROWSER_PROFILE) }).Count"],{encoding:'utf8',env:{...process.env,T22_BROWSER_PROFILE:profile},windowsHide:true}).trim();
    assert.equal(remaining,'0','No test browser process remains');
    assert.ok(profile.startsWith(resolve(root,'data')+'\\'),'Profile cleanup stays inside repository data directory');
    await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
    report.cleanup={browser_processes_remaining:0,profile_removed:true,compose_projects_created:0,servers_created:0};
  }catch(error){report.cleanup={error:String(error)};report.status='failed';process.exitCode=1;}
  await writeFile(join(directory,'validation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure,cleanup:report.cleanup}));
}
