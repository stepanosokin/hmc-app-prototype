// T23 interaction experiment. One orthographic camera for field and local context.
function assert(condition,message){if(!condition)throw Error(message);}

export function installInteraction(viewer) {
    const panel=document.getElementById('panel'),status=document.getElementById('status');
    panel.querySelector('strong').textContent='T23 · проекции · техническая проверка';
    const controls=document.createElement('div');
    controls.innerHTML='<label>Единицы <select id="units"><option>K</option><option>°C</option></select></label> '+
        '<button id="west">Повернуть на запад</button><button id="east">Повернуть на восток</button> '+
        '<button id="mercator" hidden>Перейти в Mercator</button><div id="visibility-message" role="status"></div>'+
        '<div>Поворачивайте глобус одним пальцем. Двумя пальцами меняйте масштаб.</div>';
    panel.append(controls);
    let units='K',pending=Promise.resolve(),busy=false,desiredCenter=[20,50];
    const snapshot=()=>{
        const state=viewer.current();
        return {selection:state.selection,units,position:state.position?{...state.position}:null,
            mode:state.mode,center:state.center,zoom:state.map.getZoom(),
            marker_hidden:document.getElementById('selected-point')?.hidden??null,
            visibility_message:document.getElementById('visibility-message').textContent};
    };
    const failure=()=>{
        status.textContent='Режим недоступен: не удалось построить карту. Можно явно перейти в Mercator.';
        document.getElementById('mercator').hidden=false;
    };
    const act=operation=>{
        if(busy)return pending;
        busy=true;
        pending=operation().catch(error=>{failure();throw error;}).finally(()=>{busy=false;});
        // Event listeners must not leave unhandled promise rejections.
        pending.catch(()=>{});return pending;
    };
    async function switchMode(mode,rotation) {
        const before=viewer.current(),scale=before.layer.geometry().scale;
        if(mode==='hmc:orthographic'&&before.mode===mode&&rotation){
            desiredCenter=[...rotation];viewer.rotate(rotation);
            await new Promise(resolve=>{before.map.once('render',resolve);before.map.triggerRepaint();});
            return;
        }
        if(rotation)desiredCenter=rotation;
        else if(before.mode!=='hmc:orthographic'){
            const center=before.map.getCenter();desiredCenter=[center.lng,center.lat];
        }
        const center=mode==='EPSG:3576'?[desiredCenter[0],Math.max(45,desiredCenter[1])]:desiredCenter;
        await viewer.show(mode,{center,zoom:before.map.getZoom()});
        const after=viewer.current();
        const ratio=scale/after.layer.geometry().scale;
        if(Number.isFinite(ratio)&&ratio>0)after.map.setZoom(after.map.getZoom()+Math.log2(ratio));
        await new Promise(resolve=>{after.map.once('render',resolve);after.map.triggerRepaint();});
        document.getElementById('mercator').hidden=true;
    }
    for(const [id,mode] of [['ortho','hmc:orthographic'],['laea','EPSG:3576'],['mercator','mercator']])
        document.getElementById(id).onclick=()=>act(()=>switchMode(mode));
    for(const [id,delta] of [['west',-30],['east',30]])document.getElementById(id).onclick=()=>act(()=>{
        const center=viewer.current().center;
        return switchMode('hmc:orthographic',[((center[0]+delta+540)%360)-180,center[1]]);
    });
    document.getElementById('units').onchange=event=>{
        units=event.target.value;
        viewer.setUnits(units);
    };
    let start,multiTouch=false;
    const pointers=new Set();
    const container=document.getElementById('map');
    container.addEventListener('pointerdown',event=>{
        pointers.add(event.pointerId);
        if(pointers.size>1){multiTouch=true;start=undefined;return;}
        if(viewer.current().mode==='hmc:orthographic'&&!busy){
            start={id:event.pointerId,x:event.clientX,y:event.clientY,center:viewer.current().center};
        }
    });
    container.addEventListener('pointercancel',event=>{
        pointers.delete(event.pointerId);start=undefined;if(!pointers.size)multiTouch=false;
    });
    container.addEventListener('pointermove',event=>{
        if(!start||start.id!==event.pointerId||multiTouch||busy)return;
        const dx=event.clientX-start.x,dy=event.clientY-start.y;
        if(Math.hypot(dx,dy)<5)return;
        if(event.isTrusted&&!start.captured){container.setPointerCapture?.(event.pointerId);start.captured=true;}
        desiredCenter=[((start.center[0]-dx*.2+540)%360)-180,
            Math.max(-90,Math.min(90,start.center[1]+dy*.2))];
        viewer.rotate(desiredCenter);
    });
    container.addEventListener('pointerup',event=>{
        pointers.delete(event.pointerId);
        if(multiTouch){start=undefined;if(!pointers.size)multiTouch=false;return;}
        if(!start||start.id!==event.pointerId)return;
        const {x,y,center}=start;start=undefined;
        const dx=event.clientX-x,dy=event.clientY-y;
        if(Math.hypot(dx,dy)<5)return;
        const next=[((center[0]-dx*.2+540)%360)-180,Math.max(-90,Math.min(90,center[1]+dy*.2))];
        act(()=>switchMode('hmc:orthographic',next));
    });
    window.runInteraction=async()=>{
        const result={views:[],states:[],rotation_settle_ms:[],
            rotation_method:'continuous shared orthographic camera; one Map per mode',
            rotation_frame_scope:'scripted pointermove synchronized to render; trusted Android touch tested separately',
            readiness:'physical Android/iOS acceptance remains separate'};
        await act(()=>switchMode('hmc:orthographic',[20,50]));
        const point=await viewer.pick({lng:37.6173,lat:55.7558});
        const initial=snapshot();
        // A two-finger sequence must not turn into a rotation on the first release.
        const pointer=(type,id,x)=>container.dispatchEvent(new PointerEvent(type,{pointerId:id,clientX:x,clientY:400,bubbles:true}));
        pointer('pointerdown',1,100);pointer('pointerdown',2,200);
        pointer('pointerup',1,120);pointer('pointerup',2,220);
        assert(!busy,'Приближение двумя пальцами вызвало поворот');
        const originalMap=viewer.current().map,frames=[];let previous=performance.now();
        pointer('pointerdown',1,100);
        for(let i=0;i<60;i++)await new Promise(resolve=>{
            originalMap.once('render',()=>{const now=performance.now();frames.push(now-previous);previous=now;resolve();});
            pointer('pointermove',1,110+i*2);
        });
        assert(viewer.current().center[0]!==initial.center[0],'Центр не изменяется во время жеста');
        assert(viewer.current().map===originalMap,'Вращение пересоздаёт карту');
        result.rotation_frame_p95_ms=frames.sort((a,b)=>a-b)[Math.floor(frames.length*.95)];
        result.rotation_same_map=true;
        result.drag_view=viewer.current().layer.samples();
        result.drag_view.controls=viewer.contextControls();
        result.drag_view.controls.push(...[[37.6173,55.7558],[30.3158,59.9391]].map(point=>{
            const pixel=viewer.current().layer.project(point),dpr=originalMap.getCanvas().width/originalMap.getContainer().clientWidth;
            return {point,pixel:[pixel.x*dpr,pixel.y*dpr]};
        }));
        result.views.push(result.drag_view);
        pointer('pointercancel',1,230);
        await act(()=>switchMode('hmc:orthographic',initial.center));
        document.getElementById('units').value='°C';
        document.getElementById('units').dispatchEvent(new Event('change'));
        assert(status.textContent.includes((point.value-273.15).toFixed(2)+' °C'),'Значение не переведено в °C');
        const check=()=>{
            const state=snapshot();result.states.push(state);
            assert(JSON.stringify(state.selection)===JSON.stringify(initial.selection),'Изменилась выборка');
            assert(state.units==='°C','Потеряны единицы');
            assert(state.position.lng===initial.position.lng&&state.position.lat===initial.position.lat,'Потеряна точка');
            return state;
        };
        for(const center of [[10,40],[30,60],[170,0],[90,90]]){
            const start=performance.now();await act(()=>switchMode('hmc:orthographic',center));
            result.rotation_settle_ms.push(performance.now()-start);
            const state=check();
            if(center[0]===170)assert(state.marker_hidden&&state.visibility_message.includes('горизонтом'),'Нет сообщения за горизонтом: '+JSON.stringify(state));
            const view=viewer.current().layer.samples();view.controls=viewer.contextControls();result.views.push(view);
        }
        document.getElementById('laea').click();await pending;check();
        // A point outside the polar cap remains selected through a mode change.
        await viewer.pick({lng:20,lat:40});
        assert(snapshot().marker_hidden&&snapshot().visibility_message.includes('45°'),'Нет сообщения вне LAEA');
        document.getElementById('ortho').click();await pending;
        assert(viewer.current().position.lat===40,'Потеряна точка вне LAEA');
        // Explicit fallback is exercised as a user choice, never a silent substitute.
        failure();
        assert(!document.getElementById('mercator').hidden&&viewer.current().mode==='hmc:orthographic','Тихая подмена режима');
        document.getElementById('mercator').click();await pending;
        result.fallback={mode:viewer.current().mode,position:viewer.current().position};
        result.fallback.failure_injection=true;
        assert(result.fallback.mode==='mercator'&&result.fallback.position.lat===40,'Потеряно состояние fallback');
        result.views.push(viewer.current().layer.samples());
        await viewer.pick(initial.position);
        await act(()=>switchMode('hmc:orthographic',[20,50]));
        result.status='interaction-checks-passed';return result;
    };
}
