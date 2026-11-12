"""Diagnose WMS scale-dependent fragments and coverage regressions in QGIS.

Load with runpy.run_path inside QGIS Desktop, then call probe_scale(config).
Use a new report directory and a frozen public catalogue selection. canvas=true
uses an isolated hidden canvas; the user's canvas, project and limits stay intact.
partial_output=false is a diagnostic control, not an installed workaround.
"""
import json
import math
import threading
import time
import hashlib
from contextlib import nullcontext
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from urllib.error import HTTPError
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit
from urllib.request import urlopen


def probe_scale(config_path, enforce=True):
    from qgis.core import (QgsProject, QgsCoordinateReferenceSystem, QgsCoordinateTransform,
                           QgsDataSourceUri, QgsRasterLayer, QgsMapSettings,
                           QgsMapRendererParallelJob, QgsRectangle, Qgis, QgsNetworkAccessManager)
    from qgis.PyQt.QtNetwork import QNetworkRequest
    from qgis.PyQt.QtCore import QSize, QEventLoop, QTimer
    from qgis.PyQt.QtGui import QImage, QColor
    from qgis.utils import iface
    config=json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
    report=Path(config['report']);report.mkdir(parents=True,exist_ok=False)
    (report/'probe.py').write_bytes(Path(__file__).read_bytes())
    (report/'config.json').write_text(json.dumps(config,indent=2))
    selection=json.loads(Path(config['selection_file']).read_text(encoding='utf-8-sig'))
    (report/'selection.json').write_text(json.dumps(selection,indent=2))
    route=selection['wms']; origin=config.get('origin','http://127.0.0.1:8141')
    assert route.startswith('/gis/v1/') and '?' not in route and '#' not in route
    assert origin in ('http://127.0.0.1:8141','http://127.0.0.1:8140','http://localhost:8140')
    requests: list[dict[str, Any]]=[]
    serialization=threading.Lock()
    (report/'responses').mkdir()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):
            pass
        def do_GET(self):
            incoming=urlsplit(self.path)
            if unquote(incoming.path)!=unquote(route):
                self.send_error(404);return
            record: dict[str, Any]={'parameters':dict(parse_qsl(incoming.query)),'started':time.monotonic()}
            requests.append(record)
            try:
                with serialization if config.get('sequential') else nullcontext():
                    try:
                        response=urlopen(origin+self.path,timeout=35)
                    except HTTPError as error:
                        response=error
                    with response:
                        body=response.read();status=response.status;headers=dict(response.headers)
                record.update(status=status,bytes=len(body),request_id=headers.get('X-Request-ID'),
                              seconds=time.monotonic()-record['started'])
                if status==200 and headers.get('Content-Type','').startswith('image/'):
                    record['sha256']=hashlib.sha256(body).hexdigest()
                    (report/'responses'/(record['sha256']+'.png')).write_bytes(body)
                if status!=200:
                    record['error']=body.decode('utf-8','replace')[:800]
                self.send_response(status)
                for name in ('Content-Type','Cache-Control','Retry-After'):
                    if name in headers:self.send_header(name,headers[name])
                self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            except Exception as error:
                record['exception']=type(error).__name__;self.close_connection=True

    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    server.daemon_threads=False;server.block_on_close=True
    thread=threading.Thread(target=server.serve_forever,kwargs={'poll_interval':.05},daemon=True);thread.start()
    local='http://127.0.0.1:'+str(server.server_port)+route
    project=QgsProject.instance()
    def state():
        return {'layers':sorted(project.mapLayers()),'dirty':project.isDirty(),'crs':project.crs().toWkt()}
    before=state()
    job: Any=None
    layer: Any=None
    timer: Any=None
    watchdog: Any=None
    retired_jobs=[]
    network: list[dict[str, Any]]=[]
    manager=QgsNetworkAccessManager.instance();connected=False
    def network_finished(reply):
        url=reply.request().url()
        if url.host() not in ('127.0.0.1','localhost') or url.port()!=urlsplit(origin).port or unquote(url.path())!=unquote(route):return
        item={'parameters':dict(parse_qsl(url.query())),'status':reply.attribute(QNetworkRequest.HttpStatusCodeAttribute),
              'error':int(reply.error()),'error_string':reply.errorString(),'seconds':time.monotonic()-started}
        try:item['request_id']=bytes(reply.rawHeader(b'X-Request-ID')).decode()
        except Exception:pass
        network.append(item)
    result={'qgis_version':Qgis.QGIS_VERSION,'scale_requested':config['scale'],'projection':config['projection']}
    frames: list[dict[str, Any]]=[]
    started=time.monotonic()
    canvas: Any=None
    try:
        with urlopen(local+'?SERVICE=WMS&REQUEST=GetCapabilities',timeout=35) as response:
            caps=response.read()
        (report/'capabilities.xml').write_bytes(caps)
        doc=ET.fromstring(caps)
        name=doc.findtext('.//{*}Layer/{*}Name')
        instant=next(node.get('default') for node in doc.findall('.//{*}Dimension') if node.get('name')=='time')
        result.update(layer=name,time=instant,selection=selection['selection'])
        query={'SERVICE':'WMS','VERSION':'1.3.0','REQUEST':'GetMap','LAYERS':name,'STYLES':'',
               'CRS':'EPSG:4326','BBOX':'-90,-180,90,180','WIDTH':512,'HEIGHT':256,
               'FORMAT':'image/png','TRANSPARENT':'true','TIME':instant}
        with urlopen(local+'?'+urlencode(query),timeout=35) as response:
            raw=response.read()
        reference=QImage.fromData(raw);assert not reference.isNull();reference.save(str(report/'reference.png'))
        uri=QgsDataSourceUri()
        for key,value in {'url':origin+route if config.get('direct') else local,'layers':name,'styles':'','crs':config.get('source_crs','EPSG:4326'),
                          'format':'image/png','version':'1.3.0'}.items():uri.setParam(key,value)
        layer=QgsRasterLayer(bytes(uri.encodedUri()).decode(),'Scale diagnostic','wms')
        assert layer.isValid(),'Invalid WMS layer (URI withheld)'
        target=QgsCoordinateReferenceSystem()
        valid=target.createFromProj(config['projection']) if config['projection'].startswith('+proj=') else target.createFromUserInput(config['projection'])
        assert valid and target.isValid(),'Invalid diagnostic project CRS'
        transform=QgsCoordinateTransform(QgsCoordinateReferenceSystem('EPSG:4326'),target,project)
        inverse=QgsCoordinateTransform(target,QgsCoordinateReferenceSystem('EPSG:4326'),project)
        center=transform.transform(*config.get('center',[90,60]))
        width,height=config.get('size',[1206,521]);dpi=config.get('dpi',96)
        mpp=config['scale']*.0254/dpi
        settings=QgsMapSettings(iface.mapCanvas().mapSettings());settings.setLayers([layer]);settings.setDestinationCrs(target)
        if 'partial_output' in config:settings.setFlag(Qgis.MapSettingsFlag.RenderPartialOutput,config['partial_output'])
        settings.setOutputSize(QSize(width,height));settings.setOutputDpi(dpi)
        settings.setBackgroundColor(QColor(0,0,0,0))
        settings.setExtent(QgsRectangle(center.x()-width*mpp/2,center.y()-height*mpp/2,
                                        center.x()+width*mpp/2,center.y()+height*mpp/2))
        extent=settings.visibleExtent();result.update(actual_scale=settings.scale(),extent=extent.toString(),size=[width,height])
        result['partial_output']=bool(settings.flags() & Qgis.MapSettingsFlag.RenderPartialOutput)
        expected=[]
        for y in range(8,height,16):
            for x in range(8,width,16):
                try:
                    point=inverse.transform(extent.xMinimum()+(x+.5)*extent.width()/width,
                                            extent.yMaximum()-(y+.5)*extent.height()/height)
                    if not math.isfinite(point.x()) or not math.isfinite(point.y()):continue
                    if config.get('source_crs')=='EPSG:3857' and abs(point.y())>85.0511287798:continue
                    px=int((point.x()+180)/360*reference.width());py=int((90-point.y())/180*reference.height())
                    if not (1<=px<reference.width()-1 and 1<=py<reference.height()-1):continue
                    if all(reference.pixelColor(px+dx,py+dy).alpha()>0 for dx in (-1,0,1) for dy in (-1,0,1)):
                        expected.append((x,y))
                except Exception:
                    continue
        assert len(expected)>20,'Reference contains too few stable data pixels'
        def coverage(image):
            return sum(image.pixelColor(x,y).alpha()>0 for x,y in expected)/len(expected)
        if config.get('direct'):
            manager.finished.connect(network_finished);connected=True
        for scale in config.get('zoom_scales',[]):
            step_mpp=scale*.0254/dpi
            settings.setExtent(QgsRectangle(center.x()-width*step_mpp/2,center.y()-height*step_mpp/2,
                                            center.x()+width*step_mpp/2,center.y()+height*step_mpp/2))
            previous=QgsMapRendererParallelJob(settings);previous.start()
            pause=QEventLoop();QTimer.singleShot(config.get('dwell_ms',150),pause.quit);pause.exec()
            previous.cancelWithoutBlocking();retired_jobs.append(previous)
        settings.setExtent(extent)
        if config.get('canvas'):
            from qgis.gui import QgsMapCanvas
            from qgis.PyQt.QtWidgets import QFrame, QApplication
            from qgis.PyQt.QtCore import Qt
            canvas=QgsMapCanvas();canvas.freeze(True)
            canvas.setAttribute(Qt.WA_DontShowOnScreen,True);canvas.setFrameStyle(QFrame.NoFrame)
            canvas.resize(width,height);canvas.setCanvasColor(QColor(0,0,0,0))
            canvas.setDestinationCrs(target);canvas.setMapSettingsFlags(settings.flags())
            canvas.setParallelRenderingEnabled(True);canvas.setCachingEnabled(iface.mapCanvas().isCachingEnabled())
            canvas.setLayers([layer]);canvas.show();QApplication.processEvents();canvas.setExtent(extent)
            canvas_errors=[]
            canvas.renderErrorOccurred.connect(lambda *args:canvas_errors.append(' | '.join(str(arg) for arg in args)))
            result['canvas_size']=[canvas.mapSettings().outputSize().width(),canvas.mapSettings().outputSize().height()]
            result['canvas_scale']=canvas.scale()
            class CanvasJob:
                finished=canvas.mapCanvasRefreshed
                def start(self):canvas.freeze(False);canvas.refresh()
                def renderedImage(self):
                    filename=str(report/'canvas-current.png');canvas.saveAsImage(filename)
                    return QImage(filename)
                def isActive(self):return canvas.isDrawing()
                def cancelWithoutBlocking(self):canvas.stopRendering()
                def cancel(self):canvas.stopRendering()
                def errors(self):return [SimpleNamespace(message=message) for message in canvas_errors]
            job=CanvasJob()
        else:
            job=QgsMapRendererParallelJob(settings)
        loop=QEventLoop();job.finished.connect(loop.quit)
        def capture():
            image=job.renderedImage()
            if not image.isNull():
                fraction=coverage(image)
                if not frames or fraction!=frames[-1]['coverage']:
                    number=len(frames);image.save(str(report/f'frame-{number:03d}.png'))
                    frames.append({'seconds':time.monotonic()-started,'coverage':fraction,'image':f'frame-{number:03d}.png'})
        timer=QTimer();timer.timeout.connect(capture);timer.start(100)
        watchdog=QTimer();watchdog.setSingleShot(True)
        def timeout():
            result['render_timeout']=True;job.cancelWithoutBlocking();loop.quit()
        watchdog.timeout.connect(timeout);watchdog.start(config.get('render_timeout_ms',40000))
        job.start();loop.exec();timer.stop();watchdog.stop()
        if job.isActive():job.cancel()
        capture();image=job.renderedImage();image.save(str(report/'final.png'))
        regressions=[{'from':a['coverage'],'to':b['coverage'],'seconds':b['seconds']} for a,b in zip(frames,frames[1:]) if a['coverage']-b['coverage']>.05]
        result.update(expected_samples=len(expected),coverage=coverage(image),coverage_regressions=regressions,
                      renderer_errors=[error.message for error in job.errors()],frames=frames,
                      passed=coverage(image)>=.99 and not regressions and not job.errors() and not result.get('render_timeout'))
    except BaseException as error:
        result.update(passed=False,error_type=type(error).__name__);raise
    finally:
        if timer is not None:timer.stop()
        if watchdog is not None:watchdog.stop()
        if job is not None and job.isActive():job.cancel()
        for previous in retired_jobs:
            if previous.isActive():previous.cancel()
        retired_jobs.clear()
        if connected:manager.finished.disconnect(network_finished)
        if canvas is not None:
            from qgis.PyQt import sip
            canvas.freeze(True);canvas.stopRendering();canvas.setLayers([]);canvas.close();sip.delete(canvas)
            result['canvas_deleted']=sip.isdeleted(canvas)
        job=layer=None
        server.shutdown();server.server_close();thread.join(timeout=3)
        result.update(seconds=time.monotonic()-started,
                      http_statuses={str(status):sum(item.get('status')==status for item in requests) for status in sorted({item['status'] for item in requests if 'status'in item})},
                      cleanup={'project_unchanged':state()==before,'proxy_thread_stopped':not thread.is_alive(),'proxy_socket_closed':server.socket.fileno()==-1})
        (report/'requests.json').write_text(json.dumps(requests,indent=2))
        (report/'qgis-network.json').write_text(json.dumps(network,indent=2))
        (report/'result.json').write_text(json.dumps(result,indent=2))
        print(json.dumps({key:value for key,value in result.items() if key!='frames'}))
    assert all(result['cleanup'].values()),'Diagnostic cleanup failed'
    if enforce:assert result['passed'],f"Fragmentary WMS: {result.get('coverage',0):.1%}; HTTP {result['http_statuses']}"
    return result
