/** All interval fields participate, including accumulation bounds and increments. */
export function sameWindInterval(a,b){
    const first=a.interval??null,second=b.interval??null;
    if(first===null||second===null)return first===second;
    return Object.keys(first).length===Object.keys(second).length&&
        Object.entries(first).every(([key,value])=>Reflect.get(second,key)===value);
}
