import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkSourceCRS({call,evaluate,wait,select,click,capture,report,directory,width,height}){
    const viewport={width,height,views:[],canonical_picks:[]};report.viewports.push(viewport);
    for(const [index,mode] of ['mercator','orthographic','laea'].entries()){
        await select('#projection',true,index);
        await wait(`window.captureWeatherEvidence().mode===${JSON.stringify(mode)}&&window.captureWeatherEvidence().ready`,'source CRS mode ready');
        await click('#fit');await new Promise(resolve=>setTimeout(resolve,200));
        const state=await capture(true);
        assert.equal(state.view.cache_identity.contract,'hmc-native-display/2');
        assert.ok(state.view.samples.some(sample=>sample[3]===1),'Rotated field visible in '+mode);
        assert.ok(state.managed_bytes<=128*1024**2);
        viewport.views.push({...state.view,selection:state.selected});
        const container=await evaluate("(()=>{const r=document.getElementById('map').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()");
        let pickedPixel;
        for(const sample of state.view.samples.filter(sample=>sample[3]===1)){
            const x=container.x+sample[0]*container.w/state.view.width,y=container.y+sample[1]*container.h/state.view.height;
            if(await evaluate(`document.elementFromPoint(${x},${y})?.tagName==='CANVAS'`)){pickedPixel={x,y};break;}
        }
        assert.ok(pickedPixel,'Uncovered valid map pixel');
        await call('Input.dispatchMouseEvent',{type:'mousePressed',...pickedPixel,button:'left',clickCount:1});
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',...pickedPixel,button:'left',clickCount:1});
        await wait('Boolean(window.captureWeatherEvidence().point?.cell)','canonical rotated point');
        const picked=await capture();
        assert.ok(picked.point.crs.startsWith('urn:hmc:crs:'));
        assert.notEqual(picked.point.crs,'urn:hmc:crs:icon-sphere-6371229');
        viewport.canonical_picks.push({point:picked.point,position:picked.position});
        const shot=await call('Page.captureScreenshot',{format:'png'});
        await writeFile(join(directory,`source-crs-${width}x${height}-${mode}.png`),Buffer.from(shot.data,'base64'));
        await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});
        await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape'});
    }
    report.checks.push(`${width}x${height}: corrected CRS in three map modes; GPU pixels and canonical points`);
}
