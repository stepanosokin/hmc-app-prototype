import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

function one(source, expression, label) {
    const matches = [...source.matchAll(expression)];
    if (matches.length !== 1) throw Error(`Expected one ${label}; review the pinned QGIS source plan`);
    return matches[0];
}

function section(source, name) {
    const start = one(source, new RegExp(`^def ${name}\\(`, 'gm'), name).index;
    const next = source.indexOf('\ndef ', start + 1);
    return source.slice(start, next < 0 ? undefined : next);
}

/** Source-only guard; it does not establish desktop compatibility or execute QGIS. */
export function checkQgisDesktopPlan(wmsSource, desktopSource) {
    wmsSource = wmsSource.replaceAll('\r\n', '\n');
    desktopSource = desktopSource.replaceAll('\r\n', '\n');
    const limit = Number(one(wmsSource, /^MAX_MAP_SIZE\s*=\s*(\d+)\s*$/gm, 'GetMap limit')[1]);
    if (limit < 1) throw Error('Invalid GetMap limit');
    const render = section(desktopSource, 'verify_desktop');
    const identify = section(desktopSource, 'identify_in_canvas');
    const renderMatch = one(render, /^\s*settings\.setOutputSize\(QSize\((\d+),\s*(\d+)\)\)\s*$/gm, 'desktop render size');
    const identifyMatch = one(identify, /^\s*canvas\.resize\((\d+),\s*(\d+)\)\s*$/gm, 'Identify canvas size');
    const sizes = [renderMatch, identifyMatch].map(match => [Number(match[1]), Number(match[2])]);
    for (const [index, size] of sizes.entries()) {
        if (size.some(value => value < 1) || Math.max(...size) <= limit)
            throw Error(`${index ? 'Identify' : 'Render'} canvas must exceed the GetMap limit ${limit}`);
    }
    const shown = one(identify, /^\s*canvas\.show\(\)\s*$/gm, 'canvas layout initialization');
    const events = one(identify, /^\s*QApplication\.processEvents\(\)\s*$/gm, 'Qt layout event processing');
    const width = one(identify, /^\s*assert canvas\.mapSettings\(\)\.outputSize\(\)\.width\(\) == (\d+)\s*$/gm, 'actual viewport width assertion');
    const height = one(identify, /^\s*assert canvas\.mapSettings\(\)\.outputSize\(\)\.height\(\) == (\d+)\s*$/gm, 'actual viewport height assertion');
    const lookup = one(identify, /^\s*results = tool\.identify\(/gm, 'native Identify call');
    if (Number(width[1]) !== sizes[1][0] || Number(height[1]) !== sizes[1][1])
        throw Error('Actual viewport assertions differ from the planned Identify size');
    if (!(shown.index < events.index && events.index < width.index && events.index < height.index
        && width.index < lookup.index && height.index < lookup.index))
        throw Error('Qt layout and actual viewport checks must precede Identify');
    return {status: 'passed', proof: 'source-plan-only', map_limit: limit, render: sizes[0], identify: sizes[1]};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        const args = process.argv.slice(2);
        if (args.length !== 0 && args.length !== 2) throw Error('Use [wms.py qgis_desktop.py] or no arguments');
        const files = args.length ? args : ['publication/wms.py', 'publication/qgis_desktop.py'].map(file => path.join(root, file));
        console.log(JSON.stringify(checkQgisDesktopPlan(...files.map(file => fs.readFileSync(file, 'utf8')))));
    } catch (error) {
        console.error(`QGIS preflight: ${error.message}`);
        process.exitCode = 1;
    }
}
