"""Private GeoServer control and real read-after-index visibility checks."""

import os
import io
import re
from pathlib import Path
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image
from publication.domain import PublicationUnavailable
from urllib.parse import urlencode

import requests
import pg8000.dbapi

BASE = 'http://geoserver:8080/geoserver'


def admin(method: str, path: str, **kwargs) -> requests.Response:
    response = requests.request(method, BASE + '/rest' + path,
                                auth=(os.environ['GEOSERVER_ADMIN_USER'], os.environ['GEOSERVER_ADMIN_PASSWORD']),
                                timeout=60, **kwargs)
    response.raise_for_status()
    return response


def discard_staging(workspace: str) -> None:
    """Remove one unreferenced attempt's private workspace and owned index."""
    if re.fullmatch(r'p[0-9a-f]{24}', workspace) is None:
        raise ValueError('invalid managed workspace')
    response = admin('GET', '/workspaces.json')
    workspaces = response.json().get('workspaces', {}).get('workspace', [])
    if any(item['name'] == workspace for item in workspaces):
        admin('DELETE', '/workspaces/' + workspace + '?recurse=true')
    connection = pg8000.dbapi.connect(host='db', database='hmc', user='hmc_mosaic',
                                     password=os.environ['MOSAIC_PASSWORD'], timeout=5, ssl_context=False)
    try:
        cursor = connection.cursor()
        # Identifier is validated above and is derived only from the recorded
        # workspace. The mosaic owner cannot alter application catalogue tables.
        cursor.execute('DROP TABLE IF EXISTS mosaic."g' + workspace[1:] + '"')
        connection.commit()
    finally:
        connection.close()


def configure_limits() -> dict:
    """Bound server-side WMS rendering as well as gateway HTTP reading."""
    limits = {'maxRenderingTime': 20, 'maxRequestMemory': 16384}
    admin('PUT', '/services/wms/settings.json', json={'wms': limits})
    observed = admin('GET', '/services/wms/settings.json').json()['wms']
    if any(observed.get(key) != value for key, value in limits.items()):
        raise PublicationUnavailable('GIS resource limits not applied')
    return limits


def prepare(workspace: str, directory: str, valid_time: str, *, srs: str = 'EPSG:100001', portrayal: dict | None = None) -> dict:
    configure_limits()
    admin('POST', '/workspaces', json={'workspace': {'name': workspace}})
    admin('PUT', f'/workspaces/{workspace}/coveragestores/temperature/external.imagemosaic?configure=all',
          data=directory + '/', headers={'Content-Type': 'text/plain'})
    coverage_path = f'/workspaces/{workspace}/coveragestores/temperature/coverages'
    names = admin('GET', coverage_path + '.json').json()['coverages']['coverage']
    if len(names) != 1:
        raise ValueError('unexpected GIS coverage count')
    name = names[0]['name']
    style=Path(__file__).with_name('temperature.sld').read_bytes()
    if portrayal:
        import xml.etree.ElementTree as ET
        root=ET.fromstring(style)
        for title in root.findall('.//{*}Title'):
            title.text='Поле GRIB · '+portrayal['units']
        colors=['#7272b5','#529abd','#70c8b2','#d6d67f','#edab68','#c96761']
        for color_map in root.findall('.//{*}ColorMap'):
            color_map.clear();color_map.set('type','ramp')
            low,high=portrayal['range']
            for index,color in enumerate(colors):
                quantity=low+(max(high-low,abs(low)*1e-7,1e-30))*index/5
                ET.SubElement(color_map,'{http://www.opengis.net/sld}ColorMapEntry',color=color,
                              quantity=str(quantity),label=str(quantity)+' '+portrayal['units'])
        style=ET.tostring(root,encoding='utf8')
    admin('POST', f'/workspaces/{workspace}/styles?name=raster',
          data=style,
          headers={'Content-Type': 'application/vnd.ogc.sld+xml'})
    admin('PUT', f'/layers/{workspace}:{name}.json', json={'layer': {
        'defaultStyle': {'name': 'raster', 'workspace': workspace}}})
    admin('PUT', coverage_path + '/' + name + '.json', json={'coverage': {'name': name,
        'srs':srs, 'projectionPolicy':'FORCE_DECLARED', 'enabled':True, 'metadata': {
        'entry': [{'@key': 'time', 'dimensionInfo': {'enabled': True, 'presentation': 'LIST',
                   'units': 'ISO8601', 'defaultValue': {'strategy': 'MINIMUM'}, 'nearestMatchEnabled': False}}]}}})
    return {'workspace': workspace, 'layer': f'{workspace}:{name}', 'coverage': name,
            'style': f'{workspace}:raster',
            'valid_time': valid_time}


