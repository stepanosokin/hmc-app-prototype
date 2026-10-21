import * as maplibre from '/vendor/maplibre-gl.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [];
const workerReady = maplibre.importScriptInWorkers(new URL('/worker-projection.mjs', location.href).href);
const definition = '+proj=laea +lat_0=90 +lon_0=90 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs';
proj4.defs('EPSG:3576', definition);
const laea = proj4('EPSG:4326', 'EPSG:3576');
maplibre.addProjection({ name: 'EPSG:3576', projection: laea, definition,
    tileMatrixSet: { origin: [-5000000, 5000000], extentAtZoom0: 10000000 } });
const land = { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: window.land } };
let map;
function clippedLand(center, angle) {
    const rotation = d3.geoRotation([-center[0], -center[1]]);
    const polygons = [];
    let polygon, ring;
    const sink = { polygonStart() { polygon = []; }, polygonEnd() { if (polygon.length)
            polygons.push(polygon); },
        lineStart() { ring = []; }, lineEnd() { if (ring.length >= 3) {
            ring.push(ring[0]);
            polygon.push(ring);
        } },
        point(lon, lat) { ring.push(rotation.invert([lon * 180 / Math.PI, lat * 180 / Math.PI])); } };
    const clip = d3.geoClipCircle(angle * Math.PI / 180)(sink);
    const stream = { polygonStart() { clip.polygonStart(); }, polygonEnd() { clip.polygonEnd(); },
        lineStart() { clip.lineStart(); }, lineEnd() { clip.lineEnd(); },
        point(lon, lat) { const p = rotation([lon, lat]); clip.point(p[0] * Math.PI / 180, p[1] * Math.PI / 180); } };
    d3.geoStream(land, stream);
    return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polygons } };
}
// Clip geographic lines before the CRS transform, just like the local land.
export function clippedLine(coordinates, center, angle) {
    const rotation = d3.geoRotation([-center[0], -center[1]]), lines = [];
    let line;
    const sink = { lineStart() { line = []; }, lineEnd() { if (line.length > 1)
            lines.push(line); },
        point(lon, lat) { line.push(rotation.invert([lon * 180 / Math.PI, lat * 180 / Math.PI])); } };
    const clip = d3.geoClipCircle(angle * Math.PI / 180)(sink);
    d3.geoStream({ type: 'LineString', coordinates }, { lineStart() { clip.lineStart(); }, lineEnd() { clip.lineEnd(); },
        point(lon, lat) { const p = rotation([lon, lat]); clip.point(p[0] * Math.PI / 180, p[1] * Math.PI / 180); } });
    return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } };
}
export async function create(type, center = [0, 0], zoom = 0) {
    await workerReady;
    map?.remove();
    let data = land, water = null;
    if (type === 'hmc:orthographic') {
        maplibre.removeProjection(type);
        const definition = `+proj=ortho +lat_0=${center[1]} +lon_0=${center[0]} +R=6378137 +units=m +no_defs`;
        maplibre.addProjection({ name: type, definition, projection: proj4('EPSG:4326', definition),
            tileMatrixSet: { origin: [-6378137, 6378137], extentAtZoom0: 12756274 } });
        data = { type: 'FeatureCollection', features: [] };
        water = null;
    }
    else if (type === 'EPSG:3576') {
        data = clippedLand([90, 90], 45);
        water = d3.geoCircle().center([90, 90]).radius(45).precision(.5)();
    }
    map = new maplibre.Map({ container: 'map', center, zoom, minZoom: -2, attributionControl: false,
        dragPan: type !== 'hmc:orthographic', pitchWithRotate: false, maxPitch: 0,
        pixelRatio: Math.min(devicePixelRatio, 2), maxCanvasSize: [2048, 2048],
        canvasContextAttributes: { preserveDrawingBuffer: false },
        style: { version: 8, projection: { type }, sources: { land: { type: 'geojson', data },
                ...(water ? { water: { type: 'geojson', data: water } } : {}) }, layers: [
                { id: 'background', type: 'background', paint: { 'background-color': water ? '#102840' : '#244c6c',
                        'background-opacity': type === 'hmc:orthographic' ? 0 : 1 } },
                ...(water ? [{ id: 'water', type: 'fill', source: 'water', paint: { 'fill-color': '#244c6c' } }] : []),
                { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#91b195' } }
            ] } });
    map.on('error', e => errors.push(String(e.error)));
    const active = map;
    map.on('remove', () => { if (map === active)
        map = undefined; });
    await Promise.race([map.once('idle'), delay(15000).then(() => { throw Error('Карта не завершила загрузку'); })]);
    return map;
}
