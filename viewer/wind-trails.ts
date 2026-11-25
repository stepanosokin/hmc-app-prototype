const SEGMENT_FLOATS=5;
const STATE_FLOATS=4;
const MAX_STATE_WIDTH=1024;
const CORNERS=new Float32Array([-1,-1,-1,1,1,-1,1,1]);
export const TRAIL_SEGMENTS=1024;
export const TRAIL_DECAY_SECONDS=5;

const stateWidth=(particles:number)=>Math.min(particles,MAX_STATE_WIDTH);
const stateHeight=(particles:number)=>Math.ceil(particles/stateWidth(particles));

export function trailBytes(particles:number){
    // GPU history, per-particle state on both sides and one CPU upload row.
    const segmentFloats=particles*(TRAIL_SEGMENTS+1)*SEGMENT_FLOATS;
    const stateFloats=stateWidth(particles)*stateHeight(particles)*STATE_FLOATS*2;
    return (segmentFloats+stateFloats)*Float32Array.BYTES_PER_ELEMENT+
        TRAIL_SEGMENTS*Float64Array.BYTES_PER_ELEMENT+CORNERS.byteLength;
}

const vertexSource=`#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec4 endpoints;
layout(location=1) in float birth;
layout(location=2) in vec2 corner;
uniform highp sampler2D particles;
uniform vec2 viewport;
uniform float radius;
uniform float lifetime;
uniform float decay;
uniform int count;
uniform int stateWidth;
uniform int firstFrame;
out vec2 local;
flat out float segmentLength;
flat out float opacity;

void main() {
    int frame = firstFrame + gl_InstanceID / count;
    int index = gl_InstanceID % count;
    vec4 particle = texelFetch(particles, ivec2(index % stateWidth, index / stateWidth), 0);
    float age = birth - 1.0;
    float alpha = min(1.0, age * 5.0) * 0.65 * exp(-(particle.x - age) * lifetime / decay) * particle.y;
    opacity = floor(alpha * 32.0 + 0.5) / 32.0;
    vec2 delta = endpoints.zw - endpoints.xy;
    segmentLength = length(delta);
    if (birth == 0.0 || float(frame) < -particle.z || opacity <= 0.0 || segmentLength == 0.0) {
        gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
        return;
    }
    vec2 direction = delta / segmentLength;
    vec2 normal = vec2(-direction.y, direction.x);
    float edge = radius + 0.5;
    local = vec2(corner.x < 0.0 ? -edge : segmentLength + edge, corner.y * edge);
    vec2 point = endpoints.xy + direction * local.x + normal * local.y;
    gl_Position = vec4(point / viewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

const fragmentSource=`#version 300 es
precision highp float;
uniform float radius;
in vec2 local;
flat in float segmentLength;
flat in float opacity;
out vec4 color;

