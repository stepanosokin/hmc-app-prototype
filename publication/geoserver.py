"""Private GeoServer control and real read-after-index visibility checks."""

import os
import io
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image
from publication.domain import PublicationUnavailable
from urllib.parse import urlencode

import requests

BASE = 'http://geoserver:8080/geoserver'


def admin(method: str, path: str, **kwargs) -> requests.Response:
    response = requests.request(method, BASE + '/rest' + path,
                                auth=(os.environ['GEOSERVER_ADMIN_USER'], os.environ['GEOSERVER_ADMIN_PASSWORD']),
                                timeout=60, **kwargs)
    response.raise_for_status()
    return response


def prepare(workspace: str, directory: str, valid_time: str) -> dict:
    admin('POST', '/workspaces', json={'workspace': {'name': workspace}})
    admin('PUT', f'/workspaces/{workspace}/coveragestores/temperature/external.imagemosaic?configure=all',
          data=directory + '/', headers={'Content-Type': 'text/plain'})
    coverage_path = f'/workspaces/{workspace}/coveragestores/temperature/coverages'
    names = admin('GET', coverage_path + '.json').json()['coverages']['coverage']
    if len(names) != 1:
        raise ValueError('unexpected GIS coverage count')
    name = names[0]['name']
    admin('PUT', coverage_path + '/' + name + '.json', json={'coverage': {'name': name,
        'srs':'EPSG:100001', 'projectionPolicy':'FORCE_DECLARED', 'enabled':True, 'metadata': {
        'entry': [{'@key': 'time', 'dimensionInfo': {'enabled': True, 'presentation': 'LIST',
                   'units': 'ISO8601', 'defaultValue': {'strategy': 'MINIMUM'}, 'nearestMatchEnabled': False}}]}}})
    return {'workspace': workspace, 'layer': f'{workspace}:{name}', 'coverage': name,
            'valid_time': valid_time}


def wms(gis: dict, parameters: dict) -> requests.Response:
    response = requests.get(BASE + '/' + gis['workspace'] + '/wms', params=parameters, timeout=60)
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
    image = wms(gis, {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap',
                     'LAYERS': gis['layer'], 'STYLES': '', 'TIME': gis['valid_time'],
                     'CRS': 'EPSG:3857', 'BBOX': '-1000000,5000000,3000000,9000000',
                     'WIDTH': 64, 'HEIGHT': 64, 'FORMAT': 'image/png', 'TRANSPARENT': 'true'})
    if not image.content.startswith(b'\x89PNG'):
        raise ValueError('GIS map not PNG')
    if Image.open(io.BytesIO(image.content)).convert('RGBA').getchannel('A').getextrema()[1] == 0:
        raise ValueError('GIS map contains no visible coverage')
    identified_value = None
    if 'probe' in gis:
        from publication.tiles import MAP_TO_NATIVE
        probe = gis['probe']
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
            'capability_layers': layers, 'map_bytes': len(image.content),'identified_value_K':identified_value}
