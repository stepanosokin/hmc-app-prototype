"""Run through QGIS MCP; temporary layers/canvas never enter the user's project."""
import json
import re
import runpy
from pathlib import Path


def verify(config_path):
    from qgis.core import (Qgis,QgsProject,QgsCoordinateReferenceSystem,QgsMapSettings,
        QgsMapRendererSequentialJob,QgsRectangle,QgsDateTimeRange,QgsDataSourceUri)
    from qgis.PyQt.QtCore import QDateTime,Qt,QSize
    from qgis.PyQt.QtGui import QColor
    assert Qgis.QGIS_VERSION=='3.44.11-Solothurn'
    config=json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
    helpers=runpy.run_path(str(Path(config['root'])/'publication/qgis_desktop.py'))
    project=QgsProject.instance()
    before=(project.fileName(),set(project.mapLayers()),project.isDirty())
    observations=[]
    for crs in ('EPSG:4326','EPSG:3857'):
        layer=helpers['connect_forecast'](config['base'],config['wms'],None,None,crs)
        assert layer.isValid(),'Не удалось подключить временный слой WMS.'
        uri=QgsDataSourceUri();uri.setEncodedUri(layer.source())
        assert not any(uri.hasParam(name) for name in ('dpiMode','maxWidth','maxHeight','time'))
        assert len(layer.dataProvider().temporalCapabilities().allAvailableTemporalRanges())==24
        for item in config['choices']:
            instant=QDateTime.fromString(item['time'],Qt.ISODate)
            temporal=QgsDateTimeRange(instant,instant)
            x,y=item['positions'][crs]
            delta=.05 if crs=='EPSG:4326' else 3000.
            settings=QgsMapSettings();settings.setLayers([layer])
            settings.setDestinationCrs(QgsCoordinateReferenceSystem(crs));settings.setOutputSize(QSize(1204,700))
            settings.setBackgroundColor(QColor(0,0,0,0));settings.setIsTemporal(True);settings.setTemporalRange(temporal)
            settings.setExtent(QgsRectangle(x-delta*100,y-delta*60,x+delta*100,y+delta*60))
            job=QgsMapRendererSequentialJob(settings);job.start();job.waitForFinished()
            assert not job.errors(),[error.message for error in job.errors()]
            image=job.renderedImage()
            assert any(image.pixelColor(px,py).alpha() for px in range(0,image.width(),16) for py in range(0,image.height(),16))
            image.save(str(Path(config['directory'])/f'qgis-{crs.split(":")[1]}-{item["time"][11:13]}.png'))
            identified=helpers['identify_in_canvas'](layer,crs,x,y,delta,temporal)
            match=re.search(r'GRAY_INDEX\s*=\s*([^\s]+)',identified)
            assert match and abs(float(match[1])-item['value_K'])<=.0001,identified
            observations.append({'crs':crs,'time':item['time'],'expected_K':item['value_K'],'identified':identified,
                                 'canvas':[1204,700],'dpi_size_overrides':False,'uri_time':False})
        layer.deleteLater()
    after=(project.fileName(),set(project.mapLayers()),project.isDirty())
    assert before==after,'Пользовательский проект QGIS изменился.'
    report={'status':'passed','qgis_version':Qgis.QGIS_VERSION,'observations':observations,
            'cleanup':{'user_project_preserved':True,'project_layers_created':0,'temporary_canvas_retired':True}}
    (Path(config['directory'])/'qgis.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))