def wms(gis: dict, parameters: dict, *, seconds: float = 20) -> requests.Response:
    from publication.limited import run
    result = run('http', {'url': BASE + '/' + gis['workspace'] + '/wms', 'params': parameters,
                         'seconds': seconds, 'output': 4 * 1024**2}, seconds)
    response = requests.Response()
    response.status_code = result['status']
    response._content = result['body']
    response.headers.update(result['headers'])
    response.raise_for_status()
    if b'ServiceException' in response.content or b'ExceptionReport' in response.content:
        raise PublicationUnavailable('GIS returned an exception document')
    return response


def verify(gis: dict) -> dict:
    path = (f"/workspaces/{gis['workspace']}/coveragestores/temperature/coverages/"
            f"{gis['coverage']}/index/granules.json")
    observed = []
    # Explicit positive and negative granule filters exercise the real index.
    for instant in [gis['valid_time'], '1900-01-01T00:00:00Z']:
        query = urlencode({'filter': f"time = '{instant}'"})
        features = admin('GET', path + '?' + query).json()['features']
        observed.append(len(features))
    if observed != [1, 0]:
        raise ValueError(f'GIS granule filtering failed: {observed}')
    capabilities = wms(gis, {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetCapabilities'})
    root = ET.fromstring(capabilities.content)
    dimensions = root.findall('.//{*}Dimension')
    times = [node.text or '' for node in dimensions if node.get('name') == 'time']
    if len(times) != 1 or times[0].replace('.000Z', 'Z') != gis['valid_time']:
        raise ValueError(f'GIS discovery time domain differs: {times}')
    layers = [node.text or '' for node in root.findall('.//{*}Layer/{*}Name')]
    if len(layers) != 1 or layers[0].split(':')[-1] != gis['coverage']:
        raise ValueError(f'GIS discovery layers differ: {layers}')
    map_bbox = '-1000000,5000000,3000000,9000000'
    if gis.get('derivative'):
        from pyproj import Transformer
        bounds = Transformer.from_crs('EPSG:4326','EPSG:3857',always_xy=True).transform_bounds(*gis['derivative']['bounds'])
        map_bbox = ','.join(map(str,bounds))
    image = wms(gis, {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap',
                     'LAYERS': gis['layer'], 'STYLES': '', 'TIME': gis['valid_time'],
                     'CRS': 'EPSG:3857', 'BBOX': map_bbox,
                     'WIDTH': 64, 'HEIGHT': 64, 'FORMAT': 'image/png', 'TRANSPARENT': 'true'})
    if not image.content.startswith(b'\x89PNG'):
        raise ValueError('GIS map not PNG')
    if Image.open(io.BytesIO(image.content)).convert('RGBA').getchannel('A').getextrema()[1] == 0:
        raise ValueError('GIS map contains no visible coverage')
    identified_value = None
    if 'probe' in gis:
        from publication.tiles import MAP_TO_NATIVE
        probe = gis['probe']
        if gis.get('source_crs'):
            from decoder.grib_crs import transform
            from pyproj import Transformer
            longitude,latitude = transform(gis['source_crs'],probe['lon'],probe['lat'],inverse=True)
            mx,my = Transformer.from_crs('EPSG:4326','EPSG:3857',always_xy=True).transform(longitude,latitude)
        else:
            mx,my,_ = MAP_TO_NATIVE.transform(probe['lon'],probe['lat'],0.,direction='INVERSE')
        identified = wms(gis, {'SERVICE':'WMS','VERSION':'1.3.0','REQUEST':'GetFeatureInfo',
            'LAYERS':gis['layer'],'QUERY_LAYERS':gis['layer'],'STYLES':'','TIME':gis['valid_time'],
            'CRS':'EPSG:3857','BBOX':f'{mx-150},{my-150},{mx+150},{my+150}',
            'WIDTH':3,'HEIGHT':3,'I':1,'J':1,'FORMAT':'image/png','INFO_FORMAT':'text/plain'})
        match = re.search(r'GRAY_INDEX\s*=\s*([0-9.eE+-]+)',identified.text)
        if match is None or abs(float(match.group(1))-probe['value']) > 0.0001:
            raise ValueError('GIS coordinate placement/value differs from native baseline')
        identified_value = float(match.group(1))
    return {'granule_counts_positive_negative': observed, 'capability_times': times,
            'capability_layers': layers, 'map_bytes': len(image.content),
            **({'identified_value':identified_value,'units':gis['units']} if 'units' in gis else {'identified_value_K':identified_value})}
