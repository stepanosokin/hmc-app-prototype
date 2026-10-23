// The publication snapshot supplies the operative parameters; no defaults are
// reconstructed here. Historical publications keep the frozen v1 operation.
export function nativePosition(spec,xy,inverse=false){
    if(!spec)return inverse?[xy[0],Math.atan2(Math.sin(xy[1]*Math.PI/180),(1-.0066943799901413165)*Math.cos(xy[1]*Math.PI/180))*180/Math.PI]:
        [xy[0],Math.atan2((1-.0066943799901413165)*Math.sin(xy[1]*Math.PI/180),Math.cos(xy[1]*Math.PI/180))*180/Math.PI];
    const values=spec.configuration.values,a=spec.semi_major_m,b=spec.semi_minor_m,e2=1-b*b/(a*a),h=values.coordinate_height_m;
    const pm=spec.prime_meridian_degrees??values.prime_meridian_degrees;
    const geographic=`+proj=longlat +a=${a} +b=${b} +pm=${pm}`;
    let operation;
    if(spec.template===1){
        const p=-spec.rotation.south_lat*Math.PI/180,l0=spec.rotation.south_lon*Math.PI/180,angle=-spec.rotation.angle*Math.PI/180;
        const rotate=(xy,back)=>{let l=xy[0]*Math.PI/180,p0=xy[1]*Math.PI/180;
            if(back){l-=angle;return [(l0+Math.atan2(Math.cos(p0)*Math.sin(l),Math.sin(p)*Math.cos(p0)*Math.cos(l)-Math.cos(p)*Math.sin(p0)))*180/Math.PI,
                Math.asin(Math.max(-1,Math.min(1,Math.sin(p)*Math.sin(p0)+Math.cos(p)*Math.cos(p0)*Math.cos(l))))*180/Math.PI];}
            l-=l0;return [(angle+Math.atan2(Math.cos(p0)*Math.sin(l),Math.sin(p)*Math.cos(p0)*Math.cos(l)+Math.cos(p)*Math.sin(p0)))*180/Math.PI,
                Math.asin(Math.max(-1,Math.min(1,Math.sin(p)*Math.sin(p0)-Math.cos(p)*Math.cos(p0)*Math.cos(l))))*180/Math.PI];};
        operation={forward:xy=>rotate(xy,false),inverse:xy=>rotate(xy,true)};
    }else if(spec.template===31){
        // proj4js's Albers inverse divides by eccentricity for a sphere. Keep
        // the spherical limit explicit, and solve authalic latitude uniformly.
        const params=Object.fromEntries(spec.proj.split(/\s+/).filter(x=>x.includes('=')).map(x=>{const[k,v]=x.slice(1).split('=');return[k,Number(v)];}));
        const rad=Math.PI/180,e=Math.sqrt(e2),p1=params.lat_1*rad,p2=params.lat_2*rad,p0=params.lat_0*rad,l0=params.lon_0*rad;
        const m=p=>Math.cos(p)/Math.sqrt(1-e2*Math.sin(p)**2);
        const q=p=>e?(1-e2)*(Math.sin(p)/(1-e2*Math.sin(p)**2)-Math.log((1-e*Math.sin(p))/(1+e*Math.sin(p)))/(2*e)):2*Math.sin(p);
        const n=Math.abs(p1-p2)<1e-12?Math.sin(p1):(m(p1)**2-m(p2)**2)/(q(p2)-q(p1)),c=m(p1)**2+n*q(p1),rho0=a*Math.sqrt(c-n*q(p0))/n;
        operation={forward:xy=>{const rho=a*Math.sqrt(c-n*q(xy[1]*rad))/n,theta=n*(xy[0]*rad-l0);return[rho*Math.sin(theta),rho0-rho*Math.cos(theta)];},
            inverse:xy=>{const rho=Math.sign(n)*Math.hypot(xy[0],rho0-xy[1]),target=(c-(rho*n/a)**2)/n;
                let phi=Math.asin(Math.max(-1,Math.min(1,target/2)));
                for(let i=0;i<12&&e;i++){const derivative=2*(1-e2)*Math.cos(phi)/(1-e2*Math.sin(phi)**2)**2;phi-=(q(phi)-target)/derivative;}
                return[(l0+Math.atan2(Math.sign(n)*xy[0],Math.sign(n)*(rho0-xy[1]))/n)/rad,phi/rad];}};
    }else operation=proj4(geographic,spec.proj);
    if(spec.datum_mode==='wgs84-angular')return inverse?operation.inverse(xy):operation.forward(xy);
    const cart=(lon,lat,aa,ee,height)=>{const p=lat*Math.PI/180,l=lon*Math.PI/180,n=aa/Math.sqrt(1-ee*Math.sin(p)**2);
        return [(n+height)*Math.cos(p)*Math.cos(l),(n+height)*Math.cos(p)*Math.sin(l),(n*(1-ee)+height)*Math.sin(p)];};
    const geographicOf=(point,aa,ee)=>{const [x,y,z]=point,p=Math.hypot(x,y);let phi=Math.atan2(z,p*(1-ee));
        for(let i=0;i<10;i++){const n=aa/Math.sqrt(1-ee*Math.sin(phi)**2);phi=Math.atan2(z+ee*n*Math.sin(phi),p);}
        const n=aa/Math.sqrt(1-ee*Math.sin(phi)**2),height=Math.abs(Math.cos(phi))>1e-10?p/Math.cos(phi)-n:Math.abs(z)-aa*Math.sqrt(1-ee);
        return [Math.atan2(y,x)*180/Math.PI,phi*180/Math.PI,height];};
    if(!inverse){const point=cart(...xy,6378137,.0066943799901413165,h).map((v,i)=>v+values.geocentric_translation_m[i]);
        const geo=geographicOf(point,a,e2);geo[0]-=pm;return operation.forward(geo.slice(0,2));}
    const geo=operation.inverse(xy);geo[0]+=pm;
    let height=h,result;
    for(let i=0;i<10;i++){const point=cart(...geo,a,e2,height).map((v,j)=>v-values.geocentric_translation_m[j]);
        result=geographicOf(point,6378137,.0066943799901413165);height-=result[2]-h;}
    return result.slice(0,2);
}

