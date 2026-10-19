"""Published-only catalogue, canonical point, numeric tiles and scoped WMS."""

import json
import xml.etree.ElementTree as ET
from urllib.parse import quote

import requests
import pg8000.dbapi
from flask import Flask, Response, jsonify, request

from decoder.sampling import asset_path
from publication.domain import ROOT, database, resolve, sampler, PublicationUnavailable
from decoder.inspect_forecast import ValidationError
from publication.tiles import render, encode, CONTRACT
from publication import geoserver


def links(manifest: dict) -> dict:
    selection, identity = manifest['selection'], manifest['identity']
    return {'selection': selection, **identity, 'units': 'K', 'state': 'published',
            'valid_times': [identity['valid_time']],
            'point': '/api/v1/point',
            'tiles': f'/api/v1/selections/{selection}/tiles.json',
            'wms': '/gis/v1/runs/' + quote(identity['run'], safe='') + '/revisions/' + identity['revision'] + '/wms'}


def create_app() -> Flask:
    app = Flask('hmc-publication')

    @app.errorhandler(KeyError)
    def unavailable(error):
        return jsonify(code='NotFound', description='unavailable published selection'), 404

    @app.errorhandler(ValueError)
    @app.errorhandler(ValidationError)
    def invalid(error):
        return jsonify(code='InvalidParameterValue', description=str(error)[:200]), 400

    @app.errorhandler(requests.RequestException)
    @app.errorhandler(PublicationUnavailable)
    @app.errorhandler(pg8000.dbapi.Error)
    @app.errorhandler(OSError)
    def upstream(error):
        return jsonify(code='Unavailable', description='published service temporarily unavailable'), 503

    @app.get('/health')
    def health():
        with database() as cursor:
            cursor.execute('SELECT 1')
        return jsonify(status='ready')

    @app.get('/api/v1/catalogue')
    def catalogue():
        with database() as cursor:
            cursor.execute('SELECT selection FROM app.catalogue ORDER BY selection')
            rows = cursor.fetchall()
        return jsonify(selections=[links(resolve(row['selection'])) for row in rows])

    @app.get('/api/v1/jobs/<uuid:job>')
    def job_status(job):
        with database() as cursor:
            cursor.execute('SELECT id,state,history,checksum,pipeline_version,selection,error FROM app.jobs WHERE id=%s', (str(job),))
            row = cursor.fetchone()
        if row is None:
            raise KeyError('job')
        # Expose progress and immutable identifiers, never paths/private GIS config.
        row['history'] = [{'state': item['state']} for item in row['history']]
        return jsonify(row)

    def arguments(required: set, optional: set | None = None) -> dict:
        if (set(request.args) - required - (optional or set()) or required - set(request.args)
                or any(len(request.args.getlist(key)) != 1 for key in request.args)):
            raise ValueError('missing, repeated or unsupported parameter')
        return request.args.to_dict()

    @app.get('/api/v1/point')
    def point():
        args = arguments({'selection', 'run', 'revision', 'valid_time', 'layer', 'lon', 'lat'})
        manifest = resolve(args['selection'])
        identity = manifest['identity']
        if any(args[key] != identity[key] for key in ('run', 'revision', 'valid_time')) or args['layer'] != identity['field']:
            raise KeyError('selection mismatch')
        result = sampler(manifest).sample(run=args['run'], revision=args['revision'],
                                         field=args['layer'], valid_time=args['valid_time'],
                                         lon=float(args['lon']), lat=float(args['lat']))
        return jsonify(selection=manifest['selection'], **result)

    @app.get('/api/v1/selections/<selection>/tiles.json')
    def tile_metadata(selection):
        arguments(set())
        manifest = resolve(selection)
        return Response(asset_path(ROOT, manifest['tile_metadata']).read_bytes(), content_type='application/json')

    @app.get('/api/v1/selections/<selection>/tiles/2/<int:z>/<int:x>/<int:y>.f32')
    def tile(selection, z, x, y):
        arguments(set())
        manifest = resolve(selection)
        numerical = sampler(manifest)
        item = next(item for item in numerical.manifest['fields'] if item['metadata']['valid_time'] == manifest['identity']['valid_time'])
        payload = encode(*render(numerical.root, item, z, x, y), manifest['encoding'])
        response = Response(payload, content_type=CONTRACT['encodings']['f32']['content_type'])
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/gis/v1/runs/<path:run_id>/revisions/<revision>/wms')
    def wms(run_id, revision):
        catalogue_value = catalogue().get_json()
        candidates = [item for item in catalogue_value['selections'] if item['run'] == run_id and item['revision'] == revision]
        if not candidates:
            raise KeyError('GIS selection')
        manifest = resolve(candidates[0]['selection'])
        gis = manifest['gis']
        # Normalize case, then reject duplicate and arbitrary pass-through options.
        params = {key.upper(): value for key, value in request.args.items()}
        if len(params) != len(request.args) or any(len(request.args.getlist(key)) != 1 for key in request.args):
            raise ValueError('repeated WMS parameter')
        operation = params.get('REQUEST')
        if params.get('SERVICE') != 'WMS' or params.get('VERSION') != '1.3.0':
            raise ValueError('WMS 1.3.0 required')
        allowed = {'SERVICE', 'VERSION', 'REQUEST'}
        if operation in ('GetMap', 'GetFeatureInfo'):
            allowed |= {'LAYERS', 'STYLES', 'TIME', 'CRS', 'BBOX', 'WIDTH', 'HEIGHT', 'FORMAT', 'TRANSPARENT'}
            if operation == 'GetFeatureInfo':
                allowed |= {'QUERY_LAYERS', 'INFO_FORMAT', 'I', 'J', 'FEATURE_COUNT'}
            if params.get('LAYERS') != 'temperature' or params.get('TIME') != gis['valid_time']:
                raise KeyError('GIS layer/time')
            if params.get('CRS') not in ('EPSG:4326', 'EPSG:3857'):
                raise ValueError('unsupported WMS CRS')
            if params.get('FORMAT') != 'image/png' or params.get('STYLES', '') not in ('', 'raster'):
                raise ValueError('unsupported portrayal')
            for dimension in ('WIDTH', 'HEIGHT'):
                if not 1 <= int(params.get(dimension, '0')) <= 1024:
                    raise ValueError('map dimensions outside 1..1024')
            params['LAYERS'] = gis['layer']
            if operation == 'GetFeatureInfo':
                if params.get('QUERY_LAYERS') != 'temperature' or params.get('INFO_FORMAT') != 'text/plain':
                    raise ValueError('unsupported identify')
                params['QUERY_LAYERS'] = gis['layer']
        elif operation != 'GetCapabilities':
            raise ValueError('unsupported scoped operation')
        if set(params) - allowed:
            raise ValueError('unsupported WMS option')
        result = geoserver.wms(gis, params)
        payload = result.content
        if operation == 'GetCapabilities':
            root = ET.fromstring(payload)
            scoped = request.path + '?'
            namespace = '{http://www.opengis.net/wms}'
            root.set('{http://www.w3.org/2001/XMLSchema-instance}schemaLocation',
                     'http://www.opengis.net/wms https://schemas.opengis.net/wms/1.3.0/capabilities_1_3_0.xsd')
            for parent in root.iter():
                for node in list(parent):
                    local = node.tag.split('}')[-1]
                    if (local == 'CRS' and node.text not in ('EPSG:4326','EPSG:3857')
                            or local == 'BoundingBox' and node.get('CRS') not in ('EPSG:4326','EPSG:3857')
                            or local in ('Post','LegendURL')):
                        parent.remove(node)
                if parent.tag == namespace+'Request':
                    for node in list(parent):
                        if node.tag.split('}')[-1] not in ('GetCapabilities','GetMap','GetFeatureInfo'):
                            parent.remove(node)
                if parent.tag in (namespace+'GetMap',namespace+'GetFeatureInfo'):
                    expected = 'image/png' if parent.tag == namespace+'GetMap' else 'text/plain'
                    for node in list(parent):
                        if node.tag == namespace+'Format' and node.text != expected:
                            parent.remove(node)
            for node in root.iter():
                for key in list(node.attrib):
                    if key.endswith('}href'):
                        node.set(key, scoped)
                if node.tag.endswith('}Name') and node.text and node.text.split(':')[-1] == gis['coverage']:
                    node.text = 'temperature'
            payload = ET.tostring(root, encoding='utf-8', xml_declaration=True)
        return Response(payload, content_type=result.headers.get('Content-Type', 'application/xml'))

    return app
