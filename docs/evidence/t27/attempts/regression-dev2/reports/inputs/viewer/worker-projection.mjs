// Geometry conversion only, using the same locked proj4js bytes as the main thread.
import '/vendor/proj4.js';
globalThis.setProjectionHandler(definition => globalThis.proj4('EPSG:4326', definition));
