"""Read-only live-public QGIS smoke check; execute in the connected Desktop."""

import json
import math
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

from qgis.core import (QgsProject, QgsMapSettings, QgsCoordinateReferenceSystem,
                       QgsRectangle, QgsMapRendererSequentialJob, QgsDateTimeRange,
                       QgsDataSourceUri)
from qgis.PyQt.QtCore import QDateTime, Qt, QSize, QCoreApplication, QEvent
from qgis.PyQt.QtGui import QColor

root = Path('D:/OSOKIN/PROG/HydroMetCenter/hmc-app-prototype')
helpers = {}
exec((root/'publication/qgis_desktop.py').read_text(encoding='utf-8'), helpers)
report = root/'data/reports/wms-compat'
base = 'http://localhost:8140'
before_layers = sorted(QgsProject.instance().mapLayers())


def get_json(path, query=None):
    with urlopen(base+path+('?' + urlencode(query) if query else ''), timeout=35) as response:
        return json.load(response)


items = get_json('/api/v1/catalogue')['selections']
selected = min((item for item in items if len(item['valid_times']) == 24), key=lambda item: item['selection'])
choices = sorted((item for item in items if item['revision'] == selected['revision']), key=lambda item: item['valid_time'])
layer = helpers['connect_forecast'](base, selected['wms'], None, None, 'EPSG:4326')
assert layer.isValid()
uri = QgsDataSourceUri()
uri.setEncodedUri(layer.source())
assert not any(uri.hasParam(name) for name in ('dpiMode', 'maxWidth', 'maxHeight', 'IgnoreGetMapUrl', 'IgnoreGetFeatureInfoUrl', 'time'))

# Independent sphere -> ellipsoid conversion, as in the established T11 reference.
phi = math.radians(50)
p, z, latitude = 6371229*math.cos(phi), 6371229*math.sin(phi), phi
for _ in range(10):
    n = 6378137/math.sqrt(1-6.6943799901413165e-3*math.sin(latitude)**2)
    latitude = math.atan2(z+6.6943799901413165e-3*n*math.sin(latitude), p)

observations = []
for index in (0, 9):
    item = choices[index]
    query = {name: item[name] for name in ('selection', 'run', 'revision', 'valid_time')}
    expected = get_json(item['point'], {**query, 'layer': item['field'], 'lon': 20, 'lat': 50})['value']
    instant = QDateTime.fromString(item['valid_time'], Qt.ISODate)
    temporal_range = QgsDateTimeRange(instant, instant)
    settings = QgsMapSettings()
    settings.setLayers([layer])
    settings.setDestinationCrs(QgsCoordinateReferenceSystem('EPSG:4326'))
    settings.setOutputSize(QSize(1204, 700))
    settings.setBackgroundColor(QColor(0, 0, 0, 0))
    settings.setExtent(QgsRectangle(-26, 28, 65, 72))
    settings.setIsTemporal(True)
    settings.setTemporalRange(temporal_range)
    job = QgsMapRendererSequentialJob(settings)
    job.start()
    job.waitForFinished()
    assert not job.errors()
    image = job.renderedImage()
    visible = sum(image.pixelColor(x,y).alpha()>0 for x in range(0,image.width(),16) for y in range(0,image.height(),16))
    assert visible > 0
    image.save(str(report/f'live-qgis-{index+1:02}.png'))
    text = helpers['identify_in_canvas'](layer, 'EPSG:4326', 20, math.degrees(latitude), .001, temporal_range)
    import re
    match = re.search(r'GRAY_INDEX\s*=\s*([^\s]+)', text)
    assert match and abs(float(match[1])-expected) <= .0001
    observations.append({'time':item['valid_time'], 'expected_K':expected, 'identify':text, 'visible_samples':visible})
QCoreApplication.sendPostedEvents(None, QEvent.DeferredDelete)
assert sorted(QgsProject.instance().mapLayers()) == before_layers
result = {'status':'passed', 'scope':'public viewer bridge, standard DPI/size, same-layer temporal Identify',
          'revision':selected['revision'], 'forecast_times':24, 'observations':observations,
          'project_layers_unchanged':True, 'project_saved':False, 'created_project_layers':[]}
(report/'live-desktop.json').write_text(json.dumps(result,indent=2)+'\n', encoding='utf-8')
print(json.dumps(result))
