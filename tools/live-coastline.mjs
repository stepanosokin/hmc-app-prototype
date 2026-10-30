import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/** One actual-live browser session, shared with the existing retirement harness. */
export async function checkCoastline({evaluate,call,directory}){
    const cases=[],selection=await evaluate('captureWeatherEvidence().displayed.selection');
    for(const mode of ['laea-rf','mercator','orthographic','laea']){
        await evaluate(`(()=>{const e=document.getElementById('projection');e.value=${JSON.stringify(mode)};e.dispatchEvent(new Event('change'));})()`);
        let ready=false;
        for(let i=0;i<300;i++){
            ready=await evaluate(`(()=>{const s=captureWeatherEvidence();return s.ready&&s.mode===${JSON.stringify(mode)}&&document.querySelectorAll('.coastline').length===1&&document.querySelector('.coastline').width>0;})()`);
            if(ready)break;await new Promise(r=>setTimeout(r,100));
        }
        assert.ok(ready,mode+': actual raster and coastline ready');
        await evaluate("document.getElementById('fit').click()");
        if(mode==='orthographic')await evaluate("document.getElementById('east').click()");
        await evaluate("document.getElementById('zoomOut').click()");
        await new Promise(r=>setTimeout(r,400));
        for(const theme of ['dark','light']){
            await evaluate(`(()=>{const e=document.getElementById('basemap');e.value=${JSON.stringify(theme)};e.dispatchEvent(new Event('change'));})()`);
            await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
            await new Promise(r=>setTimeout(r,350));
            const state=await evaluate(`(()=>{
                const s=captureWeatherEvidence(),canvas=document.querySelector('.coastline');
                const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
                let ink=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])ink++;
                const z=e=>e?Number(getComputedStyle(e).zIndex)||0:null;
                return {mode:s.mode,ready:s.ready,selection:s.displayed.selection,ink,width:canvas.width,height:canvas.height,
                    coastline_z:z(canvas),raster_z:z(document.querySelector('.maplibregl-canvas')),
                    wind_z:z(document.querySelector('.windArrows')),isolines_z:z(document.querySelector('.fieldContours')),
                    above_raster:canvas.parentNode===document.querySelector('.maplibregl-canvas').parentNode&&
                        Boolean(document.querySelector('.maplibregl-canvas').compareDocumentPosition(canvas)&Node.DOCUMENT_POSITION_FOLLOWING),
                    renderer_error:s.renderer_error};
            })()`);
            assert.ok(state.ready,mode+': raster retained');assert.equal(state.selection,selection);
            assert.ok(state.ink>100,mode+': coastline painted');
            assert.ok(state.ink<state.width*state.height*.2,mode+': sparse unfilled lines');
            assert.ok(state.above_raster&&state.coastline_z>=state.raster_z,mode+': above raster');
            if(state.wind_z!==null)assert.ok(state.wind_z>state.coastline_z,mode+': below wind');
            assert.ok(state.isolines_z>state.coastline_z,mode+': below isolines');
            assert.equal(state.renderer_error,'');
            const screenshot=await call('Page.captureScreenshot',{format:'png'});
            await writeFile(join(directory,`${mode}-${theme}.png`),Buffer.from(screenshot.data,'base64'));
            cases.push({theme,...state});
        }
    }
    return {cases,scope:'One desktop Chrome session, four projections, two themes; zoom and globe rotation; actual live raster. Boundary appearance requires screenshot inspection.'};
}
