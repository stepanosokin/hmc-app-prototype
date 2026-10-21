// T24 display-only geometry. All coordinates are WGS84 longitude/latitude.
// Orthography uses parallel rays on R=6378137; LAEA is ellipsoidal EPSG:3576.
'use strict';
window.createDemoProjection = function(mode, center, extent) {
  const R=6378137, rad=Math.PI/180;
  let projection, visible;
  if(mode==='mercator') {
    projection=d3.geoMercator().center(center);
    visible=([,lat])=>Math.abs(lat)<85.051129;
  } else if(mode==='orthographic') {
    projection=d3.geoOrthographic().rotate([-center[0],-center[1]]).clipAngle(90);
    visible=p=>d3.geoDistance(p,center)<Math.PI/2-1e-8;
  } else if(mode==='laea') {
    const crs='+proj=laea +lat_0=90 +lon_0=90 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs';
    const transform=proj4('EPSG:4326',crs), rotation=d3.geoRotation([-90,-90]);
    const raw=(lon,lat)=>{const p=transform.forward(rotation.invert([lon/rad,lat/rad]));return [p[0]/R,p[1]/R];};
    raw.invert=(x,y)=>rotation(transform.inverse([x*R,y*R])).map(v=>v*rad);
    projection=d3.geoProjection(raw).rotate([-90,-90]).clipAngle(45.000001);
    visible=([,lat])=>lat>=45;
  } else throw Error('Неизвестная проекция');
  projection.precision(.4).clipExtent(extent);
  return {projection,visible};
};