void main() {
    float distanceToTrail = length(vec2(local.x - clamp(local.x, 0.0, segmentLength), local.y));
    float alpha = opacity * clamp(radius + 0.5 - distanceToTrail, 0.0, 1.0);
    color = alpha * vec4(238.0/255.0, 246.0/255.0, 1.0, 1.0);
}`;

function program(gl:WebGL2RenderingContext){
    const result=gl.createProgram();
    if(!result)throw Error('Не удалось создать программу отрисовки ветра.');
    try{
        for(const [kind,source] of [[gl.VERTEX_SHADER,vertexSource],[gl.FRAGMENT_SHADER,fragmentSource]] as const){
            const shader=gl.createShader(kind);
            if(!shader)throw Error('Не удалось создать шейдер следов ветра.');
            try{
                gl.shaderSource(shader,source);
                gl.compileShader(shader);
                if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader)??'Ошибка компиляции шейдера ветра.');
                gl.attachShader(result,shader);
            }finally{gl.deleteShader(shader);}
        }
        gl.linkProgram(result);
        if(!gl.getProgramParameter(result,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(result)??'Ошибка компоновки шейдеров ветра.');
        return result;
    }catch(error){gl.deleteProgram(result);throw error;}
}

/** One GPU ring row per animated frame, with one slot per particle in each row. */
export class WindTrails {
    frame=0;
    private readonly gl:WebGL2RenderingContext;
    private readonly count:number;
    private readonly lifetime:number;
    private readonly stateWidth:number;
    private readonly stateHeight:number;
    private readonly times=new Float64Array(TRAIL_SEGMENTS);
    private time=0;
    private first=0;
    private readonly segments:Float32Array;
    private readonly particles:Float32Array;
    private readonly shader:WebGLProgram;
    private readonly history:WebGLBuffer;
    private readonly corners:WebGLBuffer;
    private readonly state:WebGLTexture;
    private readonly firstFrame:WebGLUniformLocation|null;
    private readonly viewport:WebGLUniformLocation|null;
    private readonly radius:WebGLUniformLocation|null;

    constructor(gl:WebGL2RenderingContext,count:number,lifetime:number){
        this.gl=gl;
        this.count=count;
        this.lifetime=lifetime;
        this.stateWidth=stateWidth(count);
        this.stateHeight=stateHeight(count);
        this.segments=new Float32Array(count*SEGMENT_FLOATS);
        this.particles=new Float32Array(this.stateWidth*this.stateHeight*STATE_FLOATS);
        this.shader=program(gl);
        const history=gl.createBuffer(),corners=gl.createBuffer(),state=gl.createTexture();
        try{
            if(!history||!corners||!state)throw Error('Не удалось выделить буферы следов ветра.');
            this.history=history;
            this.corners=corners;
            this.state=state;
            gl.useProgram(this.shader);
            this.firstFrame=gl.getUniformLocation(this.shader,'firstFrame');
            this.viewport=gl.getUniformLocation(this.shader,'viewport');
            this.radius=gl.getUniformLocation(this.shader,'radius');
            gl.uniform1i(gl.getUniformLocation(this.shader,'particles'),0);
            gl.uniform1i(gl.getUniformLocation(this.shader,'count'),count);
            gl.uniform1i(gl.getUniformLocation(this.shader,'stateWidth'),this.stateWidth);
            gl.uniform1f(gl.getUniformLocation(this.shader,'lifetime'),lifetime);
            gl.uniform1f(gl.getUniformLocation(this.shader,'decay'),TRAIL_DECAY_SECONDS);
            gl.bindBuffer(gl.ARRAY_BUFFER,corners);
            gl.bufferData(gl.ARRAY_BUFFER,CORNERS,gl.STATIC_DRAW);
            gl.enableVertexAttribArray(2);
            gl.vertexAttribPointer(2,2,gl.FLOAT,false,0,0);
            gl.bindBuffer(gl.ARRAY_BUFFER,history);
            gl.bufferData(gl.ARRAY_BUFFER,this.segments.byteLength*TRAIL_SEGMENTS,gl.DYNAMIC_DRAW);
            gl.bindTexture(gl.TEXTURE_2D,state);
            gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32F,this.stateWidth,this.stateHeight);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
            gl.enableVertexAttribArray(0);
            gl.enableVertexAttribArray(1);
            gl.vertexAttribDivisor(0,1);
            gl.vertexAttribDivisor(1,1);
            gl.enable(gl.BLEND);
            // Adjacent round caps overlap. Accumulating their opacity would
            // brighten slow trails as frame rate rises.
            gl.blendEquation(gl.MAX);
            if(gl.getError()!==gl.NO_ERROR)throw Error('Не удалось выделить память для следов ветра.');
        }catch(error){gl.deleteBuffer(history);gl.deleteBuffer(corners);gl.deleteTexture(state);gl.deleteProgram(this.shader);throw error;}
    }

    begin(){this.segments.fill(0);}

    segment(particle:number,x0:number,y0:number,x1:number,y1:number,age:number){
        const index=particle*SEGMENT_FLOATS;
        this.segments[index]=x0;
        this.segments[index+1]=y0;
        this.segments[index+2]=x1;
        this.segments[index+3]=y1;
        this.segments[index+4]=age+1;
    }

    particle(index:number,age:number,opacity:number,start:number){
        const offset=index*STATE_FLOATS;
        this.particles[offset]=age;
        this.particles[offset+1]=opacity;
        this.particles[offset+2]=Math.min(this.frame-start,TRAIL_SEGMENTS-1);
    }

    clear(){this.frame=0;this.first=0;this.time=0;this.gl.clear(this.gl.COLOR_BUFFER_BIT);}

    draw(width:number,height:number,dpr:number,dt:number){
        const gl=this.gl;
        const row=this.frame%TRAIL_SEGMENTS;
        gl.bufferSubData(gl.ARRAY_BUFFER,row*this.segments.byteLength,this.segments);
        gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,this.stateWidth,this.stateHeight,gl.RGBA,gl.FLOAT,this.particles);
        gl.viewport(0,0,width,height);
        gl.uniform2f(this.viewport,width,height);
        gl.uniform1f(this.radius,.325*dpr);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this.time+=dt;
        this.times[row]=this.time;
        this.first=Math.max(this.first,++this.frame-TRAIL_SEGMENTS);
        while(this.time-this.times[this.first%TRAIL_SEGMENTS]>this.lifetime)this.first++;
        const rows=this.frame-this.first;
        const firstRow=this.first%TRAIL_SEGMENTS;
        const firstRows=Math.min(rows,TRAIL_SEGMENTS-firstRow);
        this.drawRows(firstRow,firstRows,1-rows);
        if(firstRows<rows)this.drawRows(0,rows-firstRows,1-rows+firstRows);
    }

    private drawRows(row:number,rows:number,frame:number){
        const gl=this.gl,offset=row*this.segments.byteLength,stride=SEGMENT_FLOATS*Float32Array.BYTES_PER_ELEMENT;
        gl.uniform1i(this.firstFrame,frame);
        gl.vertexAttribPointer(0,4,gl.FLOAT,false,stride,offset);
        gl.vertexAttribPointer(1,1,gl.FLOAT,false,stride,offset+4*Float32Array.BYTES_PER_ELEMENT);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,rows*this.count);
    }

    dispose(){
        const gl=this.gl;
        gl.disableVertexAttribArray(0);
        gl.disableVertexAttribArray(1);
        gl.disableVertexAttribArray(2);
        gl.bindBuffer(gl.ARRAY_BUFFER,null);
        gl.bindTexture(gl.TEXTURE_2D,null);
        gl.useProgram(null);
        gl.deleteBuffer(this.history);
        gl.deleteBuffer(this.corners);
        gl.deleteTexture(this.state);
        gl.deleteProgram(this.shader);
    }
}
