"""Run inside the pinned QGIS Desktop Python console; see docs/qgis.md."""

import json
import hashlib
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from urllib.request import Request, urlopen

def assert_render_mask(image, settings, reference):
    """Compare stable mask interiors with an independently requested WMS map."""
    from qgis.core import QgsCoordinateReferenceSystem, QgsCoordinateTransform, QgsProject
    extent = settings.visibleExtent()
    transform = QgsCoordinateTransform(settings.destinationCrs(), QgsCoordinateReferenceSystem('EPSG:4326'),
                                       QgsProject.instance())
    checked = opaque = transparent = missing = extra = 0
    for y in range(8, image.height(), 16):
        for x in range(8, image.width(), 16):
            point = transform.transform(extent.xMinimum()+(x+.5)*extent.width()/image.width(),
                                        extent.yMaximum()-(y+.5)*extent.height()/image.height())
            rx = int((point.x()+26)/91*reference.width())
            ry = int((72-point.y())/44*reference.height())
            if not (1 <= rx < reference.width()-1 and 1 <= ry < reference.height()-1):
                continue
            mask = {reference.pixelColor(rx+dx, ry+dy).alpha() > 0 for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
            if len(mask) != 1:  # exclude resampling at the data boundary
                continue
            expected = mask.pop()
            actual = image.pixelColor(x, y).alpha() > 0
            checked += 1
            opaque += expected
            transparent += not expected
            missing += expected and not actual
            extra += actual and not expected
    result = dict(checked=checked, opaque=opaque, transparent=transparent, missing=missing, extra=extra)
    assert opaque and transparent and missing == 0 and extra == 0, result
    return result


def connect_forecast(base, wms_path, key, valid_time, crs='EPSG:3857'):
    """Create a WMS-T layer with ordinary QGIS DPI and request-size defaults."""
    from qgis.core import QgsDataSourceUri, QgsHttpHeaders, QgsRasterLayer

    url = base.rstrip('/') + wms_path
    request = Request(url + '?SERVICE=WMS&REQUEST=GetCapabilities', headers={'X-API-Key': key} if key else {})
    with urlopen(request, timeout=30) as response:
        root = ET.fromstring(response.read())
    times = next(node.text or '' for node in root.findall('.//{*}Dimension') if node.get('name') == 'time')
    if valid_time is not None and valid_time not in times.split(','):
        raise ValueError('Выбранное время отсутствует в ревизии.')
    uri = QgsDataSourceUri()
    for name, value in {'url': url, 'layers': 'temperature',
                        'styles': 'raster', 'format': 'image/png', 'crs': crs,
                        'timeDimensionExtent': times,
                        'version': '1.3.0', 'featureCount': '10',
                        'type': 'wmst', 'allowTemporalUpdates': 'true', 'temporalSource': 'provider'}.items():
        uri.setParam(name, value)
    if valid_time is not None:
        uri.setParam('time', valid_time + '/' + valid_time)
    if key:
        uri.setHttpHeaders(QgsHttpHeaders({'X-API-Key': key}))
    return QgsRasterLayer(bytes(uri.encodedUri()).decode(), 'Температура поверхности, K', 'wms')


def verify_desktop(config_path):
    from qgis.core import (Qgis,
                           QgsProject, QgsMapSettings, QgsMapRendererSequentialJob,
                           QgsCoordinateReferenceSystem, QgsRectangle, QgsPointXY,
                           QgsDateTimeRange, QgsDataSourceUri)
    from qgis.PyQt.QtCore import QDateTime, Qt, QSize, QEventLoop, QTimer
    from qgis.PyQt.QtGui import QColor, QImage, QPainter

    assert Qgis.QGIS_VERSION == '3.44.11-Solothurn', Qgis.QGIS_VERSION
    config = json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
    report = Path(config['report_directory'])
    key = Path(config['key_file']).read_text().strip()
    http = json.loads((report / 't11-http.json').read_text())
    selected = http['selection']

    observations, standard_identify, masks = [], [], []
    project = QgsProject.instance()
    initial_dirty = project.isDirty()
    owned = []
    try:
        for crs in ('EPSG:4326', 'EPSG:3857'):
            layer = connect_forecast(config['base'], selected['wms'], key, None, crs)
            assert layer.isValid(), 'Не удалось подключить слой WMS; проверьте журнал QGIS без публикации URI с ключом.'
            project.addMapLayer(layer)
            owned.append(layer.id())
            uri = QgsDataSourceUri()
            uri.setEncodedUri(layer.source())
            assert not any(uri.hasParam(name) for name in ('dpiMode', 'maxWidth', 'maxHeight',
                'IgnoreGetMapUrl', 'IgnoreGetFeatureInfoUrl', 'time'))
            provider = layer.dataProvider()
            assert provider.temporalCapabilities().hasTemporalCapabilities()
            available = provider.temporalCapabilities().allAvailableTemporalRanges()
            assert len(available) == len(http['choices']), len(available)
            assert layer.temporalProperties().isActive()
            assert layer.temporalProperties().mode() == Qgis.RasterTemporalMode.TemporalRangeFromDataProvider
            assert provider.temporalCapabilities().intervalHandlingMethod() == (
                Qgis.TemporalIntervalMatchMethod.MatchExactUsingStartOfRange)
            for item in http['choices']:
                instant = QDateTime.fromString(item['valid_time'], Qt.ISODate)
                temporal_range = QgsDateTimeRange(instant, instant)
                settings = QgsMapSettings()
                settings.setLayers([layer])
                settings.setDestinationCrs(QgsCoordinateReferenceSystem(crs))
                # Larger than the advertised image limit; the provider must tile
                # automatically without maxWidth/maxHeight overrides in its URI.
                settings.setOutputSize(QSize(1204, 700))
                settings.setBackgroundColor(QColor(0, 0, 0, 0))
                settings.setIsTemporal(True)
                settings.setTemporalRange(temporal_range)
                extent = (QgsRectangle(-26, 28, 65, 72) if crs == 'EPSG:4326'
                          else QgsRectangle(-2900000, 3200000, 7200000, 11700000))
                settings.setExtent(extent)
                job = QgsMapRendererSequentialJob(settings)
                job.start()
                job.waitForFinished()
                assert not job.errors(), [error.message for error in job.errors()]
                image = job.renderedImage()
                assert not image.isNull()
                query = ('?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=temperature&STYLES=raster'
                         '&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:4326&BBOX=28,-26,72,65'
                         '&WIDTH=512&HEIGHT=256&TIME='+item['valid_time'])
                with urlopen(Request(config['base']+selected['wms']+query, headers={'X-API-Key': key}), timeout=35) as response:
                    reference = QImage.fromData(response.read())
                assert not reference.isNull()
                mask = assert_render_mask(image, settings, reference)
                masks.append({'source_crs': crs, 'project_crs': crs, 'time': item['valid_time'], **mask})
                fragment = image.copy()
                painter = QPainter(fragment)
                painter.setCompositionMode(QPainter.CompositionMode_Source)
                painter.fillRect(0, 0, fragment.width()//2, fragment.height(), QColor(0, 0, 0, 0))
                painter.end()
                try:
                    assert_render_mask(fragment, settings, reference)
                except AssertionError:
                    pass
                else:
                    raise AssertionError('Проверка маски приняла изображение с удалённым фрагментом.')
                image.save(str(report / f"qgis-{crs.split(':')[1]}-{item['valid_time'][11:13]}.png"))
                # QGIS renders a cloned pipe. Python does not expose the C++
                # setRequestedTemporalRange mutator on the original provider.
                # A fresh provider with this exact URI time pins identify too.
                identify_layer = connect_forecast(config['base'], selected['wms'], key, item['valid_time'], crs)
                assert identify_layer.isValid(), 'Не удалось подключить слой для определения значения.'
                identify_provider = identify_layer.dataProvider()
                # Use coordinates independently retained by HTTP/native reference,
                # never derive expected values from the QGIS portrayal.
                for probe in [p for p in http['observations'] if p['time'] == item['valid_time'] and p['crs'] == crs]:
                    lon, lat = probe['native']
                    # Reconstruct the approved zero-height native -> WGS84
                    # operation using QGIS/PROJ, independently of the Python sampler.
                    import math
                    phi = math.radians(lat)
                    e2 = 6.6943799901413165e-3
                    geodetic = math.atan2(math.sin(phi), (1-e2) * math.cos(phi))
                    # Iterative inverse cartesian on the WGS84 ellipsoid.
                    radius = 6371229.
                    p, z = radius * math.cos(phi), radius * math.sin(phi)
                    for _ in range(10):
                        n = 6378137. / math.sqrt(1-e2*math.sin(geodetic)**2)
                        geodetic = math.atan2(z+e2*n*math.sin(geodetic), p)
                    gx, gy = lon, math.degrees(geodetic)
                    if crs == 'EPSG:3857':
                        x, y = 6378137.*math.radians(gx), 6378137.*math.log(math.tan(math.pi/4+geodetic/2))
                        delta = 150.
                    else:
                        x, y, delta = gx, gy, .001
                    result = identify_provider.identify(QgsPointXY(x, y), Qgis.RasterIdentifyFormat.Text,
                                               QgsRectangle(x-delta, y-delta, x+delta, y+delta), 1205, 701)
                    assert result.isValid(), result.error().message()
                    text = '\n'.join(str(v) for v in result.results().values())
                    match = re.search(r'GRAY_INDEX\s*=\s*([^\s]+)', text)
                    if probe['value_K'] is not None:
                        assert match and abs(float(match[1])-probe['value_K']) <= .0001, text
                    else:
                        assert match is None or match[1].lower() in ('nan', 'null'), text
                    if probe['native'] == [20., 50.]:
                        # Use the map tool on this SAME layer after each time
                        # change, with no URI time pinning or request-size hints.
                        actual = identify_in_canvas(layer, crs, x, y, delta, temporal_range)
                        value = re.search(r'GRAY_INDEX\s*=\s*([^\s]+)', actual)
                        assert value and abs(float(value[1])-probe['value_K']) <= .0001, actual
                        standard_identify.append({'crs': crs, 'time': item['valid_time'],
                            'expected_K': probe['value_K'], 'identify': actual,
                            'canvas': [1204, 700], 'uri_time': False, 'dpi_size_overrides': False})
                    observations.append({'crs': crs, 'time': item['valid_time'], 'native': [lon, lat],
                                         'expected_K': probe['value_K'], 'identify': text})
            loop = QEventLoop()
            images, errors = [], []
            fetcher = provider.getLegendGraphicFetcher(settings)
            assert fetcher is not None
            def finished(image):
                images.append(image)
                loop.quit()

            def failed(error):
                errors.append(error)
                loop.quit()

            fetcher.finish.connect(finished)
            fetcher.error.connect(failed)
            timer = QTimer()
            timer.setSingleShot(True)
            timer.timeout.connect(loop.quit)
            timer.start(30000)
            fetcher.start()
            loop.exec()
            assert images and not errors and not images[0].isNull(), errors
            images[0].save(str(report / f"qgis-legend-{crs.split(':')[1]}.png"))
        (report / 't11-desktop.json').write_text(json.dumps({'status': 'passed',
            'qgis_version': Qgis.QGIS_VERSION, 'selected': selected,
            'input_inventory_sha256': hashlib.sha256((report / 'inputs-start.json').read_bytes()).hexdigest(),
            'method': 'QGIS Desktop WMS provider, temporal map renderer, identify and legend fetcher',
            'observations': observations, 'standard_identify': standard_identify, 'masks': masks,
            'negative_fragment_rejected': True}, indent=2) + '\n')
        print('QGIS Desktop: карта, время, легенда и значения проверены.')
    finally:
        for layer_id in owned:
            project.removeMapLayer(layer_id)
        project.setDirty(initial_dirty)


def verify_cold_matrix(config_path, offset=0, count=4):
    """Run a bounded batch; every case gets a fresh loopback origin/cache key."""
    import contextlib
    import itertools
    import runpy
    config = json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
    report = Path(config['report_directory'])
    http = json.loads((report/'t11-http.json').read_text())
    times = sorted({item['valid_time'] for item in http['choices']})
    assert len(times) >= 2
    directory = report/'cold-matrix'
    directory.mkdir(exist_ok=True)
    selection = dict(http['selection'])
    selection['wms'] = selection['wms'].removeprefix('/org')
    selection_file = directory/'selection.json'
    selection_file.write_text(json.dumps(selection))
    probe = runpy.run_path(str(Path(__file__).resolve().parents[1]/'tools/diagnose-qgis-wms.py'))['diagnose_wms']
    cases = list(itertools.product(('public', 'org'), ('EPSG:4326', 'EPSG:3857'),
                 ('EPSG:4326', 'EPSG:3857', 'EPSG:3576'), ((320, 187), (1204, 700)), (times[0], times[-1])))
    for index in range(offset, min(offset+count, len(cases))):
        profile, source, target, size, valid_time = cases[index]
        case = {'origin': config['base'], 'selection_file': str(selection_file),
                'report_directory': str(directory/f'case-{index:02d}'), 'source_crs': source,
                'project_crs': target, 'size': size, 'valid_time': valid_time,
                'extent': [10, 45, 30, 55], 'sequential': False}
        if profile == 'org':
            case['key_file'] = config['key_file']
        case_file = directory/f'config-{index:02d}.json'
        case_file.write_text(json.dumps(case))
        with (directory/f'case-{index:02d}.log').open('w', encoding='utf-8') as stream, contextlib.redirect_stdout(stream):
            result = probe(str(case_file))
        assert result['qgis_version'] == '3.44.11-Solothurn'
        assert set(result['http_statuses']) == {'200'}, result['http_statuses']
        print(f'Cold WMS {index+1}/{len(cases)}: {profile}, {source} -> {target}, {size}, {valid_time}: passed')
    files = [directory/f'case-{index:02d}'/'result.json' for index in range(len(cases))]
    if all(path.exists() for path in files):
        results = [json.loads(path.read_text()) for path in files]
        assert all(item['passed'] and set(item['http_statuses']) == {'200'} for item in results)
        assert all(all(item['cleanup'][key] for key in ('project_unchanged', 'proxy_thread_stopped', 'proxy_socket_closed')) for item in results)
        (report/'t11-cold-matrix.json').write_text(json.dumps({'status': 'passed', 'cases': len(results),
            'input_inventory_sha256': hashlib.sha256((report/'inputs-start.json').read_bytes()).hexdigest(),
            'results': results}, indent=2))


def identify_in_canvas(layer, crs, x, y, delta, temporal_range):
    """Exercise the actual Identify tool without touching the user's canvas."""
    from qgis.core import QgsCoordinateReferenceSystem, QgsRectangle, QgsIdentifyContext
    from qgis.gui import QgsMapCanvas, QgsMapToolIdentify
    canvas = QgsMapCanvas()
    canvas.resize(1204, 700)
    canvas.setDestinationCrs(QgsCoordinateReferenceSystem(crs))
    canvas.setExtent(QgsRectangle(x-delta, y-delta, x+delta, y+delta))
    canvas.setLayers([layer])
    context = QgsIdentifyContext()
    context.setTemporalRange(temporal_range)
    tool = QgsMapToolIdentify(canvas)
    try:
        results = tool.identify(canvas.width()//2, canvas.height()//2, [layer],
                                QgsMapToolIdentify.TopDownAll, context)
        return '\n'.join(str(value) for result in results for value in result.mAttributes.values())
    finally:
        canvas.setLayers([])
        tool.deleteLater()
        canvas.deleteLater()
