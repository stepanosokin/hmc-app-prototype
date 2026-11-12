"""Read-only WMS timing experiment, loaded with runpy inside QGIS Desktop.

Owns one loopback proxy and hidden canvas, never adds project layers. A fresh
proxy port isolates the client URL cache; backend/OS caches are NOT cleared.
Reference requests and layer construction are excluded from render timings.
Windows only. Run in a disposable QGIS profile: large reprojection experiments
can terminate the native process, beyond Python's finally/timeout protection.
"""
import hashlib
import ctypes
import json
import math
import threading
import time
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit
from urllib.request import urlopen


def measure(config_file):
    from qgis.core import (Qgis, QgsApplication, QgsProject, QgsCoordinateReferenceSystem,
                           QgsCoordinateTransform, QgsDataSourceUri, QgsRasterLayer,
                           QgsRectangle, QgsDateTimeRange)
    from qgis.gui import QgsMapCanvas
    from qgis.PyQt import sip
    from qgis.PyQt.QtCore import Qt, QEventLoop, QTimer, QDateTime
    from qgis.PyQt.QtGui import QImage, QColor
    from qgis.PyQt.QtWidgets import QFrame, QApplication
    from qgis.utils import iface

    config = json.loads(Path(config_file).read_text(encoding='utf-8-sig'))
    project = QgsProject.instance()
    profile = Path(QgsApplication.qgisSettingsDirPath()).resolve()
    assert profile == Path(config['isolated_profile']).resolve(), 'Disposable profile mismatch'
    assert not project.mapLayers() and not project.isDirty() and not project.fileName(), 'Disposable empty project required'
    report = Path(config['report']); report.mkdir(parents=True, exist_ok=False)
    (report / 'probe.py').write_bytes(Path(__file__).read_bytes())
    (report / 'config.json').write_text(json.dumps(config, indent=2))
    selection = json.loads(Path(config['selection_file']).read_text(encoding='utf-8-sig'))
    (report / 'selection.json').write_text(json.dumps(selection, indent=2))
    route = selection['wms']; origin = config.get('origin', 'http://127.0.0.1:8140')
    assert origin in ('http://127.0.0.1:8140', 'http://localhost:8140')
    assert route.startswith('/gis/v1/') and '?' not in route
    requests = []; stage = {'name': 'setup'}
    (report / 'responses').mkdir()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            incoming = urlsplit(self.path)
            if unquote(incoming.path) != unquote(route):
                self.send_error(404); return
            row = {'stage': stage['name'], 'parameters': dict(parse_qsl(incoming.query)),
                   'started': time.time()}
            requests.append(row); start = time.perf_counter()
            try:
                try:
                    response = urlopen(origin + self.path, timeout=35)
                except HTTPError as error:
                    response = error
                with response:
                    headers = {k.lower(): v for k, v in response.headers.items()}
                    row['headers_seconds'] = time.perf_counter() - start
                    body = response.read(); status = response.status
                row.update(status=status, seconds=time.perf_counter()-start, bytes=len(body), finished=time.time(),
                           request_id=headers.get('x-request-id'))
                if status == 200 and headers.get('content-type', '').startswith('image/'):
                    digest = hashlib.sha256(body).hexdigest(); row['sha256'] = digest
                    (report / 'responses' / (digest + '.png')).write_bytes(body)
                self.send_response(status)
                for key in ('content-type', 'cache-control', 'retry-after'):
                    if key in headers: self.send_header(key, headers[key])
                self.send_header('Content-Length', str(len(body))); self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                row['client_disconnected'] = True
            except Exception as error:
                row['exception'] = type(error).__name__; self.close_connection = True

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = False; server.block_on_close = True
    thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .05}, daemon=True)
    thread.start(); local = 'http://127.0.0.1:' + str(server.server_port) + route
    project = QgsProject.instance()

    def state():
        return {'layers': sorted(project.mapLayers()), 'dirty': project.isDirty(),
                'project_crs': project.crs().toWkt(),
                'canvas_flags': int(iface.mapCanvas().mapSettings().flags()),
                'canvas_extent': iface.mapCanvas().extent().toString()}

    before = state(); canvas = layer = timer = watchdog = None
    result = {'version': Qgis.QGIS_VERSION, 'before': before, 'steps': [],
              'cache_scope': 'fresh client URL; backend/OS caches retained', 'started': time.time()}
    references = {}
    def memory():
        class Counters(ctypes.Structure):
            _fields_ = [('cb', ctypes.c_ulong), ('faults', ctypes.c_ulong)] + [
                (name, ctypes.c_size_t) for name in ('peak_working_set', 'working_set',
                 'peak_paged', 'paged', 'peak_nonpaged', 'nonpaged', 'pagefile', 'peak_pagefile')]
        counters = Counters(); counters.cb = ctypes.sizeof(counters)
        handle = ctypes.windll.kernel32.GetCurrentProcess
        handle.restype = ctypes.c_void_p
        read = ctypes.windll.psapi.GetProcessMemoryInfo
        read.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
        if not read(handle(), ctypes.byref(counters), counters.cb):
            raise OSError('Cannot read QGIS process memory')
        return {'working_set': counters.working_set, 'peak_working_set': counters.peak_working_set}
    result['memory_before'] = memory()
    try:
        with urlopen(local + '?SERVICE=WMS&REQUEST=GetCapabilities', timeout=35) as response:
            caps = response.read()
        (report / 'capabilities.xml').write_bytes(caps); doc = ET.fromstring(caps)
        name = doc.findtext('.//{*}Layer/{*}Name')
        times = next(n.text for n in doc.findall('.//{*}Dimension') if n.get('name') == 'time').split(',')
        result.update(times=times, max_width=doc.findtext('.//{*}MaxWidth'))
        uri = QgsDataSourceUri()
        for key, value in {'url': local, 'layers': name, 'styles': '', 'crs': config['source_crs'],
                           'format': 'image/png', 'version': '1.3.0', 'type': 'wmst',
                           'timeDimensionExtent': ','.join(times), 'allowTemporalUpdates': 'true',
                           'temporalSource': 'provider'}.items(): uri.setParam(key, value)
        start = time.perf_counter()
        layer = QgsRasterLayer(bytes(uri.encodedUri()).decode(), 'WMS timing diagnostic', 'wms')
        assert layer.isValid(), 'Invalid diagnostic layer (URI withheld)'
        result['layer_setup_seconds'] = time.perf_counter()-start
        assert layer.temporalProperties().isActive(), 'Temporal layer was not auto-enabled'
        width, height = config.get('size', [1206, 521])
        canvas = QgsMapCanvas(); canvas.freeze(True)
        canvas.setAttribute(Qt.WA_DontShowOnScreen, True); canvas.setFrameStyle(QFrame.NoFrame)
        canvas.resize(width, height); canvas.setCanvasColor(QColor(0, 0, 0, 0))
        flags = canvas.mapSettings().flags() | Qgis.MapSettingsFlag.RenderPartialOutput
        canvas.setMapSettingsFlags(flags); canvas.setParallelRenderingEnabled(True)
        canvas.setCachingEnabled(True); canvas.setLayers([layer]); canvas.show()
        QApplication.processEvents()
        result['size'] = [canvas.mapSettings().outputSize().width(), canvas.mapSettings().outputSize().height()]
        result['dpi'] = canvas.mapSettings().outputDpi()
        assert result['size'] == [width, height], 'Unexpected canvas dimensions'
        errors = []; canvas.renderErrorOccurred.connect(lambda *a: errors.append(str(a[0])))
        for step in config['steps']:
            canvas.freeze(True)
            target = QgsCoordinateReferenceSystem()
            definition = step.get('projection', config['projection'])
            valid = target.createFromProj(definition) if definition.startswith('+proj=') else target.createFromUserInput(definition)
            assert valid and target.isValid(), 'Invalid target CRS'
            geo = QgsCoordinateReferenceSystem('EPSG:4326')
            forward = QgsCoordinateTransform(geo, target, project)
            inverse = QgsCoordinateTransform(target, geo, project)
            instant = times[-1] if step.get('last_time') else times[0]
            if instant not in references:
                stage['name'] = 'reference'
                query = {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap', 'LAYERS': name,
                         'STYLES': '', 'CRS': 'EPSG:4326', 'BBOX': '-90,-180,90,180',
                         'WIDTH': 1024, 'HEIGHT': 512, 'FORMAT': 'image/png', 'TRANSPARENT': 'true', 'TIME': instant}
                with urlopen(local + '?' + urlencode(query), timeout=35) as response:
                    reference = QImage.fromData(response.read())
                assert not reference.isNull(), 'Missing independent reference'
                references[instant] = reference
            reference = references[instant]
            canvas.setDestinationCrs(target)
            centre = forward.transform(*step.get('center', [90, 60]))
            # Let QGIS calculate degree/metre scale rather than treating degrees as metres.
            span = 1 if target.isGeographic() else 100000
            canvas.setExtent(QgsRectangle(centre.x()-span, centre.y()-span*height/width,
                                          centre.x()+span, centre.y()+span*height/width))
            canvas.zoomScale(step['scale']); extent = canvas.extent()
            dt = QDateTime.fromString(instant, Qt.ISODate)
            canvas.setTemporalRange(QgsDateTimeRange(dt, dt))
            expected = []
            for y in range(16, height, 40):
                for x in range(16, width, 40):
                    try:
                        p = inverse.transform(extent.xMinimum()+(x+.5)*extent.width()/width,
                                              extent.yMaximum()-(y+.5)*extent.height()/height)
                        if not math.isfinite(p.x()) or not math.isfinite(p.y()): continue
                        # PROJ wraps longitudes outside the base world. QGIS need
                        # not repeat a WMS world; those pixels are not missing data.
                        roundtrip = forward.transform(p)
                        tx = extent.xMinimum()+(x+.5)*extent.width()/width
                        ty = extent.yMaximum()-(y+.5)*extent.height()/height
                        if abs(roundtrip.x()-tx) > extent.width()/width or abs(roundtrip.y()-ty) > extent.height()/height: continue
                        if config['source_crs'] == 'EPSG:3857' and abs(p.y()) > 85.0511287798: continue
                        px = int((p.x()+180)/360*reference.width()); py = int((90-p.y())/180*reference.height())
                        if not (1 <= px < reference.width()-1 and 1 <= py < reference.height()-1): continue
                        if all(reference.pixelColor(px+dx, py+dy).alpha() > 0 for dx in (-1,0,1) for dy in (-1,0,1)):
                            expected.append((x,y))
                    except Exception:
                        continue
            assert len(expected) > 10, 'Too few reference samples'
            stage['name'] = step['name']; count_before = len(requests); errors.clear()
            frames = []; timed_out = []; loop = QEventLoop()
            canvas.mapCanvasRefreshed.connect(loop.quit)
            start = time.perf_counter(); epoch_start = time.time(); cpu = time.process_time()

            def capture():
                canvas.saveAsImage(str(report / 'current.png'))
                image = QImage(str(report / 'current.png'))
                if image.isNull(): return 0
                fraction = sum(image.pixelColor(x,y).alpha()>0 for x,y in expected)/len(expected)
                frames.append({'seconds': time.perf_counter()-start, 'coverage': fraction})
                return fraction

            def timeout():
                timed_out.append(True); canvas.stopRendering(); loop.quit()

            timer = QTimer(); timer.timeout.connect(capture)
            if config.get('capture', True): timer.start(250)
            watchdog = QTimer(); watchdog.setSingleShot(True); watchdog.timeout.connect(timeout)
            watchdog.start(config.get('timeout_ms', 30000))
            canvas.freeze(False); canvas.refresh(); loop.exec()
            seconds = time.perf_counter()-start; cpu_seconds = time.process_time()-cpu
            timer.stop(); watchdog.stop(); canvas.mapCanvasRefreshed.disconnect(loop.quit)
            canvas.freeze(True)
            if canvas.isDrawing(): canvas.stopRendering()
            coverage = capture(); canvas.saveAsImage(str(report / (step['name']+'.png')))
            observed = [r for r in requests[count_before:] if r.get('parameters',{}).get('REQUEST') == 'GetMap']
            # A previous complete frame can remain visible until a new render
            # clears it. Do not call that expected transition a coverage defect.
            first_response = min((r['finished']-epoch_start for r in observed if r.get('status') == 200), default=0)
            new_frames = [f for f in frames if f['seconds'] >= first_response]
            regressions = sum(a['coverage']-b['coverage'] > .05 for a,b in zip(new_frames,new_frames[1:]))
            row = {'name': step['name'], 'projection': definition, 'scale': canvas.scale(), 'time': instant,
                   'seconds': seconds, 'cpu_seconds': cpu_seconds, 'coverage': coverage,
                   'reference_samples': len(expected), 'regressions': regressions, 'frames': frames,
                   'timeout': bool(timed_out), 'errors': list(errors), 'getmaps': len(observed),
                   'regression_window_after_first_response': first_response,
                   'passed': coverage >= .99 and not regressions and not timed_out and not errors,
                   'extent': extent.toString(), 'finished': time.time()}
            row['memory_after'] = memory()
            row['full_frame_seconds'] = seconds if coverage >= .99 and not timed_out else None
            row['intermediate_capture'] = config.get('capture', True)
            if not row['intermediate_capture']:
                row['regressions'] = None
            result['steps'].append(row)
            # Preserve completed steps if the native renderer terminates QGIS.
            (report / 'result.partial.json').write_text(json.dumps(result, indent=2))
            (report / 'requests.partial.json').write_text(json.dumps(requests, indent=2))
            print(json.dumps({k:v for k,v in row.items() if k!='frames'}), flush=True)
            if timed_out and config.get('stop_after_timeout', True):
                result['stopped_after_timeout'] = True
                break
    except BaseException as error:
        result['error_type'] = type(error).__name__; raise
    finally:
        if timer is not None: timer.stop()
        if watchdog is not None: watchdog.stop()
        if canvas is not None:
            canvas.freeze(True); canvas.stopRendering(); canvas.setLayers([]); canvas.close(); sip.delete(canvas)
        layer = None
        server.shutdown(); server.server_close(); thread.join(timeout=3)
        result['cleanup'] = {'project_unchanged': state()==before, 'proxy_stopped': not thread.is_alive(),
                             'socket_closed': server.socket.fileno()==-1,
                             'canvas_deleted': canvas is None or sip.isdeleted(canvas)}
        result['finished'] = time.time()
        (report / 'requests.json').write_text(json.dumps(requests, indent=2))
        (report / 'result.json').write_text(json.dumps(result, indent=2))
    assert all(result['cleanup'].values()), 'Timing experiment cleanup failed'
    return result
