// Diagnostic seam: execute the real interaction module with a recording viewer.
// This tests gesture dispatch only; it does not validate browser/GPU rendering.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const elements=new Map();
function element(id){
    if(!elements.has(id))elements.set(id,{
        textContent:'',hidden:false,listeners:new Map(),append(){},
        querySelector(){return element('strong');},
        addEventListener(type,fn){this.listeners.set(type,fn);},
        dispatch(type,event){this.listeners.get(type)?.(event);}
    });
    return elements.get(id);
}
globalThis.document={getElementById:element,createElement:()=>element('controls')};
globalThis.window={};
const source=await readFile('tools/display-projections/interaction.js');
const {installInteraction}=await import('data:text/javascript;base64,'+source.toString('base64'));
let calls=0;
const state={mode:'hmc:orthographic',center:[20,50],
    map:{getZoom:()=>0,setZoom(){},once:(_,fn)=>fn(),triggerRepaint(){}},
    layer:{geometry:()=>({scale:1})}};
installInteraction({current:()=>state,show:async(mode,{center})=>{calls++;state.mode=mode;state.center=center;},setUnits(){}});
const container=element('map');
container.dispatch('pointerdown',{pointerId:1,clientX:100,clientY:100});
for(let x=110;x<=200;x+=10)container.dispatch('pointermove',{pointerId:1,clientX:x,clientY:100});
await new Promise(setImmediate);
const during={calls,center:[...state.center]};
container.dispatch('pointerup',{pointerId:1,clientX:200,clientY:100});
await new Promise(setImmediate);
const after={calls,center:[...state.center]};
const pass=during.calls>0&&during.center[0]!==20;
const result={scope:'real gesture-handler seam with recording viewer; no GPU/browser',
    source_sha256:createHash('sha256').update(source).digest('hex'),during,after,pass};
const output=process.argv[2];
if(output)await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(`${pass?'PASS':'FAIL'} rotation before release: calls=${during.calls}, center=${during.center}; after release: calls=${after.calls}, center=${after.center}`);
process.exitCode=pass?0:1;
