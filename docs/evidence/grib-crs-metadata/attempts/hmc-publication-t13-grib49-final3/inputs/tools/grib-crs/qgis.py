"""Pinned QGIS check on separate, unregistered layers and temporary canvases."""
import json
import runpy
from pathlib import Path
from urllib.parse import quote


def verify(config_path):
    from qgis.core import (Qgis,QgsCoordinateReferenceSystem,QgsCoordinateTransform,
        QgsProject,QgsPointXY,QgsRaster,QgsMapSettings,QgsMapRendererSequentialJob,QgsRectangle)
    from qgis.PyQt.QtCore import QSize
    from qgis.PyQt.QtGui import QColor
    root=Path(__file__).resolve().parents[2]
    helper=runpy.run_path(str(root/'publication/qgis_desktop.py'))
    config=json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
    directory=Path(config['report_directory'])
    cases=json.loads((directory/'six-template-http.json').read_text())['cases']
    project=QgsProject.instance()
    before_ids=set(project.mapLayers())
    observations=[]
    for case in cases:
        identity=case['point']['identity']
        url='/gis/v1/runs/'+quote(identity['run'],safe='')+'/revisions/'+identity['revision']+'/wms'
        for crs in ('EPSG:4326','EPSG:3857'):
            layer=helper['connect_forecast'](config['base'],url,None,identity['valid_time'],crs)
            try:
                assert layer.isValid(),'Не удалось открыть проверочный слой QGIS'
                destination=QgsCoordinateReferenceSystem(crs)
                transform=QgsCoordinateTransform(QgsCoordinateReferenceSystem('EPSG:4326'),destination,project)
                point=transform.transform(QgsPointXY(*case['gis_probe']['position']))
                delta=.01 if crs=='EPSG:4326' else 1000
                settings=QgsMapSettings();settings.setLayers([layer]);settings.setDestinationCrs(destination)
                settings.setExtent(QgsRectangle(point.x()-delta,point.y()-delta,point.x()+delta,point.y()+delta))
                settings.setOutputSize(QSize(900,650));settings.setBackgroundColor(QColor(0,0,0,0))
                job=QgsMapRendererSequentialJob(settings);job.start();job.waitForFinished()
                image=job.renderedImage();assert not image.isNull()
                assert image.pixelColor(image.width()//2,image.height()//2).alpha()>0
                identify=layer.dataProvider().identify(point,QgsRaster.IdentifyFormatText)
                import re
                text=' '.join(str(v) for v in identify.results().values())
                values=[float(v) for v in re.findall(r'GRAY_INDEX\s*=\s*([0-9.eE+-]+)',text)]
                matching=any(abs(v-case['gis_probe']['value'])<=.0001 for v in values)
                assert matching,{'template':case['template'],'crs':crs,'identified_values':values}
                filename=f'qgis-template-{case["template"]}-{crs.split(":")[1]}.png'
                image.save(str(directory/filename))
                observations.append({'template':case['template'],'crs':crs,'value':case['gis_probe']['value'],'image':filename})
            finally:
                layer.deleteLater()
    assert set(project.mapLayers())==before_ids
    result={'status':'passed','qgis_version':Qgis.QGIS_VERSION,'observations':observations,
            'cleanup':{'project_layers_unchanged':True,'temporary_layers_released':True}}
    (directory/'qgis-six-templates.json').write_text(json.dumps(result,indent=2)+'\n')
    return {'status':result['status'],'observations':len(observations),'cleanup':result['cleanup']}
