// Only injected by the throwaway comparison server. Source point/series URLs are untouched.
const parameters=new URL(location.href).searchParams;
window.pyramidVariant=Number(parameters.get('variant')??1);
if(![1,2,4,8].includes(window.pyramidVariant))window.pyramidVariant=1;
const originalFetch=window.fetch.bind(window);
window.fetch=(input,options)=>{
    if(typeof input==='string'){
        const u=new URL(input,location.origin),m=u.pathname.match(/^\/api\/v1\/selections\/([a-f0-9]{64}\.[a-f0-9]{64})\/display\/3\/native\.json$/);
        if(m&&u.origin===location.origin)input='/__pyramid/'+window.pyramidVariant+'/'+m[1]+'/native.json';
    }
    return originalFetch(input,options);
};
addEventListener('DOMContentLoaded',()=>{
    const box=document.createElement('section');box.id='pyramidPanel';
    box.innerHTML=`<strong>Прототип пирамиды · точка и график исходные</strong>
      <div><button id="pyramidPrevious" aria-label="Предыдущий вариант">←</button>
      <select id="pyramidLevel" aria-label="Обобщение"><option value="1">Исходный</option><option value="2">Умеренное · шаг ×2</option><option value="4">Сильное · шаг ×4</option><option value="8">Очень сильное · шаг ×8</option></select>
      <button id="pyramidNext" aria-label="Следующий вариант">→</button>
      <select id="pyramidField" aria-label="Поле для сравнения"><option>Загрузка полей…</option></select>
      <button id="pyramidOverview">Обзор</button><button id="pyramidZoom">Приблизить</button><button id="pyramidRepeat">Повторный замер</button><button id="pyramidHidePoint">Свернуть точку</button></div>
      <small>Подготовка уровней — при первом выборе поля. Замеры: готовые снимки данных на локальном сервере. Ветер исходно выключен для сравнения.</small>
      <output id="pyramidMetrics">Ожидание карты…</output>`;
    const style=document.createElement('style');style.textContent=`#pyramidPanel{position:fixed;z-index:1000;left:50%;bottom:5px;transform:translateX(-50%);width:min(760px,95vw);max-height:180px;overflow:auto;padding:9px;background:#102338f2;border:1px solid #8ac5f2;border-radius:12px;color:white;font:12px system-ui;box-shadow:0 2px 16px #0008}#pyramidPanel div{display:flex;gap:5px;flex-wrap:wrap;margin:5px 0}#pyramidPanel button,#pyramidPanel select{font:12px system-ui;padding:5px;background:#edf6ff;color:#102338;border:0;border-radius:5px}#pyramidField{max-width:250px}#pyramidPanel output{display:block;white-space:pre-line;margin-top:4px}.timeline{bottom:195px!important}`;
    document.head.append(style);document.body.append(box);
    const selector=document.getElementById('pyramidLevel');selector.value=String(window.pyramidVariant);
    let changing=false,started=performance.now(),complete,fieldOptions='';
    async function change(factor){
        if(changing||!window.pyramidApp){selector.value=String(window.pyramidVariant);return;}
        changing=true;selector.disabled=true;complete=undefined;window.pyramidVariant=factor;selector.value=String(factor);
        const url=new URL(location.href);url.searchParams.set('variant',factor);history.replaceState(null,'',url);
        started=performance.now();try{await window.pyramidApp.reload();}finally{changing=false;selector.disabled=false;selector.value=String(window.pyramidVariant);}
    }
    selector.onchange=()=>void change(Number(selector.value));
    const cycle=direction=>{const fs=[1,2,4,8];void change(fs[(fs.indexOf(window.pyramidVariant)+direction+4)%4]);};
    document.getElementById('pyramidPrevious').onclick=()=>cycle(-1);document.getElementById('pyramidNext').onclick=()=>cycle(1);
    document.getElementById('pyramidRepeat').onclick=()=>void change(window.pyramidVariant);
    document.getElementById('pyramidOverview').onclick=()=>window.pyramidApp?.overview();
    document.getElementById('pyramidZoom').onclick=()=>window.pyramidApp?.zoom();
    document.getElementById('pyramidHidePoint').onclick=()=>window.pyramidApp?.hidePoint();
    document.getElementById('pyramidField').onchange=e=>window.pyramidApp?.choose(e.target.value);
    addEventListener('keydown',e=>{if(e.target.closest('input,textarea,select,[contenteditable]'))return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();cycle(e.key==='ArrowLeft'?-1:1);}});
    setInterval(()=>{
        const s=window.captureWeatherEvidence?.(),m=window.pyramidApp?.metrics();
        if(!s||!m)return;
        const names=[...new Set(m.fields.map(f=>f.name))].filter(Boolean).sort(),key=names.join(',');
        if(key!==fieldOptions){fieldOptions=key;const field=document.getElementById('pyramidField');field.replaceChildren(...names.map(name=>new Option((m.fields.find(f=>f.name===name&&f.level==='surface')??m.fields.find(f=>f.name===name)).label+' ('+name+')',name)));}
        document.getElementById('pyramidField').value=s.selected?.field_short_name??'';
        if(s.ready&&['ready','empty'].includes(s.contours.state)&&complete===undefined)complete=performance.now()-started;
        const n=v=>Number.isFinite(v)?v.toFixed(1):'—';
        document.getElementById('pyramidMetrics').textContent=`Запрошен ×${window.pyramidVariant}, показан ×${m.prototype?.factor??'—'} · сетка: ${m.shape?.join(' × ')??'…'} · ${(s.transfer_bytes/1e6).toFixed(2)} МБ\nЗагрузка поля: ${n(s.load_ms)} мс · изолинии: ${n(s.contours.build_ms)} мс · память: ${n(s.managed_bytes/1048576)} МиБ\n${s.contours.message??''} · сглаживание: ${m.prototype?.smoothing_css_px??'—'} px. Численная погрешность обобщения ещё не принята.`;
    },300);
});
