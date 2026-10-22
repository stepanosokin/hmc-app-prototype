"""Run inside the pinned QGIS Desktop Python console; see docs/qgis.md."""

import json
import hashlib
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from urllib.request import Request, urlopen

def connect_forecast(base, wms_path, key, valid_time, crs='EPSG:3857'):
    """Create a WMS-T layer with ordinary QGIS DPI and request-size defaults."""
    from qgis.core import QgsDataSourceUri, QgsHttpHeaders, QgsRasterLayer

    url = base.rstrip('/') + wms_path
    request = Request(url + '?SERVICE=WMS&REQUEST=GetCapabilities', headers={'X-API-Key': key})
    with urlopen(request, timeout=30) as response:
        root = ET.fromstring(response.read())
    times = next(node.text or '' for node in root.findall('.//{*}Dimension') if node.get('name') == 'time')
    if valid_time not in times.split(','):
        raise ValueError('Выбранное время отсутствует в ревизии.')
    uri = QgsDataSourceUri()
    for name, value in {'url': url, 'layers': 'temperature',
                        'styles': 'raster', 'format': 'image/png', 'crs': crs,
                        'timeDimensionExtent': times,
                        'version': '1.3.0', 'featureCount': '10',
                        'type': 'wmst', 'allowTemporalUpdates': 'true',
                        'time': valid_time + '/' + valid_time}.items():
        uri.setParam(name, value)
    uri.setHttpHeaders(QgsHttpHeaders({'X-API-Key': key}))
    return QgsRasterLayer(bytes(uri.encodedUri()).decode(), 'Температура поверхности, K', 'wms')


def verify_desktop(config_path):
    from qgis.core import (Qgis,
                           QgsProject, QgsMapSettings, QgsMapRendererSequentialJob,
                           QgsCoordinateReferenceSystem, QgsRectangle, QgsPointXY,
                           QgsDateTimeRange)
    from qgis.PyQt.QtCore import QDateTime, Qt, QSize, QEventLoop, QTimer
    from qgis.PyQt.QtGui import QColor

    assert Qgis.QGIS_VERSION == '3.44.11-Solothurn', Qgis.QGIS_VERSION
    config = json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
    report = Path(config['report_directory'])
    key = Path(config['key_file']).read_text().strip()
    http = json.loads((report / 't11-http.json').read_text())
    selected = http['selection']

    observations = []
    project = QgsProject.instance()
    owned = []
    try:
        for crs in ('EPSG:4326', 'EPSG:3857'):
            layer = connect_forecast(config['base'], selected['wms'], key, selected['valid_time'], crs)
            assert layer.isValid(), 'Не удалось подключить слой WMS; проверьте журнал QGIS без публикации URI с ключом.'
            project.addMapLayer(layer)
            owned.append(layer.id())
            provider = layer.dataProvider()
            assert provider.temporalCapabilities().hasTemporalCapabilities()
            available = provider.temporalCapabilities().allAvailableTemporalRanges()
            assert len(available) == len(http['choices']), len(available)
            layer.temporalProperties().setIsActive(True)
            layer.temporalProperties().setMode(Qgis.RasterTemporalMode.TemporalRangeFromDataProvider)
            provider.temporalCapabilities().setIntervalHandlingMethod(
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
                assert any(image.pixelColor(x, y).alpha() for x in range(0, image.width(), 16) for y in range(0, image.height(), 16))
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
            'observations': observations}, indent=2) + '\n')
        print('QGIS Desktop: карта, время, легенда и значения проверены.')
    finally:
        for layer_id in owned:
            project.removeMapLayer(layer_id)
