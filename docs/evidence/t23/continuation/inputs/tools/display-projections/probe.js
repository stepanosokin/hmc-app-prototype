import * as maplibre from '/vendor/maplibre-gl.mjs';

const status = document.getElementById('status');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [];
window.probeErrors = errors;
const workerReady=maplibre.importScriptInWorkers(new URL('/worker-projection.mjs',location.href).href);
const definition = '+proj=laea +lat_0=90 +lon_0=90 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs';
proj4.defs('EPSG:3576', definition);
const laea = proj4('EPSG:4326', 'EPSG:3576');
maplibre.addProjection({name:'EPSG:3576', projection:laea, definition,
    tileMatrixSet:{origin:[-5000000,5000000],extentAtZoom0:10000000}});
const land = {type:'Feature',properties:{},geometry:{type:'MultiPolygon',coordinates:window.land}};
let map;
function clippedLand(center,angle) {
    const rotation=d3.geoRotation([-center[0],-center[1]]);
    const polygons=[];let polygon,ring;
    const sink={polygonStart(){polygon=[];},polygonEnd(){if(polygon.length)polygons.push(polygon);},
        lineStart(){ring=[];},lineEnd(){if(ring.length>=3){ring.push(ring[0]);polygon.push(ring);}},
        point(lon,lat){ring.push(rotation.invert([lon*180/Math.PI,lat*180/Math.PI]));}};
    const clip=d3.geoClipCircle(angle*Math.PI/180)(sink);
    const stream={polygonStart(){clip.polygonStart();},polygonEnd(){clip.polygonEnd();},
        lineStart(){clip.lineStart();},lineEnd(){clip.lineEnd();},
        point(lon,lat){const p=rotation([lon,lat]);clip.point(p[0]*Math.PI/180,p[1]*Math.PI/180);}};
    d3.geoStream(land,stream);
    return {type:'Feature',properties:{},geometry:{type:'MultiPolygon',coordinates:polygons}};
}
// Clip geographic lines before the CRS transform, just like the local land.
export function clippedLine(coordinates,center,angle) {
    const rotation=d3.geoRotation([-center[0],-center[1]]),lines=[];let line;
    const sink={lineStart(){line=[];},lineEnd(){if(line.length>1)lines.push(line);},
        point(lon,lat){line.push(rotation.invert([lon*180/Math.PI,lat*180/Math.PI]));}};
    const clip=d3.geoClipCircle(angle*Math.PI/180)(sink);
    d3.geoStream({type:'LineString',coordinates},{lineStart(){clip.lineStart();},lineEnd(){clip.lineEnd();},
        point(lon,lat){const p=rotation([lon,lat]);clip.point(p[0]*Math.PI/180,p[1]*Math.PI/180);}});
    return {type:'Feature',properties:{},geometry:{type:'MultiLineString',coordinates:lines}};
}
export async function create(type, center=[0,0], zoom=0) {
    await workerReady;
    map?.remove();
    let data=land,water=null;
    if(type==='hmc:orthographic') {
        maplibre.removeProjection(type);
        const definition=`+proj=ortho +lat_0=${center[1]} +lon_0=${center[0]} +R=6378137 +units=m +no_defs`;
        maplibre.addProjection({name:type,definition,projection:proj4('EPSG:4326',definition),
            tileMatrixSet:{origin:[-6378137,6378137],extentAtZoom0:12756274}});
        data=clippedLand(center,89.99999);
        water=d3.geoCircle().center(center).radius(89.99999).precision(.5)();
    } else if(type==='EPSG:3576') {
        data=clippedLand([90,90],45);
        water=d3.geoCircle().center([90,90]).radius(45).precision(.5)();
    }
    map = new maplibre.Map({container:'map',center,zoom,minZoom:-2,attributionControl:false,
        dragPan:type!=='hmc:orthographic',pitchWithRotate:false,maxPitch:0,
        canvasContextAttributes:{preserveDrawingBuffer:true},
        style:{version:8,projection:{type},sources:{land:{type:'geojson',data},
            ...(water?{water:{type:'geojson',data:water}}:{})},layers:[
            {id:'background',type:'background',paint:{'background-color':water?'#102840':'#244c6c'}},
            ...(water?[{id:'water',type:'fill',source:'water',paint:{'fill-color':'#244c6c'}}]:[]),
            {id:'land',type:'fill',source:'land',paint:{'fill-color':'#91b195'}}]}});
    map.on('error', e=>errors.push(String(e.error)));
    await Promise.race([map.once('idle'),delay(15000).then(()=>{throw Error('Карта не завершила загрузку');})]);
    return map;
}

