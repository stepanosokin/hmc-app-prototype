"""Ordinary single and bulk addition of independent temporal WMS layers (#109)."""
import hashlib
import json
from pathlib import Path
import re
import runpy
from urllib.parse import urlencode

from qgis.core import QgsProject, Qgis

probe: dict
report: Path
seed: dict
observations: list
completed_phases: set[str]
browser_state: dict


def prepare(config_path):
    global probe, report, seed, observations, completed_phases
    config = json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
    report = Path(config['report_directory'])
    seed = json.loads((report / 'common-multilayer.json').read_text(encoding='utf-8'))
    observations = []
    completed_phases = set()
    probe = runpy.run_path(str(Path(__file__).with_name('probe-qgis-wms-snapshot.py')))
    probe['prepare'](str(report), config['base'] + '/gis/v1/wms?' + urlencode(seed['snapshot']), seed['layers'][0])


def select_many():
    from qgis.PyQt.QtWidgets import QCheckBox, QTreeWidget, QTreeWidgetItemIterator
    state = probe['prepare'].__globals__
    widget = state['widget']
    control = widget.findChild(QTreeWidget, 'lstLayers')
    control.clearSelection()
    wanted = set(seed['layers'] + [seed['precipitation']])
    iterator = QTreeWidgetItemIterator(control)
    found = set()
    while iterator.value():
        item = iterator.value()
        if item.text(1) in wanted:
            item.setSelected(True)
            found.add(item.text(1))
        iterator += 1
    assert found == wanted
    widget.findChild(QCheckBox, 'mLoadLayersIndividuallyCheckBox').setChecked(True)
    widget.grab().save(str(report / 'multilayer-dialog.png'))


def capture_dialog_bulk_limitation():
    """Retain the negative stock-dialog experience, then retire only its layers."""
    from qgis.core import QgsDataSourceUri
    state = probe['prepare'].__globals__
    assert len(state['added']) == 4
    rows = []
    for identifier in state['added'][1:]:
        layer = QgsProject.instance().mapLayer(identifier)
        assert layer is not None and layer.isValid()
        uri = QgsDataSourceUri()
        uri.setEncodedUri(layer.source())
        assert not layer.dataProvider().temporalCapabilities().hasTemporalCapabilities()
        assert not layer.temporalProperties().isActive()
        assert not uri.param('timeDimensionExtent')
        rows.append({'name': layer.name(), 'layer': uri.param('layers'), 'temporal_capabilities': False,
                     'temporal_active': False, 'timeDimensionExtent': ''})
        QgsProject.instance().removeMapLayer(identifier)
    state['added'] = state['added'][:1]
    (report / 'multilayer-dialog-limitation.json').write_text(json.dumps({
        'status': 'observed-client-limitation', 'qgis_version': Qgis.QGIS_VERSION,
        'method': 'stock WMS dialog, Load as separate layers', 'layers': rows}, ensure_ascii=False, indent=2), encoding='utf-8')


def browser_refresh():
    """Refresh the stock Browser using its Qt slot, without owning data items."""
    global browser_state
    import qgis.utils
    from qgis.PyQt.QtWidgets import QDockWidget, QTreeView
    from qgis.PyQt.QtCore import QMetaObject, Qt
    dock = next(w for w in qgis.utils.iface.mainWindow().findChildren(QDockWidget) if w.objectName() == 'Browser')
    view = dock.findChild(QTreeView)
    model = view.model()
    root = next(model.index(r, 0) for r in range(model.rowCount()) if model.index(r, 0).data() == 'WMS/WMTS')
    browser_state = {'dock': dock, 'view': view, 'visible': dock.isVisible(), 'expanded': view.isExpanded(root)}
    dock.show()
    view.setCurrentIndex(root)
    QMetaObject.invokeMethod(dock, 'refresh', Qt.QueuedConnection)


def browser_connect():
    view = browser_state['view']
    model = view.model()
    root = next(model.index(r, 0) for r in range(model.rowCount()) if model.index(r, 0).data() == 'WMS/WMTS')
    view.expand(root)
    connection = next(model.index(r, 0, root) for r in range(model.rowCount(root))
                      if model.index(r, 0, root).data() == probe['prepare'].__globals__['NAME'])
    view.expand(connection)


