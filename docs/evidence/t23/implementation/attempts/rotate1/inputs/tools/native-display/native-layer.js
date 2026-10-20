// One native bilinear interpolation; no intermediate Mercator raster.
export const nativeToWgs=lat=>Math.atan2(Math.sin(lat*Math.PI/180),(1-.0066943799901413165)*Math.cos(lat*Math.PI/180))*180/Math.PI;
const vertex = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}`;
const fragment = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray field;
uniform vec2 origin;
uniform float scale;
uniform float height;
uniform int mode;
uniform vec2 orthoCenter;
uniform bool numeric;
uniform bool geometryOnly;
out vec4 color;
const float pi=3.141592653589793;
// Range-reduced odd Taylor polynomial avoids implementation-specific atan2
// approximations that exceeded the numeric budget on the measured D3D11 GPU.
float preciseAtan(float z){
    bool reciprocal=abs(z)>1.;float s=reciprocal?1./abs(z):abs(z);
    bool reduce=s>0.414213562373095;
    float t=reduce?(s-1.)/(s+1.):s,v=t*t;
    float a=t*(1.+v*(-1./3.+v*(1./5.+v*(-1./7.+v*(1./9.+v*(-1./11.+v*(1./13.+v*(-1./15.+v/17.))))))));
    if(reduce)a+=pi/4.;if(reciprocal)a=pi/2.-a;return z<0.?-a:a;
}
float preciseAtan2(float y,float x){
    if(x==0.)return y==0.?0.:(y>0.?pi/2.:-pi/2.);
    float a=preciseAtan(y/x);return x<0.?a+(y>=0.?pi:-pi):a;
}
float preciseAsin(float x){return preciseAtan2(x,sqrt(max(0.,(1.-x)*(1.+x))));}
vec2 position(vec2 p){
    if(mode==2)return vec2(p.x/6378137.,2.*preciseAtan(exp(p.y/6378137.))-pi/2.)*180./pi;
    if(mode==0){
        vec2 v=p/6378137.;float rho=length(p);
        if(rho>6378137.)return vec2(1000.);
        float co=sqrt(max(0.,(6378137.-rho)*(6378137.+rho)))/6378137.;
        float phi0=orthoCenter.y*pi/180.;
        float north=co*cos(phi0)-v.y*sin(phi0);
        float up=co*sin(phi0)+v.y*cos(phi0);
        float lat=preciseAtan2(up,length(vec2(north,v.x)));
        float lon=orthoCenter.x*pi/180.+preciseAtan2(v.x,north);
        return vec2(lon,lat)*180./pi;
    }
    float e2=0.0066943799901413165,e=sqrt(e2),a=6378137.;
    float qp=1.-(1.-e2)/(2.*e)*log((1.-e)/(1.+e));
    float q=qp-dot(p/a,p/a);
    if(abs(q)>qp)return vec2(1000.);
    float beta=preciseAsin(clamp(q/qp,-1.,1.));
    float e4=e2*e2,e6=e4*e2;
    float phi=beta+(e2/3.+31.*e4/180.+517.*e6/5040.)*sin(2.*beta)
        +(23.*e4/360.+251.*e6/3780.)*sin(4.*beta)+(761.*e6/45360.)*sin(6.*beta);
    float lon=pi/2.+preciseAtan2(p.x,-p.y);
    return vec2(lon,phi)*180./pi;
}
void main(){
    vec2 p=vec2(gl_FragCoord.x-origin.x,height-gl_FragCoord.y-origin.y)/scale;
    // MapLibre's screen y grows down; projected y grows up.
    p.y=-p.y;
    vec2 geo=position(p);
    bool visible=abs(geo.y)<=90.;
    geo.x=mod(geo.x+180.,360.)-180.;
    if(geometryOnly){color=vec4(geo,visible&&!(mode==1&&geo.y<45.)?1.:0.,1.);return;}
    float phi=geo.y*pi/180.;
    float native=preciseAtan2((1.-0.0066943799901413165)*sin(phi),cos(phi))*180./pi;
    if(geo.x< -23.53125||geo.x>=62.53125||native<29.46875||native>=70.53125
        ||(mode==1&&geo.y<45.)){color=vec4(0.);return;}
    vec2 f=clamp(vec2((geo.x+23.5)*16.,(native-29.5)*16.),vec2(0.),vec2(1376.,656.));
    ivec2 i=ivec2(floor(f)),block=i/256,local=i-block*256+1;
    vec2 w=fract(f);int layer=block.y*6+block.x;
    vec2 aa=texelFetch(field,ivec3(local,layer),0).rg;
    vec2 ab=texelFetch(field,ivec3(local+ivec2(1,0),layer),0).rg;
    vec2 ba=texelFetch(field,ivec3(local+ivec2(0,1),layer),0).rg;
    vec2 bb=texelFetch(field,ivec3(local+ivec2(1,1),layer),0).rg;
    // Clamp global edge indices instead of sampling missing padding beyond them.
    if(i.x==1376){ab=aa;bb=ba;}
    if(i.y==656){ba=aa;bb=ab;}
    vec4 weights=vec4((1.-w.x)*(1.-w.y),w.x*(1.-w.y),(1.-w.x)*w.y,w.x*w.y);
    if((weights.x>0.&&aa.y==0.)||(weights.y>0.&&ab.y==0.)
       ||(weights.z>0.&&ba.y==0.)||(weights.w>0.&&bb.y==0.)){color=vec4(0.);return;}
    float value=dot(vec4(aa.x,ab.x,ba.x,bb.x),weights);
    float t=clamp((value-230.)/85.,0.,1.);
    color=numeric?vec4(value,1.,geo):vec4(mix(vec3(.1,.25,.85),vec3(1.,.18,.03),t)*.75,.75);
}`;

