// Native-cell marching squares. Each block owns cells by their south-west node;
// the one-cell halo supplies east/north neighbours without duplicated seam cells.
export function nativeBlockRange(metadata,index,buffer,window){
    const columns=metadata.columns[1]+1,[ny,nx]=metadata.grid.shape_yx;
    const baseX=index%columns*256,baseY=Math.floor(index/columns)*256;
    const values=new Float32Array(buffer,0,258*258),mask=new Uint8Array(buffer,258*258*4);
    let low=Infinity,high=-Infinity,count=0;
    for(let r=0;r<258;r++)for(let c=0;c<258;c++){
        const x=baseX+c-1,y=baseY+r-1;
        if(x<0||y<0||x>=nx||y>=ny||window&&(x<window[0]||y<window[1]||x>window[2]+1||y>window[3]+1))continue;
        const i=r*258+c;if(mask[i]!==1)continue;
        const v=values[i];if(!Number.isFinite(v))throw Error('Повреждены значения нативной сетки');
        low=Math.min(low,v);high=Math.max(high,v);count++;
    }
    return {low,high,count};
}
export class NativeContours {
    constructor(metadata,profile,emit,{maxBytes=16*1024**2,window:region,levels}={}){
        this.metadata=metadata;this.profile=profile;this.emit=emit;this.maxBytes=maxBytes;
        this.starts=new Map();this.ends=new Map();this.paths=new Set();this.points=0;
        this.window=region;
        this.levels=levels;
        this.stats={cells:0,segments:0,paths:0,peak_working_bytes:0,numeric_samples:[]};
    }
    bytes(){return this.points*48+(this.starts.size+this.ends.size)*96+this.paths.size*160+332820;}
    budget(){const bytes=this.bytes();this.stats.peak_working_bytes=Math.max(bytes,this.stats.peak_working_bytes);
        if(bytes>this.maxBytes)throw Error('Превышен бюджет построения изолиний');}
    coordinates(path,closed=false){
        const out=new Float64Array((path.count+Number(closed))*2);let at=0;
        for(let i=path.front.length-2;i>=0;i-=2){out[at++]=path.front[i];out[at++]=path.front[i+1];}
        for(const value of path.back)out[at++]=value;
        if(closed){out[at++]=out[0];out[at]=out[1];}
        return out;
    }
    detach(p){this.starts.delete(p.start);this.ends.delete(p.end);this.paths.delete(p);}
    output(p,closed=false){
        const xy=this.coordinates(p,closed);
        this.points-=p.count;this.detach(p);this.stats.paths++;
        this.emit(p.level,xy,closed);
    }
    segment(level,a,b){
        if(a.key===b.key)return;
        const from=this.ends.get(a.key),to=this.starts.get(b.key);this.stats.segments++;
        if(from&&from===to){this.output(from,true);return;}
        let path;
        if(from&&to){
            this.detach(from);this.detach(to);
            if(from.count>=to.count){
                const coords=this.coordinates(to);for(const v of coords)from.back.push(v);
                from.count+=to.count;from.end=to.end;path=from;
            }else{
                const coords=this.coordinates(from);
                for(let i=coords.length-2;i>=0;i-=2)to.front.push(coords[i],coords[i+1]);
                to.count+=from.count;to.start=from.start;path=to;
            }
        }else if(from){this.detach(from);from.back.push(b.x,b.y);from.count++;this.points++;from.end=b.key;path=from;}
        else if(to){this.detach(to);to.front.push(a.x,a.y);to.count++;this.points++;to.start=a.key;path=to;}
        else{path={front:[],back:[a.x,a.y,b.x,b.y],start:a.key,end:b.key,count:2,level};this.points+=2;}
        this.starts.set(path.start,path);this.ends.set(path.end,path);this.paths.add(path);this.budget();
    }
    addBlock(index,buffer){
        const [ny,nx]=this.metadata.grid.shape_yx,columns=this.metadata.columns[1]+1;
        const baseX=index%columns*256,baseY=Math.floor(index/columns)*256;
        const values=new Float32Array(buffer,0,258*258),mask=new Uint8Array(buffer,258*258*4);
        const {factor,offset,step}=this.profile;
        for(let row=0;row<Math.min(256,ny-1-baseY);row++)for(let col=0;col<Math.min(256,nx-1-baseX);col++){
            if(this.window&&(baseX+col<this.window[0]||baseY+row<this.window[1]||baseX+col>this.window[2]||baseY+row>this.window[3]))continue;
            const p=(row+1)*258+col+1,ids=[p,p+1,p+259,p+258];
            if(ids.some(i=>mask[i]!==1))continue;
            const v=ids.map(i=>values[i]*factor+offset);
            if(v.some(x=>!Number.isFinite(x)))throw Error('Повреждены значения нативной сетки');
            this.stats.cells++;
            const lo=Math.max(Math.ceil(Math.min(...v)/step),this.levels?.[0]??-Infinity),hi=Math.min(Math.floor(Math.max(...v)/step),this.levels?.[1]??Infinity);
            if(hi-lo>10000)throw Error('Слишком много уровней изолиний в ячейке');
            const x=baseX+col,y=baseY+row;
            for(let k=lo;k<=hi;k++){
                const level=k*step,g=v.map(value=>value-level);
                const bits=g.reduce((n,value,i)=>n+(value>0?1<<i:0),0);
                if(bits===0||bits===15)continue;
                const corners=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]];
                const edge=(e)=>{
                    const i=e,j=(e+1)%4,t=g[i]/(g[i]-g[j]);
                    const xx=corners[i][0]+t*(corners[j][0]-corners[i][0]),yy=corners[i][1]+t*(corners[j][1]-corners[i][1]);
                    // Edge identity is retained even at an exact-level vertex.
                    // Zero-length topological links connect its incident edges;
                    // merging all edges into one node creates degree-four map
                    // collisions on zero plateaus and loses whole components.
                    const node=e===0?(y*nx+x)*3+1:e===1?(y*nx+x+1)*3+2:e===2?((y+1)*nx+x)*3+1:(y*nx+x)*3+2;
                    return {x:xx,y:yy,key:k+'/'+node};
                };
                const crossed=[];for(let e=0;e<4;e++)if((g[e]>0)!==(g[(e+1)%4]>0))crossed.push(e);
                const pairs=crossed.length===4?(g[0]*g[2]-g[1]*g[3]>=0?[[0,1],[2,3]]:[[0,3],[1,2]]):[[crossed[0],crossed[1]]];
                for(const [ea,eb] of pairs){
                    let a=edge(ea),b=edge(eb);
                    // Along the cell's counter-clockwise boundary, enter the
                    // contour where high becomes low. This also orients the
                    // zero-length links at exact vertices consistently.
                    if(g[ea]<=0)[a,b]=[b,a];
                    if(this.stats.numeric_samples.length<16)this.stats.numeric_samples.push({cell:[x,y],level,values:ids.map(i=>values[i]),intersections:[[a.x,a.y],[b.x,b.y]]});
                    this.segment(level,a,b);
                }
            }
        }
        // NoData and coverage boundaries leave open paths. Retire them as soon as
        // neither endpoint can meet an unvisited block; retaining them until the
        // final block would make memory grow with every disconnected component.
        const lastColumn=index%columns===columns-1,top=baseY+256,right=baseX+256;
        const future=(x,y)=>y>=top||!lastColumn&&y>=baseY&&x>=right;
        for(const path of [...this.paths]){
            const first=path.front.length?path.front.slice(-2):path.back.slice(0,2),last=path.back.slice(-2);
            if(!future(...first)&&!future(...last))this.output(path);
        }
    }
    finish(){for(const path of [...this.paths])this.output(path);return this.stats;}
}
