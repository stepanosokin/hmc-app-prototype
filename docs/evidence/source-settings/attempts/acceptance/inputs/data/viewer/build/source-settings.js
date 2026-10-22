import { referenceTime } from './selection.js';
import { nativeToWgs } from './native-layer.js';
const element = (id) => document.getElementById(id);
/** The public links always describe the requested selection, never a retained frame. */
export class SourceSettings {
    constructor() {
        for (const kind of ['wms', 'api']) {
            element(kind + 'Copy').onclick = async () => {
                const input = element(kind + 'Url'), url = input.value;
                element('copyStatus').textContent = '';
                try {
                    await navigator.clipboard.writeText(url);
                    if (input.value === url)
                        element('copyStatus').textContent = 'Адрес скопирован.';
                }
                catch {
                    if (input.value === url) {
                        input.focus();
                        input.select();
                        element('copyStatus').textContent = 'Выделите и скопируйте адрес вручную.';
                    }
                }
            };
        }
    }
    update(group, index, current, position, description, state, shown, bounds, format) {
        const source = group.selection, time = new Date(group.start + index * 3600000).toISOString();
        const matching = current && description?.identity?.revision === current.revision && description.identity.valid_time === current.valid_time ? description : undefined;
        const complete = source.completeness === 'complete' ? 'полный' : source.completeness === 'partial' ? 'неполный' : 'неизвестна';
        const status = { loading: 'Загрузка', ready: 'Срок опубликован', missing: 'Срок отсутствует', error: 'Ошибка загрузки', expired: 'Публикация истекла' }[state];
        const rows = [['Источник', 'DWD · ICON-EU'], ['Поле', 'Температура поверхности · T_G'],
            ['Расчёт', format(referenceTime(source.run))], ['Выбранный срок', format(time)],
            ['Редакция', source.revision.slice(0, 12)], ['Доступность', status],
            ['Полнота', complete], ['Опубликовано сроков', String(group.times.filter(Boolean).length)],
            ['Возраст расчёта', Math.max(0, Math.floor((Date.now() - Date.parse(referenceTime(source.run))) / 3600000)) + ' ч'],
            ['Числовой метод', 'Ближайшая нативная ячейка · точный срок · K']];
        if (matching?.source?.name)
            rows.push(['Файл источника', matching.source.name]);
        if (shown && shown.selection !== current?.selection)
            rows.push(['Показан прежний кадр',
                'Расчёт ' + format(referenceTime(shown.run)) + ' · срок ' + format(shown.valid_time) + ' · редакция ' + shown.revision.slice(0, 12)]);
        const nodes = [];
        for (const [label, value] of rows) {
            const dt = document.createElement('dt'), dd = document.createElement('dd');
            dt.textContent = label;
            dd.textContent = value;
            nodes.push(dt, dd);
        }
        element('metadata').replaceChildren(...nodes);
        element('linkSelection').textContent = source.model + ' · ' + format(referenceTime(source.run)) + ' · редакция ' + source.revision.slice(0, 12);
        let wms = '', api = '';
        if (state !== 'expired' && source.wms) {
            const url = new URL(source.wms, location.origin);
            url.search = new URLSearchParams({ SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetCapabilities' }).toString();
            wms = url.href;
        }
        // Default sample uses the published native coverage, converted to geographic coordinates.
        const sample = bounds ? [(bounds[0] + bounds[2]) / 2, nativeToWgs((bounds[1] + bounds[3]) / 2)] : undefined;
        const point = position ?? (sample ? { lng: sample[0], lat: sample[1] } : undefined);
        if (current && point && state !== 'expired') {
            const url = new URL(current.point, location.origin);
            url.search = new URLSearchParams({ selection: current.selection, run: current.run, revision: current.revision,
                valid_time: current.valid_time, layer: current.field, lon: String(point.lng), lat: String(point.lat),
                crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' }).toString();
            api = url.href;
        }
        element('linkPoint').textContent = state === 'expired' ? 'Публикация истекла. Перевыберите публикацию.' : !current ? 'Срок отсутствует — запрос точки недоступен.' : point ?
            (position ? 'Выбранная точка: ' : 'Пример — центр покрытия: ') + point.lat.toFixed(4) + '° с. ш., ' + point.lng.toFixed(4) + '° в. д. · ' + format(time) + ' · K' : 'Для примера дождитесь загрузки покрытия или выберите точку на карте.';
        for (const [kind, url] of [['wms', wms], ['api', api]]) {
            const link = element(kind + 'Link'), input = element(kind + 'Url');
            if (input.value !== url)
                element('copyStatus').textContent = '';
            input.value = url;
            input.disabled = !url;
            element(kind + 'Copy').disabled = !url;
            if (url)
                link.href = url;
            else
                link.removeAttribute('href');
            link.setAttribute('aria-disabled', String(!url));
        }
        const technical = element('metadataLink');
        if (current && state !== 'expired')
            technical.href = new URL(current.collection, location.origin).href;
        else
            technical.removeAttribute('href');
        technical.hidden = !current || state === 'expired';
    }
}
