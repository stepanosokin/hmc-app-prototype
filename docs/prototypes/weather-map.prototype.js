// T22 visual prototype. All forecast values and publication states are invented.
'use strict';
const $ = id => document.getElementById(id);
const canvas = $('map'), ctx = canvas.getContext('2d');
const mobile = () => matchMedia('(max-width:700px)').matches;
const state = {run:1, revision:1, latest:[1,1], lead:1, units:'C', zone:'utc', basemap:'dark', point:null, zoom:1, offset:0, drawer:null};
const bounds = [-23.5,29.5,62.5,70.5];
const colors = [[114,114,181],[82,154,189],[112,200,178],[214,214,127],[237,171,104],[201,103,97]];
const basemaps = {
  dark:{water:'#314d5b',land:'#52615e',coast:'#9daba855',label:'#f2f7f9',shadow:'#132b3b'},
  light:{water:'#c7dbe4',land:'#e8e5d8',coast:'#718892',label:'#19384c',shadow:'#ffffff'}
};
const merc = lat => Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));
let view;
function project(lon,lat){return [view.x+(lon-view.lon)*view.scale,view.y-(merc(lat)-view.lat)*view.scale*180/Math.PI];}
function unproject(x,y){return [view.lon+(x-view.x)/view.scale,(2*Math.atan(Math.exp(view.lat-(y-view.y)/view.scale*Math.PI/180))-Math.PI/2)*180/Math.PI];}
function available(lead=state.lead){return !(state.run===1 && state.revision===1 && lead===3);}
function timeParts(hour){
  return Object.fromEntries(new Intl.DateTimeFormat('ru-RU',{timeZone:state.zone==='utc'?'UTC':undefined,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'longOffset'}).formatToParts(new Date(Date.UTC(2026,9,15,hour))).map(p=>[p.type,p.value]));
}
function clock(hour){const p=timeParts(hour);return `${p.hour}:${p.minute}`;}
function dayLabel(hour){const p=timeParts(hour);return `${p.day}.${p.month}`;}
function zoneLabel(hour=7){return timeParts(hour).timeZoneName.replace('GMT','UTC');}
function date(hour){const p=timeParts(hour);return `${p.day}.${p.month}.${p.year}, ${p.hour}:${p.minute} ${p.timeZoneName.replace('GMT','UTC')}`;}
function temperature(lon,lat,lead=state.lead){return 30-(lat-30)*.87+6*Math.sin(lon/13+lead/8)+state.run;}
function color(t){const v=Math.max(0,Math.min(4.999,(t+20)/60*5)),i=Math.floor(v),f=v-i;return colors[i].map((c,j)=>Math.round(c*(1-f)+colors[i+1][j]*f));}
function draw(){
  const w=innerWidth,h=innerHeight,dpr=devicePixelRatio;
  const basemap=basemaps[state.basemap];
  canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);
  const north=merc(bounds[3]),south=merc(bounds[1]);
  const mapTop=mobile()?235:105,mapBottom=h-(mobile()?280:195);
  const scale=Math.min((w-(mobile()?35:140))/86,Math.max(100,mapBottom-mapTop)/((north-south)*180/Math.PI))*state.zoom;
  view={scale,x:w/2,y:(mapTop+mapBottom)/2,lon:19.5+state.offset,lat:(north+south)/2};
  ctx.fillStyle=basemap.water;ctx.fillRect(0,0,w,h);
  ctx.beginPath();
  for(const polygon of window.land){for(const ring of polygon){ring.forEach(([lon,lat],i)=>{const [x,y]=project(lon,lat);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();}}
  ctx.fillStyle=basemap.land;ctx.fill('evenodd');ctx.strokeStyle=basemap.coast;ctx.lineWidth=.7;ctx.stroke();
  if(available()){
    const [left,top]=project(bounds[0],bounds[3]),[right,bottom]=project(bounds[2],bounds[1]);
    const field=document.createElement('canvas');field.width=216;field.height=170;
    const f=field.getContext('2d'),image=f.createImageData(216,170);
    for(let y=0;y<170;y++)for(let x=0;x<216;x++){
      const lon=bounds[0]+x/215*86,lat=(2*Math.atan(Math.exp(north-y/169*(north-south)))-Math.PI/2)*180/Math.PI;
      image.data.set([...color(temperature(lon,lat)),205],(y*216+x)*4);
    }
    f.putImageData(image,0,0);ctx.drawImage(field,left,top,right-left,bottom-top);
  }
  const [left,top]=project(bounds[0],bounds[3]),[right,bottom]=project(bounds[2],bounds[1]);
  ctx.strokeStyle='#e3f6f477';ctx.setLineDash([4,5]);ctx.strokeRect(left,top,right-left,bottom-top);ctx.setLineDash([]);
  ctx.font='12px '+getComputedStyle(document.body).fontFamily;ctx.textAlign='center';
  ctx.save();ctx.shadowColor=basemap.shadow;ctx.shadowBlur=3;
  for(const [name,lon,lat] of [['Москва',37.62,55.75],['Лондон',-.12,51.5],['Париж',2.35,48.86],['Рим',12.5,41.9],['Анкара',32.85,39.93],['Осло',10.75,59.91],['Хельсинки',24.94,60.17]]){
    const [x,y]=project(lon,lat);ctx.fillStyle=basemap.label;ctx.beginPath();ctx.arc(x,y,2,0,7);ctx.fill();ctx.fillText(name,x,y-8);
  }
  ctx.restore();
  renderPoint();
}
function pointChart(p){
  const unit=state.units==='C'?'°C':'K',offset=state.units==='K'?273.15:0;
  const value=hour=>temperature(p.lon,p.lat,hour-state.run*6)+offset;
  const history=Array.from({length:7},(_,i)=>({hour:i+1,value:value(i+1)}));
  const forecast=Array.from({length:12},(_,i)=>{const hour=7+i,lead=hour-state.run*6;return {hour,value:lead>=1&&lead<=12&&available(lead)?value(hour):null};});
  const values=[...history,...forecast].filter(p=>p.value!==null).map(p=>p.value),min=Math.floor(Math.min(...values)-1),max=Math.ceil(Math.max(...values)+1);
  const x=hour=>28+(hour-1)/17*230,y=value=>20+(max-value)/(max-min)*72;
  function line(points){let active=false;return points.map(p=>{if(p.value===null){active=false;return '';}const command=active?'L':'M';active=true;return `${command}${x(p.hour).toFixed(1)},${y(p.value).toFixed(1)}`;}).join(' ');}
  const selected=state.run*6+state.lead;
  const samples=Array.from({length:18},(_,i)=>{const hour=i+1,sample=hour<=7?history.find(p=>p.hour===hour):forecast.find(p=>p.hour===hour);return `<circle class="chartSample" data-hour="${hour}" data-value="${sample?.value==null?'':sample.value.toFixed(1)}" cx="${x(hour)}" cy="${sample?.value==null?92:y(sample.value)}" r="0"/>`;}).join('');
  const chartDates=dayLabel(1)===dayLabel(18)?dayLabel(1):`${dayLabel(1)}–${dayLabel(18)}`;
  return `<figure class="pointChart" data-unit="${unit}"><figcaption>Температура · ${unit}<span>${chartDates} · ${zoneLabel()}</span></figcaption><svg viewBox="0 0 278 118" role="img" tabindex="0" aria-label="Демонстрационная история с ${date(1)} до ${date(7)} и прогноз выбранного расчёта после ${date(7)}, ${unit}. Отсутствующие сроки показаны разрывами. Наведите указатель, коснитесь графика или используйте стрелки для просмотра значений."><title>Прошлые и прогнозные значения · демонстрационные данные</title><path class="chartGrid" d="M28,20H258 M28,92H258"/><text x="0" y="23">${max}</text><text x="0" y="95">${min}</text><path class="historyLine" d="${line(history)}"/><path class="forecastLine" d="${line(forecast)}"/><path class="nowLine" d="M${x(7)},16V96"/><text class="nowLabel" x="${x(7)}" y="10" text-anchor="middle">сейчас<title>Сейчас · ${date(7)} · демо</title></text><circle class="selectedValue" cx="${x(selected)}" cy="${y(value(selected))}" r="3.5"><title>Выбранный срок: ${date(selected)} · ${value(selected).toFixed(1)} ${unit}</title></circle>${samples}<g class="chartCursor" hidden><line y1="16" y2="96"/><circle r="3.5"/></g><text class="chartTime" x="28" y="113">${clock(1)}</text><text class="chartTime" x="${x(7)}" y="113" text-anchor="middle">${clock(7)}</text><text class="chartTime" x="258" y="113" text-anchor="end">${clock(18)}</text></svg><div class="chartTooltip" role="status" hidden><small class="tooltipTime"></small><b class="tooltipValue"></b><small class="tooltipKind"></small></div><div class="chartLegend"><span>Прошлое · демо</span><span>Прогноз · демо</span></div></figure>`;
}
function bindChartTooltip(figure){
  const svg=figure.querySelector('svg'),tip=figure.querySelector('.chartTooltip'),cursor=figure.querySelector('.chartCursor');
  let hour=7;
  function show(next){
    hour=Math.max(1,Math.min(18,next));
    const sample=svg.querySelector(`.chartSample[data-hour="${hour}"]`),x=Number(sample.getAttribute('cx')),circle=cursor.querySelector('circle');
    cursor.removeAttribute('hidden');tip.hidden=false;
    cursor.querySelector('line').setAttribute('x1',x);cursor.querySelector('line').setAttribute('x2',x);
    circle.setAttribute('cx',x);circle.setAttribute('cy',sample.getAttribute('cy'));circle.toggleAttribute('hidden',!sample.dataset.value);
    tip.querySelector('.tooltipTime').textContent=date(hour);
    tip.querySelector('.tooltipValue').textContent=sample.dataset.value?`${sample.dataset.value} ${figure.dataset.unit}`:'Нет срока';
    tip.querySelector('.tooltipKind').textContent=hour<=7?'Прошлое · демо':'Прогноз · демо';
    tip.style.left=Math.max(0,Math.min(figure.clientWidth-155,x/278*svg.getBoundingClientRect().width-70))+'px';
  }
  const inspect=e=>{const r=svg.getBoundingClientRect();show(Math.round(1+((e.clientX-r.left)/r.width*278-28)/230*17));};
  svg.onpointermove=inspect;svg.onpointerdown=inspect;
  svg.onpointerleave=e=>{if(e.pointerType!=='touch'){tip.hidden=true;cursor.setAttribute('hidden','');}};
  svg.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();show(hour+(e.key==='ArrowRight'?1:-1));}};
  svg.onblur=()=>{tip.hidden=true;cursor.setAttribute('hidden','');};
}
function pointContent(){
  const p=state.point;if(!p)return '';
  const inside=p.lon>=bounds[0]&&p.lon<=bounds[2]&&p.lat>=bounds[1]&&p.lat<=bounds[3];
  const t=temperature(p.lon,p.lat)+(state.units==='K'?273.15:0);
  return `<small>ДЕМОНСТРАЦИОННАЯ ТОЧКА</small><strong>${!available()?'Нет срока':!inside?'Вне покрытия':t.toFixed(1)+' '+(state.units==='C'?'°C':'K')}</strong><p>${p.lat.toFixed(2)}° с. ш. · ${p.lon.toFixed(2)}° в. д.</p>${available()&&inside?pointChart(p):'<p class="chartUnavailable">График недоступен для выбранной точки и срока.</p>'}<details class="pointDetails"><summary>Расчёт и источник</summary><small>Расчёт ${date(state.run*6)}<br>Прогноз ${date(state.run*6+state.lead)}<br>Редакция ${state.revision} · условное значение<br>Вся история и прогноз вымышлены<br>Не числовой API и не нативная ячейка</small></details>`;
}
function renderPoint(){
  $('pointMarker').hidden=!state.point;$('pointCard').hidden=!state.point;
  $('mobilePoint').innerHTML=pointContent();$('pointContent').innerHTML=pointContent();
  document.querySelectorAll('.pointChart').forEach(bindChartTooltip);
  if(state.point){const [x,y]=project(state.point.lon,state.point.lat);$('pointMarker').style.left=x+'px';$('pointMarker').style.top=y+'px';$('pointCard').style.left=Math.max(12,Math.min(innerWidth-310,x+20))+'px';$('pointCard').style.top=Math.max(12,Math.min(innerHeight-450,y-30))+'px';}
}
function render(){
  $('reference').textContent='Расчёт: '+date(state.run*6);
  $('valid').textContent='Прогноз: '+date(state.run*6+state.lead);
  $('selectionIdentity').textContent=`Редакция ${state.revision} · возраст ${state.run?1:7} ч · демочасы ${clock(7)} ${zoneLabel()}`;
  $('timeLabel').textContent=date(state.run*6+state.lead);
  $('availability').textContent=available()?'Доступно · полнота неизвестна':'Срок отсутствует';
  $('time').replaceChildren(...Array.from({length:12},(_,i)=>{const o=document.createElement('option');o.value=i+1;o.textContent=`${dayLabel(state.run*6+i+1)} ${clock(state.run*6+i+1)} · +${i+1} ч${state.run===1&&state.revision===1&&i===2?' · нет данных':''}`;o.selected=i+1===state.lead;return o;}));
  $('timeZoneLabel').textContent=`Срок ${zoneLabel(state.run*6+state.lead)}`;
  $('runTimeLabel').textContent=`Расчёт ${zoneLabel(state.run*6)}`;
  $('run').options[0].textContent=date(0)+' · демо';$('run').options[1].textContent=date(6)+' · неполный демо';
  $('timezoneInfo').textContent=state.zone==='utc'?'Отображение времени: UTC.':`Местное время системы: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;
  $('timeRange').value=state.lead;$('previous').disabled=state.lead===1;$('next').disabled=state.lead===12;
  $('run').value=state.run;$('units').value=state.units;
  document.querySelector('.unit').textContent=state.units==='C'?'°C':'K';
  document.querySelectorAll('.ticks span').forEach((el,i)=>el.textContent=state.units==='K'?([-20,0,20,40][i]+273.15).toFixed(2):String([-20,0,20,40][i]));
  $('metadata').innerHTML=`<dt>Поле</dt><dd>Температура на закодированной поверхности, не воздух на высоте 2 м</dd><dt>Выборка</dt><dd>ICON-EU / демо-расчёт ${state.run} / редакция ${state.revision} / +${state.lead} ч</dd><dt>Доступность и полнота</dt><dd>${available()?'Срок доступен':'Срок отсутствует'}; ${state.run?'частичный демонстрационный расчёт':'полнота неизвестна'}</dd><dt>Источник</dt><dd>Вымышленное поле для макета T22; не данные Гидрометцентра</dd>`;
  updateConnectionLinks();
  $('updateStatus').textContent=state.latest[state.run]>state.revision?'Доступна новая редакция. Текущая выборка закреплена до принятия обновления.':'Выбрана последняя демонстрационная редакция.';
  $('drawer').hidden=!state.drawer;$('settings').setAttribute('aria-expanded',String(!!state.drawer));
  $('settingsBody').hidden=state.drawer==='point';
  $('drawer').classList.toggle('pointMode',state.drawer==='point');
  $('closeDrawer').textContent=state.drawer==='point'?'×':'Свернуть ⌄';
  $('closeDrawer').setAttribute('aria-label',state.drawer==='point'?'Закрыть значение точки':'Свернуть панель');
  $('notice').textContent=available()?'Демонстрация оформления · значения вымышлены':'В выбранной редакции этот срок отсутствует. Слой и значение точки скрыты.';
  draw();
}
function updateConnectionLinks(){
  const run=`demo-20261015T${state.run?'06':'00'}00Z`,revision=state.revision.toString(16).padStart(32,'0');
  const time=`2026-10-15T${String(state.run*6+state.lead).padStart(2,'0')}:00:00Z`,point=state.point||{lon:19.5,lat:50};
  const wms=new URL(`https://demo.invalid/gis/v1/runs/${run}/revisions/${revision}/wms`);
  wms.search=new URLSearchParams({SERVICE:'WMS',VERSION:'1.3.0',REQUEST:'GetCapabilities'});
  const api=new URL('https://demo.invalid/api/v1/point');
  api.search=new URLSearchParams({selection:`demo-icon-eu-${state.run}-r${state.revision}`,run,revision,valid_time:time,layer:'T_G',lon:point.lon.toFixed(4),lat:point.lat.toFixed(4)});
  $('wmsLink').href=wms.href;$('apiLink').href=api.href;
  $('linkSelection').textContent=`ICON-EU · расчёт ${date(state.run*6)} · редакция ${state.revision} · срок ${date(state.run*6+state.lead)}`;
  $('linkPoint').textContent=`API: ${state.point?'выбранная точка':'пример — центр покрытия'} ${point.lat.toFixed(2)}°, ${point.lon.toFixed(2)}°; исходные единицы K.`;
}
function selectTime(lead){state.lead=Number(lead);state.point=null;if(state.drawer==='point')state.drawer=null;render();}
function closePoint(){state.point=null;if(state.drawer==='point')state.drawer=null;render();canvas.focus({preventScroll:true});}
$('time').onchange=e=>selectTime(e.target.value);$('timeRange').oninput=e=>selectTime(e.target.value);
$('previous').onclick=()=>selectTime(Math.max(1,state.lead-1));$('next').onclick=()=>selectTime(Math.min(12,state.lead+1));
$('run').onchange=e=>{state.run=Number(e.target.value);state.revision=state.latest[state.run];state.lead=1;state.point=null;render();};
$('units').onchange=e=>{state.units=e.target.value;render();};
$('font').onchange=e=>{document.documentElement.style.setProperty('--page-font',e.target.value==='courier'?'"Courier New",monospace':'system-ui,"Segoe UI",sans-serif');draw();};
$('basemap').onchange=e=>{state.basemap=e.target.value;document.body.classList.toggle('basemapLight',state.basemap==='light');draw();};
$('timezone').onchange=e=>{state.zone=e.target.value;render();};
$('settings').onclick=()=>{state.drawer=state.drawer==='settings'?null:'settings';render();};
$('closePoint').onclick=closePoint;
$('closeDrawer').onclick=()=>{if(state.drawer==='point'){closePoint();return;}state.drawer=null;render();};
$('temperature').onclick=()=>{state.drawer='settings';render();};
$('publish').onclick=()=>{state.latest[state.run]=2;render();};
$('refresh').onclick=()=>{state.revision=state.latest[state.run];state.point=null;render();};
$('failure').onclick=()=>{$('updateStatus').textContent='Сбой обновления. Закреплённые опубликованные данные сохранены.';};
$('fit').onclick=()=>{state.zoom=1;state.offset=0;draw();};
$('zoomIn').onclick=()=>{state.zoom=Math.min(4,state.zoom*1.3);draw();};
$('zoomOut').onclick=()=>{state.zoom=Math.max(.6,state.zoom/1.3);draw();};
$('west').onclick=()=>{state.offset-=10/state.zoom;draw();};$('east').onclick=()=>{state.offset+=10/state.zoom;draw();};
canvas.onclick=e=>{const [lon,lat]=unproject(e.clientX,e.clientY);state.point={lon,lat};if(mobile())state.drawer='point';render();};
canvas.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const [lon,lat]=unproject(innerWidth/2,innerHeight*.47);state.point={lon,lat};if(mobile())state.drawer='point';render();}};
addEventListener('keydown',e=>{if(e.key==='Escape'&&state.point&&!e.target.matches('select,input')){e.preventDefault();closePoint();}});
addEventListener('resize',render);render();
