// Contour-only display surface. The source arrays and the colour field remain untouched.
export function gaussianSurface(grid,sigma=1.2){
    const {width,height,values,valid}=grid,radius=Math.ceil(3*sigma);
    const weights=Array.from({length:radius+1},(_,i)=>Math.exp(-i*i/(2*sigma*sigma)));
    const pass=(source,dx,dy)=>{
        const out=new Float32Array(values.length);
        for(let y=0;y<height;y++)for(let x=0;x<width;x++){
            const i=y*width+x;if(!valid[i])continue;
            let sum=source[i],weight=1;
            for(const direction of [-1,1])for(let k=1;k<=radius;k++){
                const xx=x+dx*k*direction,yy=y+dy*k*direction;
                // Truncate and renormalize at coverage/NoData; never jump across a gap.
                if(xx<0||yy<0||xx>=width||yy>=height||!valid[yy*width+xx])break;
                sum+=source[yy*width+xx]*weights[k];weight+=weights[k];
            }
            out[i]=sum/weight;
        }
        return out;
    };
    return {...grid,values:pass(pass(values,1,0),0,1)};
}

function spline(t){return [(1-t)**3/6,(3*t**3-6*t*t+4)/6,(-3*t**3+3*t*t+3*t+1)/6,t**3/6];}

export function contourSurface(metadata,grid){
    // Keep no more than approximately the original number of nodes. Fine blocks are streamed.
    const subdivision=Math.min(4,metadata.prototype?.factor??1),width=(grid.width-1)*subdivision+1,height=(grid.height-1)*subdivision+1;
    const derived=structuredClone(metadata),[dx,dy]=metadata.grid.spacing_degrees_xy,[west,south]=metadata.grid.outer_cell_edges_wsen;
    derived.grid.shape_yx=[height,width];derived.grid.spacing_degrees_xy=[dx/subdivision,dy/subdivision];
    derived.grid.outer_cell_edges_wsen=[west+dx/2-dx/subdivision/2,south+dy/2-dy/subdivision/2,
        west+dx/2+(width-.5)*dx/subdivision,south+dy/2+(height-.5)*dy/subdivision];
    derived.columns=[0,Math.ceil(width/256)-1];derived.rows=[0,Math.ceil(height/256)-1];
    const count=(derived.columns[1]+1)*(derived.rows[1]+1);
    function sample(x,y){
        const xx=x/subdivision,yy=y/subdivision,ix=Math.floor(xx),iy=Math.floor(yy),wx=spline(xx-ix),wy=spline(yy-iy);
        let value=0;
        for(let b=0;b<4;b++)for(let a=0;a<4;a++){
            const weight=wx[a]*wy[b];if(weight===0)continue;
            const px=Math.max(0,Math.min(grid.width-1,ix+a-1)),py=Math.max(0,Math.min(grid.height-1,iy+b-1)),i=py*grid.width+px;
            if(!grid.valid[i])return;
            value+=weight*grid.values[i];
        }
        return value;
    }
    function block(index){
        const buffer=new ArrayBuffer(258*258*5),values=new Float32Array(buffer,0,258*258),valid=new Uint8Array(buffer,258*258*4);
        const x0=index%(derived.columns[1]+1)*256-1,y0=Math.floor(index/(derived.columns[1]+1))*256-1;
        for(let y=0;y<258;y++)for(let x=0;x<258;x++){
            const xx=x0+x,yy=y0+y;if(xx<0||yy<0||xx>=width||yy>=height)continue;
            const value=sample(xx,yy);if(value===undefined)continue;
            const i=y*258+x;values[i]=value;valid[i]=1;
        }
        return buffer;
    }
    return {metadata:derived,count,block,sample,subdivision};
}
