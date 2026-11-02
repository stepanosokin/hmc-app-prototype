// THROWAWAY experiment #79. Native-coordinate box aggregation, not a publication contract.
import {createHash} from 'node:crypto';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const factors = [1, 2, 4, 8];
export const contract = 'prototype-display-pyramid/1';
export const contractHash = sha(contract);
export function unpack(metadata, blocks) {
    const [height,width]=metadata.grid.shape_yx,columns=metadata.columns[1]+1;
    const values=new Float32Array(width*height),valid=new Uint8Array(width*height);
    blocks.forEach((block,index)=>{
        if(block.length!==332820)throw Error('Повреждён исходный блок');
        for(let y=0;y<256;y++)for(let x=0;x<256;x++){
            const xx=index%columns*256+x,yy=Math.floor(index/columns)*256+y;
            if(xx>=width||yy>=height)continue;
            const p=(y+1)*258+x+1,i=yy*width+xx,m=block[258*258*4+p],v=block.readFloatLE(p*4);
            if(m>1||!Number.isFinite(v)||(!m&&v!==0))throw Error('Повреждена исходная маска');
            values[i]=v;valid[i]=m;
        }
    });
    return {width,height,values,valid};
}
export function aggregate(source,factor){
    if(!factors.includes(factor))throw Error('Неизвестный уровень');
    if(factor===1)return source;
    const width=Math.ceil(source.width/factor),height=Math.ceil(source.height/factor);
    const values=new Float32Array(width*height),valid=new Uint8Array(width*height);
    // Equal native-coordinate footprints, including fractional edge-cell weights.
    // Conservative mask: ANY missing positive-weight contributor makes output missing.
    // This is not geodesic area averaging and must not be used for canonical point values.
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const x0=x*source.width/width,x1=(x+1)*source.width/width;
        const y0=y*source.height/height,y1=(y+1)*source.height/height;
        let sum=0,weight=0,missing=false;
        for(let yy=Math.floor(y0);yy<Math.ceil(y1);yy++)for(let xx=Math.floor(x0);xx<Math.ceil(x1);xx++){
            const w=Math.max(0,Math.min(xx+1,x1)-Math.max(xx,x0))*Math.max(0,Math.min(yy+1,y1)-Math.max(yy,y0));
            if(!w)continue;
            const i=yy*source.width+xx;
            if(!source.valid[i])missing=true;
            sum+=source.values[i]*w;weight+=w;
        }
        const i=y*width+x;
        if(!missing&&weight){values[i]=sum/weight;valid[i]=1;}
    }
    return {width,height,values,valid};
}
export function pack(grid){
    const columns=Math.ceil(grid.width/256),rows=Math.ceil(grid.height/256),blocks=[];
    for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
        const block=Buffer.alloc(332820);
        for(let y=0;y<258;y++)for(let x=0;x<258;x++){
            const xx=col*256+x-1,yy=row*256+y-1;
            if(xx<0||yy<0||xx>=grid.width||yy>=grid.height)continue;
            const i=yy*grid.width+xx,p=y*258+x;
            block.writeFloatLE(grid.valid[i]?grid.values[i]:0,p*4);block[258*258*4+p]=grid.valid[i];
        }
        blocks.push(block);
    }
    return blocks;
}
export function levelMetadata(original,grid,factor,base){
    const metadata=structuredClone(original),[west,south,east,north]=metadata.grid.outer_cell_edges_wsen;
    metadata.grid.shape_yx=[grid.height,grid.width];
    metadata.grid.spacing_degrees_xy=[(east-west)/grid.width,(north-south)/grid.height];
    metadata.columns=[0,Math.ceil(grid.width/256)-1];metadata.rows=[0,Math.ceil(grid.height/256)-1];
    metadata.url=base+'/{column}/{row}.f32';metadata.url_template=metadata.url;
    if(factor!==1){metadata.contract=contract;metadata.contract_sha256=contractHash;metadata.engine='prototype-native-box/1';metadata.matrix+='-prototype-'+factor;}
    metadata.prototype={factor,source_grid_sha256:original.identity.native_grid_sha256,
        aggregation:factor===1?'none':'native-coordinate box mean; fractional footprint weights',
        mask:'all contributors valid; no hole filling',point:'original API, never this pyramid',
        smoothing_css_px:factor===1?.6:factor,production:false};
    return metadata;
}
