import type {FieldData} from './field.js';

/** Magnitude at native cell centres, then the ordinary scalar interpolation. */
export function windSpeed(data:FieldData):FieldData{
    if(!data.wind)return data;
    let low=Infinity,high=-Infinity,count=0;
    const blocks=data.blocks.map((u,index)=>{
        const v=data.wind!.blocks[index],output=new ArrayBuffer(u.byteLength);
        const a=new Float32Array(u,0,258*258),b=new Float32Array(v,0,258*258),values=new Float32Array(output,0,258*258);
        const am=new Uint8Array(u,258*258*4),bm=new Uint8Array(v,258*258*4),mask=new Uint8Array(output,258*258*4);
        for(let i=0;i<values.length;i++)if(am[i]&&bm[i]){values[i]=Math.hypot(a[i],b[i]);mask[i]=1;low=Math.min(low,values[i]);high=Math.max(high,values[i]);count++;}
        return output;
    });
    return {...data,wind:undefined,blocks,metadata:{...data.metadata,palette:data.metadata.wind_palette,
        zero_transparent:false,all_nodata:count===0,all_transparent:count===0,display_range:count?[low,high]:null}};
}