function shader(gl, type, text) {
    const result=gl.createShader(type);gl.shaderSource(result,text);gl.compileShader(result);
    if(!gl.getShaderParameter(result,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(result));
    return result;
}

export class NativeLayer {
    id='native-temperature';type='custom';renderingMode='2d';
    constructor(blocks, mode, projection, metadata, center=[20,50]) {
        this.center=[...center];this.baseCenter=[...center];this.baseProjection=projection;
        this.blocks=blocks;this.mode=mode;this.projection=projection;
        this.cacheIdentity={contract:metadata.contract,contract_sha256:metadata.contract_sha256,matrix:metadata.matrix,
            crs:metadata.crs,grid:metadata.grid,identity:metadata.identity,selection:metadata.selection,
            source_engine:metadata.engine,renderer_engine:'native-gpu-bilinear/1',
            display_crs:mode,display_definition:mode==='EPSG:3576'?proj4.defs('EPSG:3576'):mode==='mercator'?proj4.defs('EPSG:3857'):
                `+proj=ortho +lat_0=${center[1]} +lon_0=${center[0]} +R=6378137`};
    }
    onAdd(map,gl) {
        this.map=map;this.gl=gl;
        this.checkBudget();
        this.program=gl.createProgram();
        const shaders=[shader(gl,gl.VERTEX_SHADER,vertex),shader(gl,gl.FRAGMENT_SHADER,fragment)];
        for(const s of shaders)gl.attachShader(this.program,s);
        gl.linkProgram(this.program);for(const s of shaders)gl.deleteShader(s);
        if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));
        this.vao=gl.createVertexArray();this.texture=gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY,this.texture);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.texImage3D(gl.TEXTURE_2D_ARRAY,0,gl.RG32F,258,258,18,0,gl.RG,gl.FLOAT,null);
        this.blocks.forEach((bytes,index)=>this.uploadBlock(index,bytes));
    }
    uploadBlock(index,bytes) {
        const start=performance.now();
        const gl=this.gl,values=new Float32Array(bytes,0,258*258),mask=new Uint8Array(bytes,258*258*4);
        const upload=new Float32Array(258*258*2);
        for(let i=0;i<values.length;i++){upload[2*i]=values[i];upload[2*i+1]=mask[i];}
        const decoded=performance.now();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY,this.texture);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY,0,0,0,index,258,258,1,gl.RG,gl.FLOAT,upload);
        gl.finish();
        (this.uploadTimings??=[]).push({index,decode_ms:decoded-start,upload_finish_ms:performance.now()-decoded});
        this.blocks[index]=bytes;
        this.ready=this.blocks.filter(Boolean).length===18;
        if(this.ready)this.map.triggerRepaint();
    }
    geometry() {
        const dpr=this.map.getCanvas().width/this.map.getContainer().clientWidth;
        const center=this.mode==='hmc:orthographic'?this.baseCenter:this.mode==='mercator'?[0,0]:[90,90];
        const origin=this.map.project(center),anchor=this.mode==='hmc:orthographic'?[center[0],center[1]>80?center[1]-10:center[1]+10]:this.mode==='mercator'?[0,10]:[90,80];
        const projected=this.baseProjection.forward(anchor),pixel=this.map.project(anchor);
        return {origin:[origin.x*dpr,origin.y*dpr],scale:-(pixel.y-origin.y)*dpr/projected[1],
            width:this.map.getCanvas().width,height:this.map.getCanvas().height};
    }
    setCenter(center,projection) {
        this.center=[...center];this.projection=projection;
        this.cacheIdentity.display_definition=`+proj=ortho +lat_0=${center[1]} +lon_0=${center[0]} +R=6378137`;
        this.map.triggerRepaint();
    }
    project(point) {
        const g=this.geometry(),p=this.projection.forward(point),dpr=g.width/this.map.getContainer().clientWidth;
        return {x:(g.origin[0]+p[0]*g.scale)/dpr,y:(g.origin[1]-p[1]*g.scale)/dpr};
    }
    checkBudget() {
        const gl=this.gl,width=this.map.getCanvas().width,height=this.map.getCanvas().height;
        const maximum=gl.getParameter(gl.MAX_TEXTURE_SIZE);
        const bytes=5990760+258*258*8+258*258*18*8+width*height*24;
        if(width>maximum||height>maximum||258>maximum||gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)<18
            ||bytes>128*1024**2)throw Error('Размер вида превышает бюджет числовых ресурсов.');
        return bytes;
    }
    draw(gl,numeric,view=this.geometry(),geometryOnly=false) {
        gl.useProgram(this.program);gl.bindVertexArray(this.vao);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D_ARRAY,this.texture);
        const location=name=>gl.getUniformLocation(this.program,name);
        gl.uniform2fv(location('orthoCenter'),this.center);
        gl.uniform1i(location('field'),0);gl.uniform2fv(location('origin'),view.origin);
        gl.uniform1f(location('scale'),view.scale);gl.uniform1f(location('height'),view.height);
        gl.uniform1i(location('mode'),this.mode==='hmc:orthographic'?0:this.mode==='mercator'?2:1);gl.uniform1i(location('numeric'),numeric?1:0);
        gl.uniform1i(location('geometryOnly'),geometryOnly?1:0);
        gl.disable(gl.DEPTH_TEST);gl.disable(gl.STENCIL_TEST);
        numeric?gl.disable(gl.BLEND):gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.drawArrays(gl.TRIANGLES,0,3);
        gl.bindVertexArray(null);return view;
    }
    render(gl) {this.context?.render(this.geometry(),this.center);if(this.ready)this.draw(gl,false);}
    samples(view=this.geometry()) {
        this.checkBudget();
        const gl=this.gl,{width,height}=view;
        if(!gl.getExtension('EXT_color_buffer_float'))throw Error('Нет поддержки числового GPU readback.');
        const before=gl.getParameter(gl.FRAMEBUFFER_BINDING),viewport=gl.getParameter(gl.VIEWPORT),texture=gl.createTexture(),fb=gl.createFramebuffer();
        try {
            gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,null);
            gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
            if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Неполный числовой framebuffer.');
            gl.viewport(0,0,width,height);this.draw(gl,true,view);const samples=[];
            const pixel=new Float32Array(4);
            for(let y=0;y<height;y+=13)for(let x=0;x<width;x+=13){
                gl.readPixels(x,height-1-y,1,1,gl.RGBA,gl.FLOAT,pixel);
                samples.push([x,y,pixel[0],pixel[1],pixel[2],pixel[3]]);
            }
            return {mode:this.mode,center:this.center,...view,samples,upload_timings:this.uploadTimings,
                cache_identity:this.cacheIdentity,gpu_bytes:258*258*18*8+width*height*16};
        } finally {
            gl.bindFramebuffer(gl.FRAMEBUFFER,before);gl.deleteFramebuffer(fb);gl.deleteTexture(texture);
            gl.viewport(...viewport);
            this.map.triggerRepaint();
        }
    }
    positions(points,geometryOnly=true) {
        this.checkBudget();const gl=this.gl;
        if(!gl.getExtension('EXT_color_buffer_float'))throw Error('Нет поддержки числовой проверки GPU.');
        const before=gl.getParameter(gl.FRAMEBUFFER_BINDING),viewport=gl.getParameter(gl.VIEWPORT);
        const texture=gl.createTexture(),fb=gl.createFramebuffer(),pixel=new Float32Array(4),results=[];
        try {
            gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,1,1,0,gl.RGBA,gl.FLOAT,null);
            gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
            if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Неполный синтетический framebuffer.');
            gl.viewport(0,0,1,1);
            for(const [label,x,y] of points){
                const px=Math.fround(x),py=Math.fround(y);
                this.draw(gl,true,{width:1,height:1,origin:[.5-px,.5+py],scale:1},geometryOnly);
                gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,pixel);results.push([label,px,py,pixel[0],pixel[1],pixel[2]]);
            }
            return results;
        } finally {
            gl.bindFramebuffer(gl.FRAMEBUFFER,before);gl.viewport(...viewport);gl.deleteFramebuffer(fb);gl.deleteTexture(texture);
        }
    }
    syntheticMasks() {
        const gl=this.gl,column=696,row=328,blockX=Math.floor(column/256),blockY=Math.floor(row/256);
        const localX=column%256+1,localY=row%256+1,layer=blockY*6+blockX;
        const original=new Float32Array(8),buffer=this.blocks[layer];
        const values=new Float32Array(buffer,0,258*258),mask=new Uint8Array(buffer,258*258*4);
        for(let r=0;r<2;r++)for(let c=0;c<2;c++){
            const i=(localY+r)*258+localX+c,o=(r*2+c)*2;
            original[o]=values[i];original[o+1]=mask[i];
        }
        const upload=data=>{gl.bindTexture(gl.TEXTURE_2D_ARRAY,this.texture);
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY,0,localX,localY,layer,2,2,1,gl.RG,gl.FLOAT,data);};
        const center=this.projection.forward([20.03125,nativeToWgs(50.03125)]);
        const exact=this.projection.forward([20,nativeToWgs(50)]);
        const synthetic=new Float32Array([280,1,282,1,284,1,286,1]);
        try {
            upload(synthetic);const valid=this.positions([['bilinear-center',...center]],false)[0];
            synthetic[6]=0;synthetic[7]=0;upload(synthetic);
            return [valid,...this.positions([['positive-weight-missing',...center],['zero-weight-missing',...exact]],false)]
                .map(sample=>sample.slice(0,5));
        } finally {upload(original);}
    }
    onRemove(map,gl) {this.context?.remove();gl.deleteTexture(this.texture);gl.deleteProgram(this.program);gl.deleteVertexArray(this.vao);}
}
