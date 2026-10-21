import { publishedGroups, referenceTime } from './selection.js';
import { FieldLoader, json } from './field.js';
import { create, clippedLine } from './geometry.js';
import { WeatherLayer } from './weather-layer.js';
import { nativeToWgs } from './native-layer.js';
import { LocalContext } from './local-context.js';
const $ = (id) => document.getElementById(id);
const control = (id) => $(id);
const text = (id, value) => { $(id).textContent = value; };
const mobile = () => matchMedia('(max-width:700px), (max-height:600px) and (orientation:landscape)').matches;
const loader = new FieldLoader();
const validation = new URLSearchParams(location.search).get('validation') === '1';
const validationFixtures = validation && new URLSearchParams(location.search).get('fixtures') === '1';
let groups = [], group, index = 0, mode = 'mercator';
let selected, data, map, layer;
let position, point, pointController = new AbortController();
let center = [19.5, 53], viewVersion = 0, selectionVersion = 0, mapWork = Promise.resolve();
let mapMode = 'mercator';
let ownedCanvas;
let screenPick;
let unit = 'C', alternate = false, light = false, pointCollapsed = false, lost = false, rendererError = '';
let metadata, bootController = new AbortController(), pendingGroups;
let firstCompleteMs, lastFrame;
const frames = [];
const renderTimes = [];
let warmSwitchMs;
const panels = ['forecastPanel', 'navigationPanel', 'legendPanel', 'timelinePanel'].map(id => $(id));
const timestamp = (value) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) + ' UTC';
const degrees = (value) => value.toFixed(3) + '°';
const valueText = (value) => (value - (unit === 'C' ? 273.15 : 0)).toFixed(2) + ' ' + (unit === 'C' ? '°C' : 'K');
function notice(message) { text('notice', message); $('notice').hidden = !message; }
function rendererFailure(error) {
    console.error('Ошибка графического слоя', error);
    rendererError = 'Браузер или графический процессор не поддерживает выбранный режим. Попробуйте Меркатор или обновите браузер.';
    text('projectionStatus', 'Режим недоступен. ' + rendererError);
    $('useMercator').hidden = false;
    notice('Карта недоступна. ' + rendererError);
    placePoint();
}
function selectionDetails() {
    if (!group)
        return;
    const source = group.selection;
    text('reference', 'Расчёт: ' + timestamp(referenceTime(source.run)));
    const valid = new Date(group.start + index * 3600000).toISOString();
    text('valid', 'Прогноз: ' + timestamp(valid));
    text('compactTime', timestamp(valid));
    text('timeLabel', timestamp(valid));
    text('selectionIdentity', 'Редакция ' + source.revision.slice(0, 12));
    text('forecastSummary', (source.fixture === 'overlap' ? 'Тестовый перекрывающийся расчёт · ' : '') + source.model + ' · ' + timestamp(referenceTime(source.run)));
    text('availability', selected ? 'Срок опубликован' : 'Срок отсутствует');
    const age = Math.max(0, Math.floor((Date.now() - Date.parse(referenceTime(source.run))) / 3600000));
    const completeness = source.completeness === 'complete' ? 'полный' : source.completeness === 'partial' ? 'неполный' : 'неизвестна';
    text('metadata', 'Возраст расчёта: ' + age + ' ч. Полнота: ' + completeness + '. ' +
        'Опубликовано сроков: ' + group.times.filter(Boolean).length + '. ' +
        'Источник: DWD ICON-EU, T_G, поверхность. Выборка: ' + (selected?.selection ?? 'отсутствует') + '. ' +
        (metadata ? 'Происхождение: ' + JSON.stringify(metadata) : ''));
}
function timeControls() {
    if (!group)
        return;
    control('time').replaceChildren(...group.times.map((item, i) => new Option(timestamp(new Date(group.start + i * 3600000).toISOString()) + (item ? '' : ' · отсутствует'), String(i))));
    const range = $('timeRange');
    range.min = '0';
    range.max = String(group.times.length - 1);
    range.step = '1';
    syncTime();
}
function syncTime() {
    control('time').value = String(index);
    $('timeRange').value = String(index);
    $('previous').disabled = index === 0;
    $('next').disabled = index === (group?.times.length ?? 1) - 1;
}
function setGroup(newGroup) { group = newGroup; index = 0; timeControls(); void chooseTime(0); }
function clearPoint() {
    pointController.abort();
    point = undefined;
    position = undefined;
    pointCollapsed = false;
    $('drawer').hidden = true;
    placePoint();
}
function releaseLayer() {
    const previous = layer;
    layer = undefined;
    previous?.context?.remove();
    if (previous && map?.getLayer(previous.id))
        map.removeLayer(previous.id);
}
async function chooseTime(next) {
    if (!group)
        return;
    index = Math.max(0, Math.min(group.times.length - 1, next));
    syncTime();
    const version = ++selectionVersion;
    ++viewVersion;
    loader.cancel();
    clearPoint();
    renderPoint('Выбор прогноза изменён. Выберите точку заново.');
    selected = group.times[index] ?? undefined;
    data = undefined;
    metadata = undefined;
    releaseLayer();
    selectionDetails();
    layout();
    if (!selected) {
        notice('В выбранной редакции этот срок отсутствует. Слой и значение точки скрыты.');
        return;
    }
    notice('Загрузка числового поля…');
    const current = selected;
    try {
        const [field, description] = await Promise.all([loader.load(current), json(current.collection, loader.controller.signal)]);
        if (version !== selectionVersion)
            return;
        data = field;
        metadata = description;
        selectionDetails();
        await rebuild(!map);
    }
    catch (error) {
        if (version === selectionVersion && error.name !== 'AbortError') {
            console.error('Ошибка загрузки прогноза', error);
            notice('Не удалось загрузить опубликованное поле. Откройте настройки и повторите загрузку.');
        }
    }
}
function coverage(raw = false) {
    const [west, south, east, north] = data.metadata.grid.outer_cell_edges_wsen, ring = [];
    for (let i = 0; i <= 160; i++)
        ring.push([west + (east - west) * i / 160, nativeToWgs(south)]);
    for (let i = 0; i <= 100; i++)
        ring.push([east, nativeToWgs(south + (north - south) * i / 100)]);
    for (let i = 0; i <= 160; i++)
        ring.push([east - (east - west) * i / 160, nativeToWgs(north)]);
    for (let i = 0; i <= 100; i++)
        ring.push([west, nativeToWgs(north - (north - south) * i / 100)]);
    return !raw && mode !== 'mercator' ? clippedLine(ring, mode === 'laea' ? [90, 90] : center, mode === 'laea' ? 45 : 89.99999) :
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring } };
}
function visible(p) {
    if (mode === 'laea')
        return p.lat >= 45;
    if (mode !== 'orthographic')
        return true;
    const rad = Math.PI / 180, phi = p.lat * rad, c = center[1] * rad;
    return Math.sin(phi) * Math.sin(c) + Math.cos(phi) * Math.cos(c) * Math.cos((p.lng - center[0]) * rad) > 0;
}
function projection() {
    return proj4('EPSG:4326', mode === 'laea' ? 'EPSG:3576' : mode === 'mercator' ? 'EPSG:3857' :
        `+proj=ortho +lat_0=${center[1]} +lon_0=${center[0]} +R=6378137 +units=m +no_defs`);
}
async function rebuild(fit = false) {
    const version = ++viewVersion;
    mapWork = mapWork.catch(() => { }).then(async () => {
        if (version !== viewVersion || !data || lost)
            return;
        const currentData = data;
        const mountStart = performance.now();
        const scale = layer?.geometry().scale, zoom = map?.getZoom() ?? 0;
        if (map && mapMode !== 'orthographic') {
            const c = map.getCenter();
            center = [c.lng, c.lat];
        }
        if (mode === 'laea')
            center = [center[0], Math.max(45, center[1])];
        releaseLayer();
        ownedCanvas = undefined;
        map = await create(mode === 'laea' ? 'EPSG:3576' : mode === 'orthographic' ? 'hmc:orthographic' : 'mercator', center, zoom);
        mapMode = mode;
        if (version !== viewVersion || currentData !== data) {
            map.remove();
            map = undefined;
            return;
        }
        map.dragRotate.disable();
        map.touchZoomRotate.disableRotation();
        const canvas = map.getCanvas();
        ownedCanvas = canvas;
        canvas.addEventListener('webglcontextlost', (event) => {
            if (ownedCanvas !== canvas)
                return;
            event.preventDefault();
            lost = true;
            loader.cancel();
            ++selectionVersion;
            notice('Графический контекст потерян. Ожидается восстановление.');
            placePoint();
        });
        canvas.addEventListener('webglcontextrestored', () => {
            if (ownedCanvas !== canvas)
                return;
            lost = false;
            ownedCanvas = undefined;
            releaseLayer();
            map.remove();
            map = undefined;
            if (data)
                void rebuild(true);
            else
                void chooseTime(index);
        });
        layer = new WeatherLayer(currentData, mode === 'laea' ? 'EPSG:3576' : mode === 'orthographic' ? 'hmc:orthographic' : 'mercator', projection(), center);
        map.addLayer(layer);
        layer.setPalette(alternate);
        if (mode !== 'mercator')
            layer.context = new LocalContext(map, coverage(mode === 'orthographic'), mode);
        else {
            map.addSource('coverage', { type: 'geojson', data: coverage() });
            map.addLayer({ id: 'coverage', source: 'coverage', type: 'line', paint: { 'line-color': '#fff', 'line-width': 1 } });
        }
        rendererError = '';
        $('useMercator').hidden = true;
        if (scale && !fit) {
            const ratio = scale / layer.geometry().scale;
            if (Number.isFinite(ratio) && ratio > 0)
                map.setZoom(map.getZoom() + Math.log2(ratio));
        }
        if (fit)
            fitCoverage();
        map.on('render', placePoint);
        map.on('click', (event) => void pickScreen(event));
        lastFrame = undefined;
        map.on('render', () => {
            const now = performance.now();
            if (layer?.ready && !lost) {
                firstCompleteMs ??= now;
                renderTimes.push(now);
                if (renderTimes.length > 120)
                    renderTimes.shift();
                if ($('notice').textContent === 'Загрузка числового поля…')
                    notice('');
                if (lastFrame !== undefined) {
                    frames.push(now - lastFrame);
                    if (frames.length > 120)
                        frames.shift();
                }
                lastFrame = now;
            }
        });
        map.once('render', () => { warmSwitchMs = performance.now() - mountStart; });
        for (const [name, coords] of [['Москва', [37.6173, 55.7558]], ['Санкт-Петербург', [30.3158, 59.9391]]]) {
            const label = document.createElement('div');
            label.className = 'mapLabel';
            label.textContent = '● ' + name;
            label.dataset.point = JSON.stringify(coords);
            map.getContainer().append(label);
            map.on('render', () => {
                label.hidden = !visible({ lng: coords[0], lat: coords[1] });
                const p = layer?.project([...coords]);
                if (p)
                    Object.assign(label.style, { left: p.x + 'px', top: p.y + 'px' });
            });
            map.once('remove', () => label.remove());
        }
        map.on('error', () => { notice('Ошибка карты. Повторите загрузку.'); });
        text('projectionStatus', mode === 'laea' ? 'Показано к северу от 45° с. ш.; южнее — в других видах.' : mode === 'orthographic' ? 'Ортографический глобус. Вращайте перетаскиванием.' : 'Всё доступное покрытие прогноза.');
        text('compactProjection', mode === 'laea' ? 'LAEA 3576 · ≥45° с. ш.' : mode === 'orthographic' ? 'Глобус' : 'Меркатор');
        if ($('notice').textContent?.startsWith('Графический контекст'))
            notice('');
        updateBasemap();
        placePoint();
        layout();
    }).catch(error => { if (version === viewVersion && data)
        rendererFailure(error); });
    await mapWork;
}
function fitCoverage() {
    if (!map || !data || !layer || lost || rendererError)
        return;
    const [w, s, e, n] = data.metadata.grid.outer_cell_edges_wsen;
    if (mode === 'orthographic')
        rotate([(w + e) / 2, (nativeToWgs(s) + nativeToWgs(n)) / 2]);
    const south = mode === 'laea' ? Math.max(45, nativeToWgs(s)) : nativeToWgs(s);
    const points = [];
    for (let i = 0; i <= 60; i++)
        for (const lat of [south, nativeToWgs(n)])
            points.push([w + (e - w) * i / 60, lat]);
    // Fit in the registered projected plane; orthographic camera remains fixed.
    const projected = points.map(p => projection().forward(p));
    const xmin = Math.min(...projected.map(p => p[0])), xmax = Math.max(...projected.map(p => p[0]));
    const ymin = Math.min(...projected.map(p => p[1])), ymax = Math.max(...projected.map(p => p[1]));
    const g = layer.geometry(), dpr = map.getCanvas().width / map.getContainer().clientWidth;
    const target = Math.min(map.getContainer().clientWidth * .88 * dpr / (xmax - xmin), map.getContainer().clientHeight * .66 * dpr / (ymax - ymin));
    const delta = Math.log2(target / g.scale);
    map.setZoom(map.getZoom() + delta);
    if (mode !== 'orthographic')
        map.setCenter(projection().inverse([(xmin + xmax) / 2, (ymin + ymax) / 2]));
}
function rotate(next) {
    center = [((next[0] + 540) % 360) - 180, Math.max(-89.99, Math.min(89.99, next[1]))];
    if (mode === 'orthographic' && layer)
        layer.setCenter(center, projection());
    placePoint();
}
function placePoint() {
    $('pointMarker').hidden = true;
    $('pointCard').hidden = true;
    $('showPoint').hidden = !position;
    if (!position || !layer || rendererError || lost)
        return;
    const hidden = !visible(position);
    const message = hidden ? (mode === 'laea' ? 'Точка сохранена вне области от 45° с. ш.' : 'Точка сохранена за горизонтом глобуса.') : '';
    if (message)
        notice(message);
    else if ($('notice').textContent?.startsWith('Точка сохранена'))
        notice('');
    const pixel = layer.project([position.lng, position.lat]);
    const onscreen = !hidden && pixel.x >= 0 && pixel.x <= innerWidth && pixel.y >= 0 && pixel.y <= innerHeight;
    $('pointMarker').hidden = !onscreen;
    Object.assign($('pointMarker').style, { left: pixel.x + 'px', top: pixel.y + 'px' });
    if (!onscreen || mobile() || pointCollapsed)
        return;
    const card = $('pointCard');
    card.hidden = false;
    Object.assign(card.style, { left: Math.max(10, Math.min(innerWidth - 310, pixel.x + 18)) + 'px', top: Math.max(70, Math.min(innerHeight - card.offsetHeight - 165, pixel.y - 30)) + 'px' });
}
function renderPoint(message) {
    for (const id of ['pointContent', 'mobilePoint']) {
        const container = $(id);
        container.replaceChildren();
        const coordinate = document.createElement('small');
        coordinate.textContent = position ? degrees(position.lng) + ' в. д. · ' + degrees(position.lat) + ' с. ш.' : '';
        const value = document.createElement('strong');
        value.textContent = message ?? (point?.value != null ? valueText(point.value) :
            point?.reason === 'outside_coverage' ? 'Вне покрытия' : point?.reason === 'native_nodata' ? 'Нет данных в нативной ячейке' : 'Загрузка значения…');
        const details = document.createElement('details'), summary = document.createElement('summary'), provenance = document.createElement('p');
        summary.textContent = 'Ячейка и происхождение';
        provenance.textContent = point ?
            'Ближайшая нативная ячейка · точный срок UTC. ' + (point.cell ? `Строка ${point.cell.row}, столбец ${point.cell.column}; ${degrees(point.cell.lon)}, ${degrees(point.cell.lat)}. ` : '') +
                'Выборка: ' + point.selection + '. Редакция: ' + point.revision + '. Источник: ' + JSON.stringify(point.source) : '';
        details.append(summary, provenance);
        container.append(coordinate, value, details);
    }
    placePoint();
}
async function pickScreen(event) {
    if (!layer || !selected || lost || rendererError)
        return;
    let pixel = [event.point.x, event.point.y];
    const original = event.originalEvent?.changedTouches?.[0] ?? event.originalEvent;
    if (Number.isFinite(original?.clientX)) {
        const rect = map.getCanvas().getBoundingClientRect();
        pixel = [original.clientX - rect.left, original.clientY - rect.top];
    }
    const g = layer.geometry(), dpr = g.width / map.getContainer().clientWidth;
    const p = projection().inverse([(pixel[0] * dpr - g.origin[0]) / g.scale, (g.origin[1] - pixel[1] * dpr) / g.scale]);
    const candidate = { lng: ((p[0] + 540) % 360) - 180, lat: p[1] };
    if (!p.every(Number.isFinite) || Math.abs(p[1]) > 90 || !visible(candidate))
        return;
    const projected = layer.project([candidate.lng, candidate.lat]);
    if (Math.hypot(projected.x - pixel[0], projected.y - pixel[1]) > .5)
        return;
    screenPick = { pixel: [pixel[0] * dpr, pixel[1] * dpr], ...g, center: [...center], mode: mode === 'orthographic' ? 'hmc:orthographic' : mode === 'laea' ? 'EPSG:3576' : 'mercator' };
    pointController.abort();
    pointController = new AbortController();
    const signal = pointController.signal, current = selected;
    position = candidate;
    point = undefined;
    pointCollapsed = false;
    renderPoint();
    if (mobile())
        openDrawer(true);
    const query = new URLSearchParams({ selection: current.selection, run: current.run, revision: current.revision,
        valid_time: current.valid_time, layer: current.field, lon: String(candidate.lng), lat: String(candidate.lat),
        crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' });
    try {
        const result = await json('/api/v1/point?' + query, signal);
        signal.throwIfAborted();
        if (current !== selected || ['selection', 'run', 'revision', 'valid_time', 'field'].some(key => result[key] !== current[key]) ||
            result.spatial_selection !== 'nearest-native-cell' || result.units !== 'K')
            throw Error('Несогласованное значение точки.');
        point = result;
        renderPoint();
    }
    catch (error) {
        if (!signal.aborted)
            renderPoint('Не удалось получить значение. Повторите выбор точки.');
    }
}
function openDrawer(pointMode = false) {
    if (mobile())
        for (const panel of panels)
            panel.open = false;
    $('drawer').hidden = false;
    $('drawer').classList.toggle('pointMode', pointMode);
    $('settingsBody').hidden = pointMode;
    $('mobilePoint').hidden = !pointMode;
    $('collapsePoint').hidden = !pointMode;
}
function palette() {
    for (const e of document.querySelectorAll('.unit'))
        e.textContent = unit === 'C' ? '°C' : 'K';
    text('legendSummary', 'Температура · ' + (unit === 'C' ? '°C' : 'K'));
    const ticks = document.querySelectorAll('.ticks span');
    [-20, 0, 20, 40].forEach((value, i) => ticks[i].textContent = String(unit === 'C' ? value : value + 273.15));
    const ramp = document.querySelector('.ramp');
    ramp.style.background = alternate ? 'linear-gradient(90deg,#1f2e8c,#ffcc33)' : '';
    layer?.setPalette(alternate);
    if (position)
        renderPoint();
}
function updateBasemap() {
    document.body.classList.toggle('basemapLight', light);
    if (!map)
        return;
    if (layer?.context) {
        layer.context.last = undefined;
        layer.context.water = light ? '#c7dbe4' : '#314d5b';
        layer.context.landColor = light ? '#e8e5d8' : '#52615e';
    }
    if (map.getLayer('background'))
        map.setPaintProperty('background', 'background-color', light ? '#c7dbe4' : '#314d5b');
    if (map.getLayer('water'))
        map.setPaintProperty('water', 'fill-color', light ? '#c7dbe4' : '#314d5b');
    map.setPaintProperty('land', 'fill-color', light ? '#e8e5d8' : '#52615e');
    map.triggerRepaint();
}
function layout() {
    document.documentElement.style.setProperty('--time-height', $('timelinePanel').getBoundingClientRect().height + 'px');
    if (!mobile())
        document.querySelector('.projectionControl').style.top = (document.querySelector('.selection').getBoundingClientRect().bottom + 8) + 'px';
    else
        document.querySelector('.projectionControl').style.top = '';
    map?.resize();
    placePoint();
}
control('projection').onchange = () => { mode = control('projection').value; void rebuild(); };
$('useMercator').onclick = () => { mode = 'mercator'; control('projection').value = mode; void rebuild(true); };
$('fit').onclick = fitCoverage;
$('zoomIn').onclick = () => map?.zoomIn();
$('zoomOut').onclick = () => map?.zoomOut();
for (const [id, delta] of [['west', -20], ['east', 20]])
    $(id).onclick = () => {
        if (mode === 'orthographic')
            rotate([center[0] + delta, center[1]]);
        else if (map) {
            const c = map.getCenter();
            map.panTo([c.lng + delta, c.lat]);
        }
    };
control('units').onchange = () => { unit = control('units').value; palette(); };
control('palette').onchange = () => { alternate = control('palette').value === 'contrast'; palette(); };
control('time').onchange = () => void chooseTime(Number(control('time').value));
$('timeRange').oninput = event => void chooseTime(Number(event.target.value));
$('previous').onclick = () => void chooseTime(index - 1);
$('next').onclick = () => void chooseTime(index + 1);
control('run').onchange = () => { const found = groups.find(item => item.key === control('run').value); if (found)
    setGroup(found); };
$('settings').onclick = () => openDrawer();
$('temperature').onclick = () => openDrawer();
$('closeDrawer').onclick = () => { $('drawer').hidden = true; pointCollapsed = true; placePoint(); };
$('collapsePoint').onclick = $('closeDrawer').onclick;
$('showPoint').onclick = () => { pointCollapsed = false; if (mobile())
    openDrawer(true); placePoint(); };
$('closePoint').onclick = clearPoint;
$('clearMobilePoint').onclick = clearPoint;
addEventListener('keydown', event => { if (event.key === 'Escape')
    clearPoint(); });
control('basemap').onchange = () => { light = control('basemap').value === 'light'; updateBasemap(); };
control('font').onchange = () => { document.documentElement.style.setProperty('--page-font', control('font').value === 'courier' ? '"Courier New",monospace' : 'system-ui,"Segoe UI",sans-serif'); layout(); };
$('retry').onclick = () => groups.length ? void chooseTime(index) : void boot();
for (const panel of panels) {
    panel.open = !mobile();
    panel.addEventListener('toggle', () => {
        if (mobile() && panel.open) {
            for (const other of panels)
                if (other !== panel)
                    other.open = false;
            $('drawer').hidden = true;
        }
        layout();
    });
}
addEventListener('resize', layout);
// One Map and orthographic camera during drag. MapLibre retains pinch/scroll zoom.
let drag;
let multi = false, inertia = 0, suppressClick = false;
const pointers = new Set(), container = $('map');
container.addEventListener('pointerdown', event => {
    cancelAnimationFrame(inertia);
    pointers.add(event.pointerId);
    if (pointers.size === 1)
        suppressClick = false;
    if (pointers.size > 1) {
        multi = true;
        drag = undefined;
        return;
    }
    if (mode === 'orthographic')
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, center: [...center], last: [event.clientX, event.clientY], time: performance.now(), velocity: [0, 0] };
});
container.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId || multi)
        return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) < 5)
        return;
    container.setPointerCapture(event.pointerId);
    suppressClick = true;
    const now = performance.now(), dt = Math.max(1, now - drag.time);
    drag.velocity = [(event.clientX - drag.last[0]) / dt, (event.clientY - drag.last[1]) / dt];
    drag.last = [event.clientX, event.clientY];
    drag.time = now;
    rotate([drag.center[0] - dx * .2, drag.center[1] + dy * .2]);
});
const endDrag = (event) => {
    pointers.delete(event.pointerId);
    if (multi) {
        if (!pointers.size)
            multi = false;
        drag = undefined;
        return;
    }
    const ended = drag;
    drag = undefined;
    if (!ended || event.type === 'pointercancel' || !suppressClick)
        return;
    const velocity = ended.velocity;
    let previous = performance.now();
    const glide = (now) => {
        const dt = Math.min(32, now - previous);
        previous = now;
        velocity[0] *= Math.exp(-dt / 180);
        velocity[1] *= Math.exp(-dt / 180);
        if (mode !== 'orthographic' || Math.hypot(...velocity) < .01)
            return;
        rotate([center[0] - velocity[0] * dt * .2, center[1] + velocity[1] * dt * .2]);
        inertia = requestAnimationFrame(glide);
    };
    inertia = requestAnimationFrame(glide);
};
container.addEventListener('pointerup', endDrag);
container.addEventListener('pointercancel', endDrag);
container.addEventListener('click', event => { if (suppressClick) {
    event.stopImmediatePropagation();
    suppressClick = false;
} }, true);
async function catalogue() { return publishedGroups((await json('/api/v1/catalogue', bootController.signal)).selections, validationFixtures); }
function runControls() {
    control('run').replaceChildren(...groups.map(item => new Option((item.selection.fixture === 'overlap' ? 'Тестовый расчёт · ' : '') + item.selection.model + ' · ' + timestamp(referenceTime(item.selection.run)) + ' · ' + item.selection.revision.slice(0, 8), item.key)));
    if (group)
        control('run').value = group.key;
}
$('refresh').onclick = async () => {
    try {
        pendingGroups = await catalogue();
        const changed = pendingGroups.length > 0 && JSON.stringify(pendingGroups) !== JSON.stringify(groups);
        text('updateStatus', changed ? 'Есть новая публикация. Текущая выборка сохранена до подтверждения.' : 'Новых публикаций нет.');
        $('acceptUpdate').hidden = !changed;
    }
    catch {
        text('updateStatus', 'Не удалось проверить обновления. Текущая выборка сохранена.');
    }
};
$('acceptUpdate').onclick = () => { if (!pendingGroups?.length)
    return; groups = pendingGroups; runControls(); setGroup(groups[0]); control('run').value = groups[0].key; $('acceptUpdate').hidden = true; };