def browser_select_many():
    """Select native Browser leaves and open its normal selection context menu."""
    from qgis.PyQt.QtCore import QItemSelectionModel, QMetaObject, Qt, Q_ARG, QPoint
    view = browser_state['view']
    model = view.model()
    view.clearSelection()
    root = next(model.index(r, 0) for r in range(model.rowCount()) if model.index(r, 0).data() == 'WMS/WMTS')
    connection = next(model.index(r, 0, root) for r in range(model.rowCount(root))
                      if model.index(r, 0, root).data() == probe['prepare'].__globals__['NAME'])
    wanted = {('WMS109-A', 'Температура на высоте 2 м'), ('WMS109-A', 'Суммарные осадки · поверхность'),
              ('WMS109-B', 'Давление у поверхности')}
    found = []
    def visit(parent):
        view.expand(parent)
        for row in range(model.rowCount(parent)):
            index = model.index(row, 0, parent)
            if (parent.data(), index.data()) in wanted:
                view.selectionModel().select(index, QItemSelectionModel.Select | QItemSelectionModel.Rows)
                found.append(index)
            visit(index)
    visit(connection)
    assert len(found) == 3, len(found)
    view.scrollTo(found[-1])
    browser_state['dock'].grab().save(str(report / 'multilayer-browser-selection.png'))
    point = view.visualRect(found[-1]).center()
    QMetaObject.invokeMethod(browser_state['dock'], 'showContextMenu', Qt.QueuedConnection, Q_ARG(QPoint, point))


def browser_add_selected():
    from qgis.PyQt.QtWidgets import QApplication, QMenu
    from qgis.PyQt.QtCore import QTimer
    menu = QApplication.activePopupWidget()
    assert isinstance(menu, QMenu)
    action = next(a for a in menu.actions() if a.text().replace('&', '') == 'Add Selected Layers to Project')
    assert action.isEnabled()
    before = set(QgsProject.instance().mapLayers())
    browser_state['before'] = before
    # QGIS builds every URI itself through its stock Browser data items.
    QTimer.singleShot(0, action.trigger)
    menu.close()


def browser_collect_added():
    state = probe['prepare'].__globals__
    added = set(QgsProject.instance().mapLayers()) - browser_state['before']
    assert len(added) == 3, len(added)
    state['added'].extend(sorted(added))


