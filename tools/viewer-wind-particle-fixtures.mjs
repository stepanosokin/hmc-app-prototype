/** Deterministic pixel checks in an isolated same-origin frame, using the real Canvas. */
export async function checkWindParticleFixtures(evaluate,origin){
    return evaluate(`(async()=>{
        const frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-10000px;width:80px;height:80px';document.body.append(frame);
        try{return await frame.contentWindow.eval('('+${JSON.stringify(String(windParticleFixtures))}+')('+JSON.stringify(${JSON.stringify(origin)})+')');}
        finally{frame.remove();}
    })()`);
}

async function windParticleFixtures(origin){
    const {WindArrows}=await import(origin+'/build/wind.js');
    const checks=[],samples=[],frames=[];
    const expect=(name,ok)=>{if(!ok)throw Error(name);checks.push(name);};
    const component=()=>{
        const block=new ArrayBuffer(258*258*5);
        new Float32Array(block,0,258*258).fill(1);new Uint8Array(block,258*258*4).fill(1);
        return {metadata:{grid:{shape_yx:[2,2],outer_cell_edges_wsen:[0,0,2,2],spacing_degrees_xy:[1,1]},columns:[0,0]},blocks:[block]};
    };
    const field=component();field.wind=component();
    const container=document.createElement('div');container.style.cssText='width:20px;height:20px;position:relative';document.body.append(container);
    const wind=new WindArrows(field);wind.attach(container);
    const canvas=container.querySelector('canvas'),ctx=canvas.getContext('2d');
    const view={width:20,height:20,origin:[0,20],scale:10};
    const projection={forward:p=>p,inverse:p=>p};
    let now=1000,placement=.5;
    Math.random=()=>placement;
    Object.defineProperty(performance,'now',{value:()=>now,configurable:true});
    const draw=(paused=false,mode='EPSG:3857',center=[0,0])=>{now+=50;wind.draw(view,projection,center,mode,paused);};
    const pixels=()=>Array.from(ctx.getImageData(0,0,20,20).data);
    const ink=()=>pixels().filter((_,i)=>i%4===3).reduce((a,b)=>a+b,0);
    const masks=()=>[new Uint8Array(field.blocks[0],258*258*4),new Uint8Array(field.wind.blocks[0],258*258*4)];
    const reset=()=>{placement=.5;masks().forEach(m=>m.fill(1));for(const part of [field,field.wind])new Float32Array(part.blocks[0],0,258*258).fill(1);wind.clear();view.origin[0]+=.0001;draw();for(let i=0;i<5;i++)draw();expect('Living particle has a visible trail',ink()>0);};
    try{
        const configuration=wind.evidence();
        expect('Particle life is 6.8 seconds',configuration.particle_lifetime_seconds===6.8);
        expect('Trail decay is 5 seconds',configuration.trail_decay_seconds===5);
        expect('Trail history has fourfold capacity',configuration.trail_segment_limit===1024);
        reset();expect('Fixture has exactly one particle',wind.evidence().arrows===1);
        masks().forEach(m=>m.fill(0));draw();
        expect('NoData removes every pixel of the old trail',ink()===0);samples.push({case:'nodata',alpha_sum:ink()});
        reset();
        const frozen=pixels(),paints=wind.evidence().paints;
        // Invalidated data must not mutate particles while paused, either.
        masks().forEach(m=>m.fill(0));for(let i=0;i<8;i++)draw(true);
        expect('Pause freezes pixels and particle state',pixels().every((v,i)=>v===frozen[i])&&wind.evidence().paints===paints&&wind.evidence().visible===1);
        draw();expect('Resume removes the invalidated trail',ink()===0);
        reset();new Float32Array(field.blocks[0],0,258*258).fill(0);new Float32Array(field.wind.blocks[0],0,258*258).fill(0);
        draw();expect('Unusable velocity removes the trail',ink()===0);
        reset();placement=.25;
        let previous=ink(),expired=false;
        for(let i=0;i<160;i++){draw();const value=ink();if(previous>0&&value===0){expired=true;break;}previous=value;}
        expect('Lifetime expiry and respawn leave no old trail',expired);draw();expect('Respawn starts a visible new trail',ink()>0);
        reset();for(const part of [field,field.wind])new Float32Array(part.blocks[0],0,258*258).fill(80);
        let crossed=false;
        for(let i=0;i<10;i++){draw();if(wind.evidence().visible===0){expect('Leaving the screen removes the trail in the crossing frame',ink()===0);crossed=true;break;}}
        expect('Fast constant wind crosses the screen before lifetime expiry',crossed);
        reset();masks()[1][2*258+2]=0;draw();expect('Partial NoData removes the complete individual trail',ink()===0);
        reset();
        draw(false,'hmc:orthographic',[180,0]);expect('Hidden hemisphere removes the trail',ink()===0);
        reset();draw(false,'EPSG:3576');expect('Outside projection coverage removes the trail',ink()===0);
        reset();wind.clear();draw(true);expect('Explicit clear does not restore old history',ink()===0);
        reset();const bytes=wind.bytes(20,20);for(let i=0;i<600;i++)draw();
        expect('Trail storage remains bounded across repeated lifetimes',wind.bytes(20,20)===bytes);
        // Constant-wind population for visual review of birth/respawn and partial coverage.
        let seed=123456789;Math.random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
        container.style.width='640px';container.style.height='360px';view.width=640;view.height=360;view.origin=[0,360];view.scale=180;
        for(const [part,value] of [[field,8],[field.wind,5]]){new Float32Array(part.blocks[0],0,258*258).fill(value);new Uint8Array(part.blocks[0],258*258*4).fill(1);}
        const capture=name=>{const image=document.createElement('canvas');image.width=640;image.height=360;const context=image.getContext('2d');context.fillStyle='#20343f';context.fillRect(0,0,640,360);context.drawImage(canvas,0,0);frames.push({name,png:image.toDataURL('image/png').split(',')[1]});};
        draw();capture('constant-initial');for(let i=0;i<16;i++)draw();capture('constant-motion');
        for(let i=0;i<160;i++)draw();capture('constant-respawn');view.origin[0]-=120;draw();for(let i=0;i<20;i++)draw();capture('constant-view-change');
        expect('Constant-wind population retains partial coverage',wind.evidence().visible>0&&wind.evidence().visible<wind.evidence().arrows);
        return {checks,samples,frames,configuration,scope:'Real Canvas, constant U/V, deterministic clock/placement, single-particle pixels and seeded population; supplements actual-source acceptance'};
    }finally{wind.remove();container.remove();}
}
