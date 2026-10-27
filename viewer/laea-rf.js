// Fixed display CRS; the source grid and publication values do not change.
export const laeaRfId='hmc:laea-rf';
export const laeaRfDefinition='+proj=laea +lat_0=60 +lon_0=90 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs';
const e2=.0066943799901413165,e=Math.sqrt(e2),s=Math.sin(Math.PI/3);
export const laeaQp=1-(1-e2)/(2*e)*Math.log((1-e)/(1+e));
const q=(1-e2)*(s/(1-e2*s*s)-Math.log((1-e*s)/(1+e*s))/(2*e));
export const laeaBeta0=Math.asin(q/laeaQp);
export const laeaRq=6378137*Math.sqrt(laeaQp/2);
export const laeaD=6378137*.5/Math.sqrt(1-e2*s*s)/(laeaRq*Math.cos(laeaBeta0));