async function boot() {
    bootController.abort();
    bootController = new AbortController();
    notice('Загрузка опубликованных прогнозов…');
    try {
        groups = await catalogue();
        if (!groups.length) {
            notice('Опубликованные прогнозы недоступны.');
            return;
        }
        runControls();
        setGroup(groups[0]);
        control('run').value = groups[0].key;
    }
    catch (error) {
        notice(error.name === 'AbortError' ? 'Загрузка отменена.' : 'Сервис прогнозов недоступен. Откройте настройки и повторите загрузку.');
    }
}
addEventListener('pagehide', () => { ++viewVersion; ++selectionVersion; data = undefined; loader.cancel(); pointController.abort(); bootController.abort(); cancelAnimationFrame(inertia); ownedCanvas = undefined; releaseLayer(); map?.remove(); });
// Read-only numerical evidence surface, enabled solely by an explicit validation URL.
function numericalView() {
    if (!layer?.ready || lost)
        return undefined;
    const view = layer.samples(), p = projection();
    const cases = [['pole', [90, 90]], ['dateline-positive', [180, 80]], ['dateline-negative', [-180, 80]]];
    if (mode === 'laea')
        cases.push(['south-of-cut', [90, 44.999]], ['north-of-cut', [90, 45.001]]);
    const positions = cases.map(([label, point]) => [label, ...p.forward(point)]).filter(item => item.slice(1).every(Number.isFinite));
    if (mode === 'orthographic')
        positions.push(['horizon-inside', 6378137 * .9999, 0], ['horizon-outside', 6378137 * 1.0001, 0]);
    const dpr = view.width / map.getContainer().clientWidth;
    return { ...view, synthetic_geometry: layer.positions(positions), controls: [
            ...[...document.querySelectorAll('.mapLabel')].filter(label => !label.hidden).map(label => {
                const rect = label.getBoundingClientRect();
                return { point: JSON.parse(label.dataset.point), pixel: [rect.left * dpr, rect.top * dpr], source: 'laid-out DOM label' };
            }),
            ...(layer.context ? [[37.6173, 55.7558], [30.3158, 59.9391]].map(point => ({ point, pixel: layer.context.project(point), source: 'local Canvas2D context' })) : [])
        ] };
}
if (validation) {
    Object.assign(window, { captureWeatherEvidence: (samples = false) => ({ ready: Boolean(layer?.ready && !lost), mode, selected, position, point,
            view: samples ? numericalView() : undefined, transfer_bytes: data?.bytes, load_ms: data?.load_ms,
            synthetic_masks: samples && layer?.ready && !lost ? layer.syntheticMasks() : undefined,
            managed_bytes: !lost ? layer?.checkBudget() : undefined, context_lost: lost, renderer_error: rendererError,
            first_complete_ms: firstCompleteMs, render_frames_ms: [...frames], render_times_ms: [...renderTimes], warm_switch_ms: warmSwitchMs,
            upload_timings: layer?.uploadTimings, screen_pick: screenPick }) });
}
palette();
layout();
void boot();
