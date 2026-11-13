"""#106 ordinary-dialog probe, loaded into QGIS Desktop through MCP.

Run modal actions after returning to Qt's event loop, so MCP remains usable.
The separate Node loopback proxy only reads the actual upstream GIS gateway.
"""

import json
import hashlib
import runpy
from pathlib import Path
from typing import Any

from qgis.core import QgsProject, QgsSettings, QgsOwsConnection
from qgis.gui import QgsGui
from qgis.PyQt.QtCore import QTimer
from qgis.PyQt.QtWidgets import QApplication, QPushButton, QLineEdit, QTreeWidget, QTreeWidgetItemIterator
import qgis.utils

NAME = 'HMC-106-snapshot-probe'
report: Path
widget: Any
previous_connection: Any
previous_legacy_connection: Any
added: list[str]
connection_url: str | None
selected_leaf: str
project_state: dict


def prepare(report_directory, url=None, layer_name='field'):
    global widget, report, previous_connection, previous_legacy_connection, added, connection_url, selected_leaf, project_state
    assert not QgsProject.instance().mapLayers() and not QgsProject.instance().fileName()
    report = Path(report_directory)
    previous_connection = QgsOwsConnection.selectedConnection('WMS')
    previous_legacy_connection = QgsSettings().value('qgis/connections-wms/selected')
    connection_url, selected_leaf = url, layer_name
    assert NAME not in QgsOwsConnection.connectionList('WMS')
    project_state = {'crs': QgsProject.instance().crs(), 'dirty': QgsProject.instance().isDirty(),
                     'filename': QgsProject.instance().fileName(), 'extent': qgis.utils.iface.mapCanvas().extent(),
                     'canvas_crs': qgis.utils.iface.mapCanvas().mapSettings().destinationCrs()}
    added = []
    widget = QgsGui.sourceSelectProviderRegistry().providerByName('wms').createDataSourceWidget(qgis.utils.iface.mainWindow())

    def receive(uri, name, provider):
        # URI is emitted by the stock source dialog, never assembled here.
        layer = qgis.utils.iface.addRasterLayer(uri, name, provider)
        added.append(layer.id())
        (report / 'dialog-emitted-uri.txt').write_text(uri, encoding='utf-8')

    widget.addRasterLayer.connect(receive)
    widget.show()


def click_new():
    QTimer.singleShot(0, widget.findChild(QPushButton, 'btnNew').click)


def fill_connection():
    dialog = QApplication.activeModalWidget()
    assert dialog.findChild(QLineEdit, 'txtUrl') is not None
    config = json.loads((report / 'config.json').read_text()) if connection_url is None else {}
    dialog.findChild(QLineEdit, 'txtName').setText(NAME)
    dialog.findChild(QLineEdit, 'txtUrl').setText(connection_url or f'http://127.0.0.1:{config["proxy_port"]}/wms')
    ok = next(b for b in dialog.findChildren(QPushButton) if b.text().replace('&', '') == 'OK')
    QTimer.singleShot(0, ok.click)


def connect():
    QTimer.singleShot(0, widget.findChild(QPushButton, 'btnConnect').click)


def tree():
    control = widget.findChild(QTreeWidget, 'lstLayers')
    iterator = QTreeWidgetItemIterator(control)
    rows = []
    while iterator.value():
        item = iterator.value()
        rows.append([item.text(i) for i in range(control.columnCount())])
        iterator += 1
    print(rows)


def select_leaf():
    control = widget.findChild(QTreeWidget, 'lstLayers')
    iterator = QTreeWidgetItemIterator(control)
    while iterator.value():
        item = iterator.value()
        if item.text(1) == selected_leaf:
            control.clearSelection()
            item.setSelected(True)
            control.setCurrentItem(item)
            widget.grab().save(str(report / 'ordinary-dialog.png'))
            return
        iterator += 1
    raise AssertionError('Expected upstream minimal field in the ordinary dialog')


def add():
    button = next(b for b in widget.findChildren(QPushButton) if b.text().replace('&', '') == 'Add')
    assert button.isEnabled()
    QTimer.singleShot(0, button.click)


def capture_state(label):
    """Observe the actual dialog-added provider through map, Identify and legend."""
    from qgis.core import (QgsMapSettings, QgsMapRendererSequentialJob, QgsCoordinateReferenceSystem,
                           QgsRectangle, QgsDateTimeRange)
    from qgis.PyQt.QtCore import QSize, QEventLoop, QDateTime
    from qgis.PyQt.QtGui import QColor
    layer = QgsProject.instance().mapLayer(added[-1])
    assert layer is not None and layer.isValid()
    settings = QgsMapSettings()
    settings.setLayers([layer])
    settings.setDestinationCrs(QgsCoordinateReferenceSystem('EPSG:4326'))
    settings.setExtent(QgsRectangle(15, 45, 25, 55))
    settings.setOutputSize(QSize(640, 360))
    settings.setBackgroundColor(QColor(0, 0, 0, 0))
    job = QgsMapRendererSequentialJob(settings)
    job.start()
    job.waitForFinished()
    image = job.renderedImage()
    assert not image.isNull() and image.pixelColor(320, 180).alpha() > 0
    image.save(str(report / (label + '-map.png')))
    helper = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'publication/qgis_desktop.py'))
    text = helper['identify_in_canvas'](layer, 'EPSG:4326', 20, 50, .001, QgsDateTimeRange(QDateTime(), QDateTime()))
    assert 'GRAY_INDEX' in text and 'Редакция:' in text and 'Единицы: K' in text
    loop = QEventLoop()
    images, errors = [], []
    fetcher = layer.dataProvider().getLegendGraphicFetcher(settings)
    assert fetcher is not None

    def finished(legend):
        images.append(legend)
        loop.quit()

    def failed(error):
        errors.append(error)
        loop.quit()

    fetcher.finish.connect(finished)
    fetcher.error.connect(failed)
    timer = QTimer()
    timer.setSingleShot(True)
    timer.timeout.connect(loop.quit)
    timer.start(15000)
    fetcher.start()
    if not images and not errors:
        loop.exec()
    timer.stop()
    assert images and not errors and not images[0].isNull(), errors
    images[0].save(str(report / (label + '-legend.png')))
    state = {'name': layer.name(), 'uri': layer.source(), 'identify': text,
             'map_sha256': hashlib.sha256((report / (label + '-map.png')).read_bytes()).hexdigest(),
             'legend_sha256': hashlib.sha256((report / (label + '-legend.png')).read_bytes()).hexdigest()}
    (report / (label + '.json')).write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
    return state


def cleanup():
    from qgis.PyQt import sip
    if not sip.isdeleted(widget):
        widget.close()
        widget.deleteLater()
    for identifier in added:
        QgsProject.instance().removeMapLayer(identifier)
    settings = QgsSettings()
    settings.remove('qgis/connections-wms/' + NAME)
    QgsOwsConnection.deleteConnection('WMS', NAME)
    QgsOwsConnection.setSelectedConnection('WMS', previous_connection or '')
    if previous_legacy_connection is None:
        settings.remove('qgis/connections-wms/selected')
    else:
        settings.setValue('qgis/connections-wms/selected', previous_legacy_connection)
    QgsProject.instance().setCrs(project_state['crs'])
    QgsProject.instance().setFileName(project_state['filename'])
    QgsProject.instance().setDirty(project_state['dirty'])
    qgis.utils.iface.mapCanvas().setDestinationCrs(project_state['canvas_crs'])
    qgis.utils.iface.mapCanvas().setExtent(project_state['extent'])
