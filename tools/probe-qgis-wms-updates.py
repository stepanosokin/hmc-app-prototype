"""Ordinary QGIS connection refresh, redraw and saved-project lifecycle (#108).

Keep the returned namespace on qgis.utils between MCP calls. Invoke modal
actions through the existing snapshot probe in separate event-loop turns.
"""
import hashlib
import json
from pathlib import Path
import runpy
from urllib.parse import urlencode

from qgis.core import QgsProject, Qgis

probe: dict
report: Path
base: str
before: dict
saved_project: Path
observations: dict


def prepare(config_path):
    global probe, report, saved_project, observations, base
    observations = {}
    config = json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
    report = Path(config['report_directory'])
    if not report.is_absolute():
        report = Path(__file__).resolve().parents[1] / report
    seed = json.loads((report / 'desktop-seed.json').read_text(encoding='utf-8'))
    base = config['base']
    saved_project = report / 'updates-project.qgz'
    probe = runpy.run_path(str(Path(__file__).with_name('probe-qgis-wms-snapshot.py')))
    probe['prepare'](str(report), base + '/gis/v1/wms?' + urlencode(seed['snapshot']), seed['name'])


def edit_connection(phase):
    """Replace the URL with a newly obtained advertised common catalogue link."""
    from qgis.PyQt.QtCore import QTimer
    from qgis.PyQt.QtWidgets import QPushButton
    state = probe['prepare'].__globals__
    published = json.loads((report / (phase + '.json')).read_text(encoding='utf-8'))
    state['connection_url'] = base + '/gis/v1/wms?' + urlencode(published['snapshot'])
    QTimer.singleShot(0, state['widget'].findChild(QPushButton, 'btnEdit').click)


def capture_before():
    global before
    before = probe['capture_state']('updates-before', center=(0, 0), expected=280)
    assert QgsProject.instance().write(str(saved_project))


def verify_redraw_and_reopen():
    redrawn = probe['capture_state']('updates-redraw', center=(0, 0), expected=280)
    assert redrawn['uri'] == before['uri']
    assert QgsProject.instance().read(str(saved_project))
    reopened = probe['capture_state']('updates-reopened', center=(0, 0), expected=280)
    assert reopened['uri'] == before['uri']
    observations['redraw_and_reopen'] = True


def capture_partial():
    after = probe['capture_state']('updates-refreshed', center=(0, 0), expected=290)
    assert after['uri'] != before['uri'] and after['name'] == before['name']
    observations['partial'] = after


def verify_tree(phase):
    from qgis.PyQt.QtWidgets import QTreeWidget, QTreeWidgetItemIterator
    state = probe['prepare'].__globals__
    control = state['widget'].findChild(QTreeWidget, 'lstLayers')
    expected = json.loads((report / (phase + '.json')).read_text(encoding='utf-8'))['models']
    iterator = QTreeWidgetItemIterator(control)
    names = set()
    while iterator.value():
        item = iterator.value()
        if item.text(1).startswith('hmc_'):
            names.add(item.text(1))
        iterator += 1
    assert names == {leaf['name'] for leaves in expected.values() for leaf in leaves}
    observations[phase + '_tree'] = expected
    state['widget'].grab().save(str(report / (phase + '-tree.png')))


def verify_failed_preparation():
    state = probe['capture_state']('updates-failed-preparation', center=(0, 0), expected=290)
    assert state['uri'] == observations['partial']['uri']
    observations['failed_preparation'] = state


def capture_independent():
    observations['independent'] = probe['capture_state']('updates-independent', center=(0, 0), expected=275)


def capture_replacement():
    observations['replacement'] = probe['capture_state']('updates-replacement', center=(0, 0), units='Pa', expected=100000)


def verify_unavailable(label, previous):
    from qgis.core import QgsPointXY, QgsRaster, QgsRectangle
    uri = observations[previous]['uri']
    layer = next(layer for layer in QgsProject.instance().mapLayers().values() if layer.source() == uri)
    result = layer.dataProvider().identify(QgsPointXY(0, 0), QgsRaster.IdentifyFormatText,
                                          QgsRectangle(-.01, -.01, .01, .01), 3, 3)
    assert not result.isValid() or not any(result.results().values()), 'Unavailable snapshot returned forecast values'
    observations[label] = {'unavailable': True, 'uri': uri}


def finish():
    assert all(key in observations for key in ('redraw_and_reopen', 'partial', 'independent',
        'failed_preparation', 'replacement', 'withdrawn', 'expired',
        'desktop-advance_tree', 'desktop-failure_tree', 'desktop-withdraw_tree', 'desktop-expire_tree'))
    inventory = report / 'inputs-start.json'
    result = {'status': 'passed', 'qgis_version': Qgis.QGIS_VERSION,
              'input_inventory_sha256': hashlib.sha256(inventory.read_bytes()).hexdigest(),
              'redraw_kept_snapshot': True, 'saved_project_kept_snapshot': True,
              'explicit_reconnect_and_add': True, 'before': before, 'observations': observations}
    (report / 'common-updates-desktop.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    common_report = report / 'common-desktop.json'
    if not common_report.exists():
        common_report.write_text(json.dumps({
            'status': 'passed', 'qgis_version': result['qgis_version'],
            'input_inventory_sha256': result['input_inventory_sha256'],
            'source_report': 'common-updates-desktop.json'}, indent=2), encoding='utf-8')


def cleanup():
    probe['cleanup']()
