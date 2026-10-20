// Runs on the physical phone. The host never emulates its user agent or viewport.
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const record={user_agent:navigator.userAgent,platform:navigator.platform,
    device_pixel_ratio:devicePixelRatio,physical_device_claim:'Galaxy S25+, user supplied',
    errors:[],viewports:[],canvases:[]};
const onError=event=>record.errors.push(String(event.message||event.reason||'Необработанная ошибка'));
window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onError);
try {
    for(let i=0;i<600&&!window.probeReady;i++)await delay(50);
    if(!window.probeReady)throw Error('Карта не запустилась.');
    const result=await window.runProbe();
    const viewport={width:innerWidth,height:innerHeight,mobile_emulation:false,...result};record.viewports.push(viewport);
    viewport.interaction=await window.runInteraction();
    for(const mode of ['hmc:orthographic','EPSG:3576']){
        await window.showProbe(mode);
        const canvas=document.querySelector('#map canvas');
        record.canvases.push({mode,width:canvas.width,height:canvas.height,png:canvas.toDataURL('image/png'),
            scope:'physical GPU map canvas; HTML controls/labels are not included'});
    }
    if(record.errors.length||result.errors?.length)throw Error('Обнаружены ошибки браузера: '+JSON.stringify([...record.errors,...result.errors]));
    record.status='compatibility-probe-complete';record.acceptance='incomplete';
} catch(error){record.status='failed';record.failure=String(error);}
finally {
    try {
        record.cleanup=window.releaseProbe?await window.releaseProbe():{map_removed:!document.querySelector('#map canvas'),release_unavailable:true};
        if(!record.cleanup.map_removed){record.status='failed';record.failure='Не подтверждено освобождение карты.';}
    } catch(error){record.status='failed';record.cleanup={error:String(error)};}
    record.cleanup.scope='phone map and its workers; user tab remains open';
    window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onError);
    try {
        const response=await fetch('/mobile-result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record)});
        document.getElementById('status').textContent=response.ok?
            'Проверка записана. Можно закрыть вкладку.':
            'Не удалось сохранить результат. Не закрывайте вкладку.';
    } catch {document.getElementById('status').textContent='Сервер недоступен. Результат пока не записан.';}
}