export function sourceShader(spec){
    if(!spec)return `vec2 sourcePosition(vec2 geo){float phi=geo.y*pi/180.;return vec2(geo.x,preciseAtan2((1.-0.0066943799901413165)*sin(phi),cos(phi))*180./pi);}`;
    const number=v=>{if(!Number.isFinite(v))throw Error('Некорректные параметры CRS публикации');const s=Number(v).toPrecision(16);return s.includes('.')||s.includes('e')?s:s+'.';};
    const params=Object.fromEntries(spec.proj.split(/\s+/).filter(x=>x.includes('=')).map(x=>{const[k,v]=x.slice(1).split('=');return[k,Number(v)];}));
    const c=spec.configuration.values,A=spec.semi_major_m,B=spec.semi_minor_m,E2=1-B*B/(A*A);
    const v=x=>number(x),r=x=>v(x*Math.PI/180);
    let projection;
    if(spec.template===0)projection='return vec2(lam,phi)*180./pi;';
    if(spec.template===1){const p=r(params.o_lat_p),l=r(params.lon_0),a=r(params.o_lon_p);
        projection=`float dl=lam-${l};float rotatedPhi=preciseAsin(clamp(sin(${p})*sin(phi)-cos(${p})*cos(phi)*cos(dl),-1.,1.));
            float rotatedLam=preciseAtan2(cos(phi)*sin(dl),sin(${p})*cos(phi)*cos(dl)+cos(${p})*sin(phi))+${a};return vec2(rotatedLam,rotatedPhi)*180./pi;`;}
    if(spec.template===10){const lat=params.lat_ts*Math.PI/180,k=Math.cos(lat)/Math.sqrt(1-E2*Math.sin(lat)**2);
        projection=`return vec2(lam,log(tan(pi/4.+phi/2.)*pow((1.-ecc*sin(phi))/(1.+ecc*sin(phi)),ecc/2.)))*${v(A*k)};`;}
    if(spec.template===20){const sign=params.lat_0<0?-1:1,lat=Math.abs(params.lat_ts)*Math.PI/180,e=Math.sqrt(E2);
        const t=p=>Math.tan(Math.PI/4-p/2)/((1-e*Math.sin(p))/(1+e*Math.sin(p)))**(e/2);
        const factor=Math.abs(Math.abs(params.lat_ts)-90)<1e-8?2*A/Math.sqrt((1+e)**(1+e)*(1-e)**(1-e)):
            A*Math.cos(lat)/Math.sqrt(1-E2*Math.sin(lat)**2)/t(lat);
        projection=`float dl=lam-${r(params.lon_0)};float rho=${v(factor)}*tfun(phi*${v(sign)});return vec2(rho*sin(dl),-${v(sign)}*rho*cos(dl));`;}
    if(spec.template===30||spec.template===31){const p1=params.lat_1*Math.PI/180,p2=params.lat_2*Math.PI/180,p0=params.lat_0*Math.PI/180,e=Math.sqrt(E2);
        const m=p=>Math.cos(p)/Math.sqrt(1-E2*Math.sin(p)**2);
        const t=p=>Math.tan(Math.PI/4-p/2)/((1-e*Math.sin(p))/(1+e*Math.sin(p)))**(e/2);
        const q=p=>e? (1-E2)*(Math.sin(p)/(1-E2*Math.sin(p)**2)-Math.log((1-e*Math.sin(p))/(1+e*Math.sin(p)))/(2*e)):2*Math.sin(p);
        let n,F,rho0;
        if(spec.template===30){n=Math.abs(p1-p2)<1e-12?Math.sin(p1):Math.log(m(p1)/m(p2))/Math.log(t(p1)/t(p2));F=m(p1)/(n*t(p1)**n);rho0=A*F*t(p0)**n;
            projection=`float rho=${v(A*F)}*pow(tfun(phi),${v(n)});`;}
        else{n=Math.abs(p1-p2)<1e-12?Math.sin(p1):(m(p1)**2-m(p2)**2)/(q(p2)-q(p1));F=m(p1)**2+n*q(p1);rho0=A*Math.sqrt(F-n*q(p0))/n;
            projection=`float rho=${v(A/n)}*sqrt(max(0.,${v(F)}-${v(n)}*qfun(phi)));`;}
        projection+=`float theta=${v(n)}*(lam-${r(params.lon_0)});return vec2(rho*sin(theta),${v(rho0)}-rho*cos(theta));`;
    }
    if(!projection)throw Error('Не поддерживается CRS публикации');
    const sphericalZero=E2===0&&c.coordinate_height_m===0&&c.geocentric_translation_m.every(x=>x===0);
    const bridge=spec.datum_mode==='wgs84-angular'?'':sphericalZero?
        'phi=preciseAtan2((1.-0.0066943799901413165)*sin(phi),cos(phi));':`
            float nn=6378137./sqrt(1.-0.0066943799901413165*sin(phi)*sin(phi));
            vec3 xyz=vec3((nn+${v(c.coordinate_height_m)})*cos(phi)*cos(lam),(nn+${v(c.coordinate_height_m)})*cos(phi)*sin(lam),(nn*(1.-0.0066943799901413165)+${v(c.coordinate_height_m)})*sin(phi));
            xyz+=vec3(${c.geocentric_translation_m.map(v).join(',')});float horizontal=length(xyz.xy);
            phi=preciseAtan2(xyz.z,horizontal*(1.-sourceE2));
            for(int j=0;j<6;j++){float n=sourceA/sqrt(1.-sourceE2*sin(phi)*sin(phi));phi=preciseAtan2(xyz.z+sourceE2*n*sin(phi),horizontal);}
            lam=preciseAtan2(xyz.y,xyz.x);`;
    return `const float sourceA=${v(A)},sourceE2=${v(E2)},ecc=${v(Math.sqrt(E2))};
        float tfun(float phi){return tan(pi/4.-phi/2.)/pow((1.-ecc*sin(phi))/(1.+ecc*sin(phi)),ecc/2.);}
        float qfun(float phi){float s=sin(phi);if(ecc==0.)return 2.*s;return (1.-sourceE2)*(s/(1.-sourceE2*s*s)-log((1.-ecc*s)/(1.+ecc*s))/(2.*ecc));}
        vec2 sourcePosition(vec2 geo){float phi=geo.y*pi/180.,lam=geo.x*pi/180.;${bridge}
            lam-=${r(spec.prime_meridian_degrees??c.prime_meridian_degrees)};${projection}}
    `;
}