def capture(label):
    from qgis.core import (QgsDataSourceUri, QgsMapSettings, QgsCoordinateReferenceSystem,
                           QgsRectangle, QgsDateTimeRange, QgsMapRendererSequentialJob)
    from qgis.PyQt.QtCore import QSize, QDateTime, Qt, QEventLoop, QTimer
    from qgis.PyQt.QtGui import QColor
    completed_phases.discard(label)
    phase_observations = []
    state = probe['prepare'].__globals__
    layers = [QgsProject.instance().mapLayer(identifier) for identifier in state['added']]
    if label == 'single':
        expected_count, selected_layers = 1, layers
    elif label == 'new':
        expected_count, selected_layers = 5, layers[-1:]
    else:
        expected_count, selected_layers = 4, layers[1:]
    assert len(layers) == expected_count, len(layers)
    advanced = json.loads((report / 'multilayer-advance.json').read_text()) if label == 'new' else None
    helper = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'publication/qgis_desktop.py'))
    for layer in selected_layers:
        assert layer.isValid()
        uri = QgsDataSourceUri()
        uri.setEncodedUri(layer.source())
        name = uri.param('layers')
        times = [advanced['time']] if advanced else seed['times'][name]
        assert not any(uri.hasParam(key) for key in ('time', 'maxWidth', 'maxHeight'))
        assert uri.param('dpiMode') in ('', '7')  # The stock dialog's default mode.
        capabilities = layer.dataProvider().temporalCapabilities()
        available = [r.begin().toString(Qt.ISODate).replace('+00:00', 'Z') for r in capabilities.allAvailableTemporalRanges()]
        assert sorted(available) == times, (name, available, times)
        assert layer.temporalProperties().isActive()
        assert capabilities.intervalHandlingMethod() == Qgis.TemporalIntervalMatchMethod.MatchExactUsingStartOfRange
        for crs in ('EPSG:4326', 'EPSG:3857'):
            for time in times:
                temporal = QgsDateTimeRange(QDateTime.fromString(time, Qt.ISODate), QDateTime.fromString(time, Qt.ISODate))
                settings = QgsMapSettings()
                settings.setLayers([layer])
                settings.setDestinationCrs(QgsCoordinateReferenceSystem(crs))
                extent = .01 if crs == 'EPSG:4326' else 1000
                settings.setExtent(QgsRectangle(-extent, -extent, extent, extent))
                settings.setOutputSize(QSize(640, 360))
                settings.setBackgroundColor(QColor(0, 0, 0, 0))
                settings.setIsTemporal(True)
                settings.setTemporalRange(temporal)
                job = QgsMapRendererSequentialJob(settings)
                job.start()
                job.waitForFinished()
                assert not job.errors(), [error.message for error in job.errors()]
                image = job.renderedImage()
                assert not image.isNull() and image.pixelColor(320, 180).alpha() > 0
                text = helper['identify_in_canvas'](layer, crs, 0, 0, extent, temporal)
                match = re.search(r'GRAY_INDEX\s*=\s*([^\s]+)', text)
                expected = advanced['value'] if advanced else seed['values'][name][time]
                assert match and abs(float(match[1]) - expected) <= .0001, text
                assert 'Срок: ' + time in text
                if name == seed['precipitation']:
                    assert 'Интервал: 2026-10-15T00:00:00Z — ' + time in text
                image.save(str(report / f'multilayer-{label}-{name[-8:]}-{crs[5:]}-{time[11:13]}.png'))
                phase_observations.append({'phase': label, 'name': name, 'crs': crs, 'time': time,
                                     'temporal_ranges': available, 'identify_canvas': [3201, 1801], 'identify': text})
        loop = QEventLoop()
        legends, errors = [], []
        fetcher = layer.dataProvider().getLegendGraphicFetcher(settings)
        assert fetcher is not None
        def finished(image):
            legends.append(image)
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
        if not legends and not errors:
            loop.exec()
        timer.stop()
        assert legends and not errors and not legends[0].isNull(), errors
        legends[0].save(str(report / f'multilayer-{label}-{name[-8:]}-legend.png'))
    observations[:] = [row for row in observations if row['phase'] != label] + phase_observations
    completed_phases.add(label)
    print({'phase': label, 'observations': len(observations), 'independent_layers': len(layers)})


def finish():
    assert completed_phases == {'single', 'bulk', 'retained', 'new'}
    result = {'status': 'passed', 'qgis_version': Qgis.QGIS_VERSION,
              'input_inventory_sha256': hashlib.sha256((report / 'inputs-start.json').read_bytes()).hexdigest(),
              'observations': observations,
              'dialog_bulk_limitation': json.loads((report / 'multilayer-dialog-limitation.json').read_text(encoding='utf-8')),
              'method': 'stock WMS dialog single add; Browser Add Selected Layers bulk add; same-layer Identify tool'}
    (report / 'common-multilayer-desktop.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    # This stock-dialog gate also satisfies the common-WMS ordinary-add gate.
    if not (report / 'common-desktop.json').exists():
        (report / 'common-desktop.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')


def edit_connection():
    from qgis.PyQt.QtCore import QTimer
    from qgis.PyQt.QtWidgets import QPushButton
    state = probe['prepare'].__globals__
    advanced = json.loads((report / 'multilayer-advance.json').read_text())
    from urllib.parse import urlsplit
    origin = urlsplit(state['connection_url'])
    state['connection_url'] = origin.scheme + '://' + origin.netloc + '/gis/v1/wms?' + urlencode(advanced['snapshot'])
    QTimer.singleShot(0, state['widget'].findChild(QPushButton, 'btnEdit').click)


def cleanup():
    probe['cleanup']()
    if 'browser_state' in globals():
        from qgis.PyQt.QtCore import QMetaObject, Qt
        dock, view = browser_state['dock'], browser_state['view']
        model = view.model()
        root = next(model.index(r, 0) for r in range(model.rowCount()) if model.index(r, 0).data() == 'WMS/WMTS')
        view.clearSelection()
        view.setExpanded(root, browser_state['expanded'])
        dock.setVisible(browser_state['visible'])
        QMetaObject.invokeMethod(dock, 'refresh', Qt.QueuedConnection)
