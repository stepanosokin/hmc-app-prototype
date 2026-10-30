/** Real WebGL 2 colour readback against the frozen current-earth reference. */
export async function checkPaletteFixtures(evaluate,origin){
    return evaluate(`(${String(paletteFixtures)})(${JSON.stringify(origin)})`);
}

async function paletteFixtures(origin){
    const {NativeLayer}=await import(origin+'/build/native-layer.js');
    const {nativePosition}=await import(origin+'/build/source-crs.js');
    const {specs}=await(await fetch(origin+'/wind-reference.json')).json();
    const reference=await(await fetch(origin+'/earth-palette-reference.json')).json();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const gl=canvas.getContext('webgl2',{premultipliedAlpha:true,antialias:false});
    if(!gl)throw Error('WebGL 2 unavailable');
    const map={getCanvas:()=>canvas,triggerRepaint(){}};
    const geo=nativePosition(specs[0],[1,1],true),p=proj4('EPSG:3857').forward(geo);
    const results=[];
    try{
        for(const [name,scale] of Object.entries(reference.palettes)){
            scale.colors=Array.from({length:250},(_,i)=>{
                const index=Math.floor(i/249*(scale.colors.length/4-1)+.5)*4;
                return scale.colors.slice(index,index+4);
            }).flat();
            const block=new ArrayBuffer(332820),values=new Float32Array(block,0,258*258),mask=new Uint8Array(block,258*258*4);mask.fill(1);
            const metadata={palette:{id:name,version:reference.version,...scale},source_crs:specs[0],grid:{shape_yx:[2,2],
                spacing_degrees_xy:[1,1],outer_cell_edges_wsen:[0,0,2,2]},columns:[0,0],display_range:scale.range};
            const layer=new NativeLayer([block],'mercator',proj4('EPSG:3857'),metadata);
            try{
                layer.onAdd(map,gl);gl.viewport(0,0,1,1);
                const [low,high]=scale.range;
                for(const fraction of [-.2,0,.125,.5,.875,1,1.2]){
                    const value=Math.fround(low+(high-low)*fraction);values.fill(value);layer.uploadBlock(0,block);
                    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
                    layer.draw(gl,false,{width:1,height:1,origin:[.5-p[0],.5+p[1]],scale:1});
                    const pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
                    const index=Math.floor(Math.max(0,Math.min(1,(value-low)/(high-low)))*(scale.colors.length/4-1))*4;
                    const expected=scale.colors.slice(index,index+3).map(v=>v*.8);
                    const error=Math.max(...expected.map((v,i)=>Math.abs(v-pixel[i])),Math.abs(pixel[3]-204));
                    if(error>1.1)throw Error(`GPU palette ${name}, value ${value}: ${[...pixel]} expected ${expected},204`);
                    results.push({palette:name,value,pixel:[...pixel],maximum_error:error});
                }
                if(gl.getError()!==gl.NO_ERROR)throw Error('GPU colour check produced WebGL errors');
            }finally{layer.onRemove(map,gl);}
        }
        const debug=gl.getExtension('WEBGL_debug_renderer_info');
        return {status:'passed',checks:results,renderer:gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),
            gpu:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'Not exposed'};
    }finally{gl.getExtension('WEBGL_lose_context')?.loseContext();canvas.remove();}
}