// The independent orthographic reference is x = R sin(longitude), at latitude 0.
// Taking a ratio removes camera scale, viewport size and the assumed radius.
window.runProbe = async () => {
    const results = {maplibre:maplibre.getVersion(),proj4:proj4.version,errors,geometry:[],
        synthetic_scope:'equatorial angular positions only; not published forecast products',
        laea:{definition,experimental_matrix:{origin:[-5000000,5000000],extentAtZoom0:10000000},
            matrix_status:'probe-only; not a published server tile matrix',coordinates:[]}};
    for (const type of ['globe','vertical-perspective']) {
        await create(type);
        for (const zoom of [0,2,5,10,12]) {
            map.jumpTo({center:[0,0],zoom});
            await delay(500);
            const origin = map.project([0,0]);
            const points = [15,30,45,60].map(lon=>({lon,x:map.project([lon,0]).x-origin.x}));
            const ratio = points[3].x/points[1].x;
            results.geometry.push({type,zoom,points,ratio_60_30:ratio,
                orthographic_ratio:Math.sqrt(3),absolute_ratio_error:Math.abs(ratio-Math.sqrt(3)),
                strict_orthographic:Math.abs(ratio-Math.sqrt(3))<1e-6});
        }
    }
    await create('mercator');
    const before = errors.length;
    let thrown = null;
    try { map.setProjection({type:'orthographic'}); } catch(error) { thrown=String(error); }
    await delay(200);
    const origin = map.project([0,0]);
    const ratio = (map.project([60,0]).x-origin.x)/(map.project([30,0]).x-origin.x);
    results.orthographic_api = {thrown,errors:errors.slice(before),reported:map.getProjection(),
        measured_ratio_60_30:ratio,orthographic_ratio:Math.sqrt(3),
        strict_orthographic:Math.abs(ratio-Math.sqrt(3))<1e-6};
    results.registered_orthographic={geometry:[],model:'WGS84 geodetic angles on display sphere R=6378137m; flat MapLibre camera, pitch=0; sphere scale zoom only',
        clipping:'D3 spherical small-circle clipping of local basemap; MapLibre/proj4 render it',
        limitations:'Map recreation per rotation; not a validated interactive viewer or performance-ready path'};
    for(const center of [[0,0],[170,50],[90,90]]) {
        await create('hmc:orthographic',center);
        for(const zoom of [0,2]) {
            map.jumpTo({zoom});await delay(100);
            const lat0=center[1]*Math.PI/180,lon0=center[0]*Math.PI/180;
            const origin=map.project(center),scale=(map.project([center[0]+30,0]).x-origin.x)/(6378137*.5);
            const checks=[];
            // Independently evaluate orthographic forward formula and inverse pick.
            for(const point of [[center[0]+15,Math.max(-80,center[1]-10)],[center[0]+45,Math.max(-80,center[1]-25)]]) {
                const lon=point[0]*Math.PI/180,lat=point[1]*Math.PI/180;
                const x=6378137*Math.cos(lat)*Math.sin(lon-lon0);
                const y=6378137*(Math.cos(lat0)*Math.sin(lat)-Math.sin(lat0)*Math.cos(lat)*Math.cos(lon-lon0));
                const p=map.project(point),picked=map.unproject(p);
                checks.push({point,pixel:[p.x,p.y],reference_pixel:[origin.x+scale*x,origin.y-scale*y],
                    pixel_error:Math.hypot(p.x-origin.x-scale*x,p.y-origin.y+scale*y),
                    inverse:[picked.lng,picked.lat]});
            }
            results.registered_orthographic.geometry.push({center,zoom,checks});
        }
    }
    results.registered_orthographic.max_shape_error_pixels=Math.max(...results.registered_orthographic.geometry.flatMap(g=>g.checks.map(c=>c.pixel_error)));
    if(!Number.isFinite(results.registered_orthographic.max_shape_error_pixels)||results.registered_orthographic.max_shape_error_pixels>.001)
        throw Error('Ортография отличается от независимого геометрического эталона');
    await create('EPSG:3576',[90,90],0);
    for (const point of [[90,90],[90,45],[0,45],[180,45],[-180,45],[37.6173,55.7558]]) {
        const projected = laea.forward(point);
        const pixel = map.project(point);
        const inverse = map.unproject(pixel);
        results.laea.coordinates.push({point,projected,pixel:[pixel.x,pixel.y],inverse:[inverse.lng,inverse.lat]});
    }
    const gl = map.getCanvas().getContext('webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    results.renderer = debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    results.webgl_version = gl.getParameter(gl.VERSION);
    const referenceResponse = await fetch('/reference.json');
    if(referenceResponse.ok) {
        const reference = await referenceResponse.json();
        results.laea.max_reference_error_m = Math.max(...results.laea.coordinates.map((p,i)=>
            Math.hypot(...p.projected.map((v,j)=>v-reference.crs.coordinates[i].projected[j]))));
        results.numeric = await numericProbe(reference);
    }
    results.status = 'compatibility-probe-complete';
    results.acceptance = 'incomplete: registered orthographic geometry candidate only; projected numeric field and performance remain unverified';
    status.textContent = 'T23 · EPSG:3576 · проверка подложки. Область продукта: от 45° с. ш. ' +
        'Числовой слой здесь не отрисован. Строгий ортографический глобус не подтверждён.';
    window.probeResult = results;
    return results;
};
window.showProbe = async type => {
    await create(type,type==='EPSG:3576'?[90,90]:[20,50],0);
    status.textContent = type==='EPSG:3576'
        ? 'EPSG:3576 · техническая подложка. Показ продукта ограничен 45° с. ш. Числовой слой не отрисован.'
        : type==='hmc:orthographic'?'Ортография · экспериментальный CRS MapLibre, сфера. Числовой слой не отрисован; рабочая карта не подтверждена.'
        : 'Штатный глобус MapLibre · перспективная камера. Строгая ортография не выполнена. Числовой слой не отрисован.';
};
window.probeReady = true;

async function numericProbe(reference) {
    const canvas = document.createElement('canvas');canvas.width=canvas.height=1;
    const gl = canvas.getContext('webgl2');
    if(!gl?.getExtension('EXT_color_buffer_float'))return {status:'unsupported',reason:'Нет EXT_color_buffer_float'};
    const compile = (type,source)=>{
        const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
        return shader;
    };
    const vertex=compile(gl.VERTEX_SHADER,`#version 300 es
        void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}`);
    const fragment=compile(gl.FRAGMENT_SHADER,`#version 300 es
        precision highp float;uniform sampler2D field;uniform vec2 position;out vec4 result;
        void main(){ivec2 p=ivec2(floor(position));vec2 f=fract(position);float value=0.;float valid=1.;
        for(int y=0;y<2;y++)for(int x=0;x<2;x++){
            float weight=(x==0?1.-f.x:f.x)*(y==0?1.-f.y:f.y);
            vec2 s=texelFetch(field,p+ivec2(x,y),0).rg;
            if(weight>0. && s.g<.5)valid=0.;value+=weight*s.r;
        }result=vec4(valid>.5?value:0.,valid,0,1);}`);
    const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const output=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,output);
    gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32F,1,1);
    const framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Неполный float framebuffer');
    gl.viewport(0,0,1,1);
    const input=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,input);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    const measurements=[],observations=[];
    let maximum=0,masks=0,count=0,gpuArithmeticError=0;
    try {
        for(const tile of reference.tiles) {
            const start=performance.now();
            const response=await fetch(tile.url);if(!response.ok)throw Error('Числовой тайл недоступен');
            const bytes=await response.arrayBuffer();const downloaded=performance.now();
            const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
            if(digest!==tile.sha256)throw Error('Изменились байты числового тайла');
            const hashed=performance.now();
            const field=new Float32Array(bytes,0,258*258),valid=new Uint8Array(bytes,258*258*4);
            const decoded=new Float32Array(258*258*2);
            for(let i=0;i<field.length;i++){decoded[i*2]=field[i];decoded[i*2+1]=valid[i];}
            const unpacked=performance.now();
            gl.texImage2D(gl.TEXTURE_2D,0,gl.RG32F,258,258,0,gl.RG,gl.FLOAT,decoded);gl.finish();
            const uploaded=performance.now();
            const selected=reference.samples.filter(sample=>sample.tile===tile.file);
            const position=gl.getUniformLocation(program,'position');const pixel=new Float32Array(4);
            for(const sample of selected) {
                gl.uniform2fv(position,sample.texel);gl.drawArrays(gl.TRIANGLES,0,3);
                gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,pixel);
                const hasValue=pixel[1]>.5;
                observations.push({tile:tile.file,texel:sample.texel,value:hasValue?pixel[0]:null,expected:sample.expected});
                if(hasValue&&sample.f32_bilinear_reference!==null)gpuArithmeticError=Math.max(gpuArithmeticError,
                    Math.abs(pixel[0]-sample.f32_bilinear_reference));
                if(hasValue!==(sample.expected!==null))masks++;
                if(hasValue&&sample.expected!==null){maximum=Math.max(maximum,Math.abs(pixel[0]-sample.expected));count++;}
            }
            const error=gl.getError();if(error!==gl.NO_ERROR)throw Error('WebGL error '+error);
            measurements.push({zxy:tile.zxy,bytes:bytes.byteLength,request_ms:downloaded-start,
                sha256_ms:hashed-downloaded,decode_ms:unpacked-hashed,upload_and_finish_ms:uploaded-unpacked,
                decoded_bytes:decoded.byteLength,gpu_input_bytes:decoded.byteLength,
                scope:'one texture and synchronous numeric readback; not a viewer frame benchmark'});
        }
        return {status:'probe-complete',selection:reference.selection.selection,measurements,
            observations,max_gpu_vs_f32_reference_error_K:gpuArithmeticError,
            valid_comparisons:count,mask_differences:masks,max_total_abs_error_K:maximum,
            total_bound_K:.01,within_total_budget:maximum<=.01&&masks===0,
            method:'GPU bilinear of existing v2 f32 tiles versus raw-GRIB bilinear at the same WGS84 coordinate',
            caveat:'No projected weather mesh rendered; no orthographic/LAEA acceptance claim'};
    } finally {
        gl.deleteTexture(input);gl.deleteTexture(output);gl.deleteFramebuffer(framebuffer);
        gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
}
