/** Smallest float32 at or above each physical boundary: GPU comparisons then
 * classify every representable value as the server's double-precision rule. */
export function paletteThresholds(range,count){
    const result=new Float32Array(count),bits=new Uint32Array(result.buffer);
    for(let i=0;i<count;i++){
        const threshold=range[0]+(range[1]-range[0])*i/(count-1);
        result[i]=threshold;
        if(result[i]<threshold)bits[i]+=result[i]<0?-1:1;
    }
    return result;
}
