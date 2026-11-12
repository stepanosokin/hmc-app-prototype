"""Run a public WMS coverage probe inside QGIS Desktop via its MCP connection.

Load this file with exec(Path(...).read_text(encoding='utf-8')), then call
diagnose_wms(config_path). The JSON config supplies a frozen catalogue selection,
an unused report directory, local gateway origin, source/project CRS, geographic
extent, image size, and optional sequential forwarding. No project layers,
service policies, application sources or existing caches are modified.
"""

import json
import threading
import time
import xml.etree.ElementTree as ET
from contextlib import nullcontext
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit
from urllib.request import Request, urlopen


def _coverage(image):
    samples = opaque = 0
    grid = []
    for y in range(8, image.height(), 16):
        row = []
        for x in range(8, image.width(), 16):
            present = int(image.pixelColor(x, y).alpha() > 0)
            samples += 1
            opaque += present
            row.append(present)
        grid.append(row)
    return {'samples': samples, 'opaque': opaque,
            'fraction': opaque / samples if samples else 0, 'grid': grid}


def diagnose_wms(config_path, *, enforce=True):
    """Assert complete coverage of a known data-filled interior against GetMap.

    Sequential mode is a diagnostic control, not a deployed fix. Each invocation
    uses a new loopback origin, keeping earlier QGIS cache hits out of the probe.
    A failed assertion is expected on the unfixed parallel reproduction.
    """
    from qgis.core import (Qgis, QgsProject, QgsDataSourceUri, QgsRasterLayer,
                           QgsMapSettings, QgsMapRendererSequentialJob,
                           QgsCoordinateReferenceSystem, QgsCoordinateTransform,
                           QgsRectangle, QgsDateTimeRange, QgsHttpHeaders)
    from qgis.PyQt.QtCore import QSize, QDateTime, Qt
    from qgis.PyQt.QtGui import QColor, QImage

    config = json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
    origin = config['origin'].rstrip('/')
    parsed = urlsplit(origin)
    if (parsed.scheme != 'http' or parsed.hostname != '127.0.0.1'
            or not parsed.port or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment):
        raise ValueError('Укажите локальный HTTP origin без учётных данных.')
    selection = json.loads(Path(config['selection_file']).read_text(encoding='utf-8-sig'))
    route = selection['wms']
    key = Path(config['key_file']).read_text().strip() if config.get('key_file') else ''
    if key:
        route = '/org' + route
    if not route.startswith(('/gis/v1/', '/org/gis/v1/')) or '?' in route or '#' in route:
        raise ValueError('Нужен публичный WMS-путь из каталога без параметров.')
    source, destination = config['source_crs'], config['project_crs']
    if source not in ('EPSG:4326', 'EPSG:3857') or destination not in ('EPSG:4326', 'EPSG:3857', 'EPSG:3576'):
        raise ValueError('Проверка поддерживает WMS 4326/3857 и CRS проекта 4326/3857/3576.')
    report = Path(config['report_directory'])
    report.mkdir(parents=True, exist_ok=False)
    (report / 'config.json').write_text(json.dumps(config, indent=2), encoding='utf-8')
    (report / 'selection.json').write_text(json.dumps(selection, indent=2), encoding='utf-8')
    sequential = bool(config.get('sequential', False))
    requests = []
    serialization = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            incoming = urlsplit(self.path)
            if unquote(incoming.path) != unquote(route):
                self.send_error(404)
                return
            started = time.monotonic()
            try:
                with serialization if sequential else nullcontext():
                    try:
                        response = urlopen(Request(origin + self.path, headers={'X-API-Key': key} if key else {}), timeout=35)
                    except HTTPError as error:
                        response = error
                    with response:
                        body = response.read()
                        status = response.status
                        headers = dict(response.headers)
                self.send_response(status)
                for name in ('Content-Type', 'Cache-Control', 'Retry-After'):
                    if name in headers:
                        self.send_header(name, headers[name])
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                item = {'parameters': dict(parse_qsl(incoming.query)), 'status': status,
                        'type': headers.get('Content-Type'), 'bytes': len(body),
                        'retry_after': headers.get('Retry-After'),
                        'seconds': round(time.monotonic() - started, 3)}
                if status != 200:
                    # Public route only; do not record request headers or URI credentials.
                    item['body'] = body.decode('utf-8', 'replace')[:1000]
                requests.append(item)
                self.wfile.write(body)
            except Exception as error:
                requests.append({'exception': type(error).__name__})
                self.close_connection = True

    class Server(ThreadingHTTPServer):
        daemon_threads = False
        block_on_close = True

    project = QgsProject.instance()

    def project_state():
        return {'layers': sorted(project.mapLayers()), 'dirty': project.isDirty(),
                'crs': project.crs().toWkt()}

    before = project_state()
    server = Server(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever,
                              kwargs={'poll_interval': .05}, daemon=True)
    thread.start()
    local_url = 'http://127.0.0.1:' + str(server.server_port) + route
    result = {'qgis_version': Qgis.QGIS_VERSION, 'source_crs': source,
              'project_crs': destination, 'sequential': sequential,
              'profile': 'org' if key else 'public',
              'selection': selection['selection'], 'run': selection['run'], 'revision': selection['revision'],
              'extent_wgs84': config['extent'], 'size': config['size']}
    layer = settings = job = None
    started = time.monotonic()
    try:
        with urlopen(local_url + '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities', timeout=20) as response:
            capabilities = response.read()
        (report / 'capabilities.xml').write_bytes(capabilities)
        document = ET.fromstring(capabilities)
        names = [node.text for node in document.findall('.//{*}Layer/{*}Name')]
        if len(names) != 1:
            raise ValueError('Ожидался один опубликованный WMS-слой.')
        dimension = next(node for node in document.findall('.//{*}Dimension') if node.get('name') == 'time')
        effective_time = config.get('valid_time', dimension.get('default'))
        if not effective_time or effective_time not in selection['valid_times']:
            raise ValueError('Срок по умолчанию отсутствует в зафиксированной редакции.')
        result.update(layer=names[0], time=effective_time,
                      time_mode='temporal range' if 'valid_time' in config else 'capabilities default')
        uri = QgsDataSourceUri()
        for name, value in {'url': local_url, 'layers': names[0], 'styles': '',
                            'format': 'image/png', 'crs': source, 'version': '1.3.0'}.items():
            uri.setParam(name, value)
        if 'valid_time' in config:
            for name, value in {'timeDimensionExtent': dimension.text or '', 'type': 'wmst',
                                'allowTemporalUpdates': 'true', 'temporalSource': 'provider'}.items():
                uri.setParam(name, value)
        if key:
            uri.setHttpHeaders(QgsHttpHeaders({'X-API-Key': key}))
        layer = QgsRasterLayer(bytes(uri.encodedUri()).decode(), 'Диагностика WMS', 'wms')
        if not layer.isValid():
            raise ValueError('Не удалось подключить диагностический WMS-слой.')
        target = QgsCoordinateReferenceSystem(destination)
        transform = QgsCoordinateTransform(QgsCoordinateReferenceSystem('EPSG:4326'), target, project)
        settings = QgsMapSettings()
        settings.setLayers([layer])
        settings.setDestinationCrs(target)
        settings.setTransformContext(project.transformContext())
        settings.setExtent(transform.transformBoundingBox(QgsRectangle(*config['extent'])))
        settings.setOutputSize(QSize(*config['size']))
        settings.setBackgroundColor(QColor(0, 0, 0, 0))
        if 'valid_time' in config:
            instant = QDateTime.fromString(effective_time, Qt.ISODate)
            settings.setIsTemporal(True)
            settings.setTemporalRange(QgsDateTimeRange(instant, instant))
        job = QgsMapRendererSequentialJob(settings)
        job.start()
        job.waitForFinished()
        image = job.renderedImage()
        if image.isNull() or not image.save(str(report / 'qgis.png')):
            raise ValueError('Не удалось сохранить результат рендера QGIS.')
        result['render_error_count'] = len(job.errors())
        result['qgis'] = _coverage(image)
        # The next GetMap is the independent reference; inspect the actual
        # provider requests collected BEFORE it, not merely the configured time.
        provider_times = [item['parameters'].get('TIME') for item in requests
                          if item.get('parameters', {}).get('REQUEST', '').lower() == 'getmap']
        result['provider_times'] = provider_times
        assert provider_times
        if 'valid_time' in config:
            assert set(provider_times) == {effective_time}, provider_times
        else:
            assert all(value in (None, effective_time) for value in provider_times), provider_times
        extent = settings.visibleExtent()
        reference_crs = destination
        if destination == 'EPSG:3576':
            reference_crs = 'EPSG:4326'
            extent = QgsCoordinateTransform(target, QgsCoordinateReferenceSystem(reference_crs), project).transformBoundingBox(extent)
        bounds = [extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum()]
        result['visible_extent'] = bounds
        if reference_crs == 'EPSG:4326':
            bounds = [bounds[1], bounds[0], bounds[3], bounds[2]]
        width, height = config['size']
        # Keep both axes inside GetMap's advertised 512px maximum.
        scale = 480 / max(width, height)
        parameters = {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap',
                      'LAYERS': names[0], 'STYLES': '', 'FORMAT': 'image/png',
                      'TRANSPARENT': 'TRUE', 'CRS': reference_crs,
                      'BBOX': ','.join(map(str, bounds)),
                      'WIDTH': max(1, round(width * scale)),
                      'HEIGHT': max(1, round(height * scale)), 'TIME': effective_time}
        with urlopen(local_url + '?' + urlencode(parameters), timeout=20) as response:
            raw = response.read()
            result['direct_http_status'] = response.status
        (report / 'direct.png').write_bytes(raw)
        control = QImage.fromData(raw)
        if control.isNull():
            raise ValueError('Контрольный GetMap не вернул изображение.')
        result['direct'] = _coverage(control)
        result['passed'] = (not result['render_error_count']
                            and result['direct']['fraction'] > .999
                            and result['qgis']['fraction'] > .999)
    except Exception as error:
        result.update(passed=False, error_type=type(error).__name__)
        raise
    finally:
        if job is not None and job.isActive():
            job.cancel()
        job = settings = layer = None
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
        result['seconds'] = round(time.monotonic() - started, 3)
        result['cleanup'] = {'project_unchanged': project_state() == before,
                             'proxy_thread_stopped': not thread.is_alive(),
                             'proxy_socket_closed': server.socket.fileno() == -1,
                             'project_layers_created': 0, 'docker_resources_created': 0}
        result['http_statuses'] = {str(status): sum(item.get('status') == status for item in requests)
                                   for status in sorted({item['status'] for item in requests if 'status' in item})}
        (report / 'requests.json').write_text(json.dumps(requests, indent=2), encoding='utf-8')
        (report / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        summary = {key: value for key, value in result.items() if key not in ('qgis', 'direct')}
        for key in ('qgis', 'direct'):
            if key in result:
                summary[key] = {k: v for k, v in result[key].items() if k != 'grid'}
        print(json.dumps(summary, ensure_ascii=False))
    if not all(result['cleanup'][key] for key in ('project_unchanged', 'proxy_thread_stopped', 'proxy_socket_closed')):
        raise AssertionError('Очистка диагностических ресурсов не подтверждена.')
    if enforce and not result['passed']:
        raise AssertionError('Неполное покрытие WMS: QGIS %.1f%%, контроль %.1f%%.' %
                             (100 * result['qgis']['fraction'], 100 * result['direct']['fraction']))
    return result
