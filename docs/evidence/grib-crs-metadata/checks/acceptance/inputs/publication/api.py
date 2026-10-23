"""Published-only catalogue, canonical point, numeric tiles and scoped WMS."""

import json
import hashlib
import threading
import time
import os
import sys
import re
import xml.etree.ElementTree as ET
from urllib.parse import quote

import requests
import pg8000.dbapi
from flask import Flask, Response, jsonify, request, g

from decoder.sampling import asset_path
from publication.domain import ROOT, database, resolve, sampler, PublicationUnavailable
from decoder.inspect_forecast import ValidationError
from publication.tiles import render, encode, CONTRACT
from publication import geoserver
from publication import revisions
from publication import retention
from publication import budgets
from publication import numerical
from publication import native_display
from publication import wms as wms_options
from publication.process_channel import ProcessChannel
from publication.tile_cache import TileCache
from publication.limited import run as limited_work, WorkLimit, request_deadline

# QGIS' capabilities reader expects the WMS elements in the default namespace.
ET.register_namespace('', 'http://www.opengis.net/wms')
ET.register_namespace('xlink', 'http://www.w3.org/1999/xlink')


def links(manifest: dict) -> dict:
    selection, identity = manifest['selection'], manifest['identity']
    version = native_display.profile(manifest['source'].get('source_crs'))[2]
    prefix = request.headers.get('X-Publication-Prefix', '')
    return {'selection': selection, **identity, 'units': 'K', 'state': 'published',
            'module': 'meteorology',
            'collection': prefix + '/ogc/collections/' + selection,
            'position': prefix + '/ogc/collections/' + selection + '/position',
            'valid_times': manifest.get('revision_times', [identity['valid_time']]),
            'completeness': manifest.get('completeness', 'unknown'),
            'fixture': manifest.get('fixture', 'actual'),
            'batch': manifest.get('batch_selection', selection),
            'point': prefix + '/api/v1/point',
            'tiles': prefix + f'/api/v1/selections/{selection}/tiles.json',
            'native_display': prefix + f'/api/v1/selections/{selection}/display/{version}/native.json',
            'wms': prefix + '/gis/v1/runs/' + quote(identity['run'], safe='') + '/revisions/' + identity['revision'] + '/wms'}


def revision_links(row: dict) -> list[dict]:
    try:
        revision = revisions.load_revision(row['manifest_path'], row['manifest_sha256'])
        return [links(revisions.selected(revision, entry)) for entry in revision['batches']]
    except (OSError, ValueError, KeyError, TypeError, ValidationError) as error:
        raise PublicationUnavailable('published revision unavailable') from error


def create_app() -> Flask:
    app = Flask('hmc-publication')
    tile_cache = TileCache()
    native_cache = TileCache(cap=16 * 1024**2)
    native_work = ProcessChannel('publication.native_process', 332820)
    # Load reader code during service startup, without warming any field data.
    # Native readiness is still established separately by metadata probes.
    try:
        native_work.run('native-initialize', {}, 10)
    except (WorkLimit, OSError):
        print(json.dumps({'native_reader': 'initialization-deferred'}), file=sys.stderr, flush=True)
    work = threading.BoundedSemaphore(4)

    @app.before_request
    def protect_reader():
        if request.path == '/health':
            return
        g.deadline = min(time.time() + 30, float(request.headers.get('X-HMC-Deadline', time.time() + 30)))
        if g.deadline <= time.time():
            raise WorkLimit(504)
        g.deadline_token = request_deadline.set(g.deadline)
        if not work.acquire(blocking=False):
            response = jsonify(code='TooManyRequests', description='Сервис занят. Повторите позже.')
            response.status_code = 429
            response.headers['Retry-After'] = '2'
            return response
        g.work = True
        request_id = request.headers.get('X-HMC-Request-ID')
        if request_id:
            if not budgets.backend(request_id):
                raise WorkLimit(504)
            g.backend_id = request_id
        # Isolated actual-path test of cold I/O that outlives gateway timeout.
        if (os.environ.get('T6_TEST_FAULTS') == '1' and request.path.endswith('/tiles/2/6/34/20.f32')
                and (ROOT / '.t9-reader-delay').exists()):
            time.sleep(50)
        guard = retention.reader()
        guard.__enter__()
        g.retention_reader = guard
        _, _, rows = retention.snapshot()
        g.expired_roots = {row['root'] for row in rows if row['state'] == 'expired'}
        tile_cache.expire(g.expired_roots)
        native_cache.expire(g.expired_roots)

    @app.teardown_request
    def release_reader(error):
        guard = g.pop('retention_reader', None)
        try:
            if guard is not None:
                guard.__exit__(None, None, None)
        finally:
            if g.pop('work', False):
                work.release()
            token = g.pop('deadline_token', None)
            if token is not None:
                request_deadline.reset(token)
            request_id = g.pop('backend_id', None)
            if request_id:
                try:
                    budgets.backend(request_id, done=True)
                except (pg8000.dbapi.Error, OSError, KeyError):
                    print(json.dumps({'request_id': request_id, 'backend_done': 'unavailable'}), file=sys.stderr, flush=True)

    @app.after_request
    def cache_policy(response):
        if 'Cache-Control' not in response.headers:
            response.headers['Cache-Control'] = 'no-store'
        if 'identity' in g:
            response.headers['X-HMC-Product'] = g.identity['model'] if 'model' in g.identity else g.identity['field']
            response.headers['X-HMC-Run'] = g.identity['run']
            response.headers['X-HMC-Revision'] = g.identity['revision']
        return response

    @app.errorhandler(WorkLimit)
    def work_limit(error):
        response = jsonify(code='ResourceLimit', description='Превышен ресурсный лимит запроса.')
        response.status_code = error.status
        response.headers['Retry-After'] = '2'
        return response

    @app.errorhandler(retention.ExpiredSelection)
    def expired(error):
        return jsonify(code='Expired', description='published selection expired'), 410

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
        response = jsonify(code='Unavailable', description='published service temporarily unavailable')
        response.status_code = 503
        response.headers['Retry-After'] = '2'
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/health')
    def health():
        with database() as cursor:
            cursor.execute('SELECT 1')
        return jsonify(status='ready')

    def published_selections():
        with database() as cursor:
            cursor.execute('SELECT selection FROM app.catalogue ORDER BY selection')
            rows = cursor.fetchall()
            cursor.execute('SELECT revision,manifest_path,manifest_sha256 FROM app.revisions ORDER BY published_at,revision')
            revision_rows = cursor.fetchall()
        selections = [links(resolve(row['selection'])) for row in rows if row['selection'] not in g.expired_roots]
        for row in revision_rows:
            # Selection identity is derived only after checking root eligibility.
            if row['revision'] not in g.expired_roots:
                selections.extend(revision_links(row))
        return selections

    @app.get('/api/v1/catalogue')
    def catalogue():
        arguments(set())
        return jsonify(version='1', selections=published_selections())

    @app.get('/api/v1/modules')
    def modules():
        arguments(set())
        present = bool(published_selections())
        return jsonify(modules=[{'id': 'meteorology', 'title': 'Метеорология',
            'available': present, 'sources': ['manifest-zarr'],
            'products': ['surface-temperature'], 'queries': ['point', 'position'],
            'access': {'scope': 'api', 'organization_prefix': '/org', 'public_demo': True}}])

    @app.get('/api/v1/models')
    def models():
        arguments(set())
        selections = published_selections()
        return jsonify(models=[{'id': model, 'module': 'meteorology',
            'runs': sorted({item['run'] for item in selections if item['model'] == model})}
            for model in sorted({item['model'] for item in selections})])

    @app.get('/api/v1/runs')
    def runs():
        args = arguments({'model'})
        selections = [item for item in published_selections() if item['model'] == args['model']]
        return jsonify(runs=[{'id': run, 'model': args['model'],
            'revisions': sorted({item['revision'] for item in selections if item['run'] == run})}
            for run in sorted({item['run'] for item in selections})])

    @app.get('/api/v1/revisions')
    def revision_listing():
        args = arguments({'model', 'run'})
        selections = [item for item in published_selections()
                      if item['model'] == args['model'] and item['run'] == args['run']]
        return jsonify(revisions=[{'id': revision, 'run': args['run'],
            'selections': [item for item in selections if item['revision'] == revision]}
            for revision in sorted({item['revision'] for item in selections})])

    @app.get('/ogc')
    def landing():
        arguments(set())
        prefix = request.headers.get('X-Publication-Prefix', '')
        return jsonify(title='Числовой API Гидрометцентра', profile='hmc-edr-position/1', links=[
            {'rel': 'data', 'href': prefix + '/ogc/collections', 'type': 'application/json'},
            {'rel': 'conformance', 'href': prefix + '/ogc/conformance', 'type': 'application/json'},
            {'rel': 'service-desc', 'href': prefix + '/api/v1/openapi.json', 'type': 'application/vnd.oai.openapi+json;version=3.0'}])

    @app.get('/ogc/conformance')
    def conformance():
        arguments(set())
        return jsonify(conformsTo=[], profile='hmc-edr-position/1',
                       description='Ограниченный профиль Position. Полное соответствие OGC не заявлено.')

    def collection_description(selection):
        manifest = resolve(selection)
        g.identity = manifest['identity']
        prefix = request.headers.get('X-Publication-Prefix', '')
        result = numerical.describe(manifest, prefix)
        result['numeric_tiles'] = tile_description(manifest)
        result['links'].extend([{'rel': 'related', 'href': links(manifest)['wms'], 'type': 'application/xml'},
                                {'rel': 'related', 'href': prefix + '/api/v1/point', 'type': 'application/json'}])
        return result

    @app.get('/ogc/collections')
    def collections():
        arguments(set())
        return jsonify(collections=[collection_description(item['selection']) for item in published_selections()], links=[])

    @app.get('/ogc/collections/<selection>')
    def collection(selection):
        arguments(set())
        return jsonify(collection_description(selection))

    @app.get('/ogc/collections/<selection>/position')
    def edr_position(selection):
        args = arguments({'coords', 'datetime', 'parameter-name', 'run', 'revision'}, {'f', 'crs'})
        if args.get('f', 'CoverageJSON') not in ('CoverageJSON', 'json'):
            raise ValueError('Поддерживается формат CoverageJSON.')
        if args['parameter-name'] != 'T_G':
            raise KeyError('parameter')
        match = re.fullmatch(r'POINT\(\s*([^\s()]+)\s+([^\s()]+)\s*\)', args['coords'])
        if not match:
            raise ValueError('Требуется одна двумерная точка POINT(lon lat).')
        crs = args.get('crs')
        manifest, point = numerical.sample(selection, args['run'], args['revision'], 'T_G:surface:0',
                                           args['datetime'], match.group(1), match.group(2), crs)
        g.identity = manifest['identity']
        return Response(app.json.dumps(numerical.coverage(point)), content_type='application/vnd.cov+json')

    @app.get('/api/v1/openapi.json')
    def openapi():
        from publication.openapi import document
        arguments(set())
        return jsonify(document(request.headers.get('X-Publication-Prefix', '')))

    @app.get('/api/v1/jobs/<uuid:job>')
    def job_status(job):
        with database() as cursor:
            cursor.execute('SELECT id,state,history,checksum,pipeline_version,selection,error,attempts,stage,retryable,retry_at '
                           'FROM app.jobs WHERE id=%s', (str(job),))
            row = cursor.fetchone()
        if row is None:
            raise KeyError('job')
        # Expose progress and immutable identifiers, never paths/private GIS config.
        row['history'] = [{key: value for key, value in item.items()
                           if key in ('state', 'observed_at', 'error_type', 'failed_stage', 'attempt')}
                          for item in row['history']]
        return jsonify(row)

    def arguments(required: set, optional: set | None = None) -> dict:
        if (set(request.args) - required - (optional or set()) or required - set(request.args)
                or any(len(request.args.getlist(key)) != 1 for key in request.args)):
            raise ValueError('missing, repeated or unsupported parameter')
        return request.args.to_dict()

    @app.get('/api/v1/point')
    def point():
        args = arguments({'selection', 'run', 'revision', 'valid_time', 'layer', 'lon', 'lat'}, {'crs'})
        manifest, result = numerical.sample(args['selection'], args['run'], args['revision'], args['layer'],
            args['valid_time'], args['lon'], args['lat'], args.get('crs'))
        g.identity = manifest['identity']
        return jsonify(result)

    def tile_description(manifest):
        selection = manifest['selection']
        payload, outcome = tile_cache.lookup((selection, 'metadata'),
            lambda: asset_path(ROOT, manifest['tile_metadata']).read_bytes(), metadata=True)
        g.tile_cache_outcome = outcome
        metadata = json.loads(payload)
        metadata.update(selection=selection, identity=manifest['identity'],
            representative_tiles=manifest['tile_checks'],
            url=request.headers.get('X-Publication-Prefix', '') + metadata['url_template'].replace('{selection}', selection).replace('{encoding}', manifest['encoding']),
            availability={'state': 'published', 'valid_times': [manifest['identity']['valid_time']]},
            errors={'invalid': 400, 'unavailable': 404, 'expired': 410, 'busy': 429, 'transient': 503},
            expiry='Проверяется до чтения кеша; истёкшая публикация возвращает 410.')
        return metadata

    @app.get('/api/v1/selections/<selection>/tiles.json')
    def tile_metadata(selection):
        arguments(set())
        manifest = resolve(selection)
        g.identity = manifest['identity']
        response = jsonify(tile_description(manifest))
        # Preserve cache observations for the existing metadata access contract.
        response.headers['X-HMC-Cache'] = g.tile_cache_outcome
        return response

    @app.get('/api/v1/selections/<selection>/tiles/2/<int:z>/<int:x>/<int:y>.f32')
    @app.get('/api/v1/selections/<selection>/tiles/3/<int:z>/<int:x>/<int:y>.f32')
    def tile(selection, z, x, y):
        arguments(set())
        manifest = resolve(selection)
        version = manifest['identity']['contract'].rsplit('/',1)[-1]
        if f'/tiles/{version}/' not in request.path:
            raise KeyError('tile version does not match selection')
        g.identity = manifest['identity']
        numerical = sampler(manifest)
        item = next(item for item in numerical.manifest['fields'] if item['metadata']['valid_time'] == manifest['identity']['valid_time'])
        payload, outcome = tile_cache.lookup((selection, z, x, y, manifest['encoding']),
            lambda: limited_work('tile', {'root': str(numerical.root), 'item': item,
                'coordinates': [z, x, y], 'encoding': manifest['encoding']}, max(0.05, min(10, g.deadline-time.time())))['body'])
        response = Response(payload, content_type=CONTRACT['encodings']['f32']['content_type'])
        response.headers['X-HMC-Cache'] = outcome
        response.headers['Cache-Control'] = 'private, no-cache'
        response.set_etag(hashlib.sha256(payload).hexdigest())
        return response

    def native_response(selection, coordinates=None, experiment=None):
        arguments(set())
        deadline = min(g.deadline, time.time() + 10)
        def bounded(operation, arguments):
            remaining = deadline-time.time()
            if remaining <= 0:
                raise WorkLimit(504)
            try:
                return native_work.run(operation, {**arguments, 'deadline': deadline}, remaining)['body']
            except WorkLimit as error:
                if error.status == 404:
                    raise KeyError('unavailable native selection') from error
                if error.status == 410:
                    raise retention.ExpiredSelection(selection) from error
                raise
        manifest = json.loads(bounded('native-resolve', {'selection': selection}))
        g.identity = manifest['identity']
        source = json.loads(bounded('native-source', {'manifest': manifest}))
        root, item = source['root'], source['item']
        version = native_display.profile(item['metadata'].get('source_crs'))[2]
        if '/experiment/' not in request.path and f'/display/{version}/' not in request.path:
            raise KeyError('native display version does not match selection')
        if coordinates is not None:
            native_display.validate_address(coordinates[0], coordinates[1], item['metadata']['grid']['shape_yx'])
        operation = 'native-experiment' if experiment else 'native-metadata' if coordinates is None else 'native-block'
        frame = None
        if experiment:
            from publication.display_experiment import FRAMES
            frame = FRAMES[experiment]
        payload, outcome = native_cache.lookup(native_display.key(manifest, item, operation, coordinates,
            json.dumps(frame, sort_keys=True)),
            lambda: bounded(operation, {'root': root, 'item': item, 'coordinates': coordinates, 'mode': experiment}),
            metadata=coordinates is None and experiment is None, seconds=max(0, deadline-time.time()))
        if time.time() >= deadline:
            raise WorkLimit(504)
        if coordinates is None and experiment is None:
            metadata = json.loads(payload)
            prefix = request.headers.get('X-Publication-Prefix', '')
            metadata.update(selection=selection, identity=manifest['identity'])
            for name in ('metadata_url', 'url_template'):
                metadata[name] = prefix + metadata[name].replace('{selection}', selection)
            metadata['url'] = metadata['url_template']
            response = jsonify(metadata)
        else:
            response = Response(payload, content_type=native_display.CONTRACT['content_type'])
        response.headers['X-HMC-Cache'] = outcome
        response.headers['Cache-Control'] = 'private, no-cache'
        response.set_etag(hashlib.sha256(response.get_data()).hexdigest())
        return response

    @app.get('/api/v1/selections/<selection>/display/1/native.json')
    @app.get('/api/v1/selections/<selection>/display/2/native.json')
    def native_metadata(selection):
        return native_response(selection)

    @app.get('/api/v1/selections/<selection>/display/1/native/<int:column>/<int:row>.f32')
    @app.get('/api/v1/selections/<selection>/display/2/native/<int:column>/<int:row>.f32')
    def native_block(selection, column, row):
        return native_response(selection, (column, row))

    @app.get('/api/v1/selections/<selection>/display/1/experiment/<mode>.f32')
    def display_experiment(selection, mode):
        if os.environ.get('T6_TEST_FAULTS') != '1' or mode not in ('ortho', 'laea'):
            raise KeyError('isolated display experiment')
        response = native_response(selection, experiment=mode)
        response.content_type = 'application/vnd.hmc.experimental-screen-f32'
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/gis/v1/runs/<path:run_id>/revisions/<revision>/wms')
    def wms(run_id, revision):
        _, _, retained = retention.snapshot()
        matches = [row for row in retained if row['run'] == run_id and row['wms_revision'] == revision]
        if matches and all(row['state'] == 'expired' for row in matches):
            raise retention.ExpiredSelection(revision)
        with database() as cursor:
            cursor.execute('SELECT manifest_path,manifest_sha256 FROM app.revisions WHERE run=%s AND revision=%s',
                           (run_id, revision))
            row = cursor.fetchone()
            cursor.execute('SELECT selection FROM app.catalogue')
            legacy = cursor.fetchall()
        if row is not None:
            candidates = revision_links(row)
        else:
            candidates = [links(resolve(item['selection'])) for item in legacy if item['selection'] not in g.expired_roots]
            candidates = [item for item in candidates if item['run'] == run_id and item['revision'] == revision]
        if not candidates:
            raise KeyError('GIS selection')
        # Normalize case, then reject duplicate and arbitrary pass-through options.
        params = {key.upper(): value for key, value in request.args.items()}
        if len(params) != len(request.args) or any(len(request.args.getlist(key)) != 1 for key in request.args):
            raise ValueError('repeated WMS parameter')
        map_limit = min(wms_options.MAX_MAP_SIZE, int(request.headers.get('X-HMC-WMS-Dimension', '512')))
        params = wms_options.normalize(params, map_limit)
        operation = params.get('REQUEST')
        if operation == 'GetCapabilities':
            # Initial WMS version negotiation (QGIS omits VERSION here).
            params.setdefault('VERSION', '1.3.0')
        chosen = candidates
        if operation in ('GetMap', 'GetFeatureInfo') or operation == 'GetLegendGraphic' and 'TIME' in params:
            params.setdefault('TIME', min(item['valid_time'] for item in candidates))
            chosen = [item for item in candidates if item['valid_time'] == params.get('TIME')]
        elif operation == 'GetLegendGraphic':
            chosen = candidates[:1]
        if len(chosen) != 1 and operation != 'GetCapabilities':
            raise KeyError('GIS layer/time')
        manifest = resolve(chosen[0]['selection'])
        g.identity = manifest['identity']
        gis = manifest['gis']
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
                if not 1 <= int(params.get(dimension, '0')) <= map_limit:
                    raise ValueError('map dimensions outside advertised bounds')
            params['LAYERS'] = gis['layer']
            if operation == 'GetFeatureInfo':
                if params.get('QUERY_LAYERS') != 'temperature' or params.get('INFO_FORMAT') != 'text/plain':
                    raise ValueError('unsupported identify')
                params['QUERY_LAYERS'] = gis['layer']
        elif operation == 'GetLegendGraphic':
            allowed |= {'LAYER', 'STYLE', 'FORMAT', 'TIME', 'WIDTH', 'HEIGHT', 'SLD_VERSION', 'TRANSPARENT'}
            if (params.get('LAYER') != 'temperature' or params.get('STYLE', '') not in ('', 'raster')
                    or params.get('FORMAT') != 'image/png'
                    or params.get('SLD_VERSION', '1.1.0') != '1.1.0'):
                raise ValueError('unsupported legend')
            for dimension in ('WIDTH', 'HEIGHT'):
                if dimension in params and not 1 <= int(params[dimension]) <= 256:
                    raise ValueError('legend dimensions outside 1..256')
            params['LAYER'] = gis['layer']
            params['STYLE'] = gis.get('style', 'raster')
        elif operation != 'GetCapabilities':
            raise ValueError('unsupported scoped operation')
        if set(params) - allowed:
            raise ValueError('unsupported WMS option')
        result = geoserver.wms(gis, params, seconds=max(0.05, min(20, g.deadline-time.time())))
        payload = result.content
        if operation == 'GetCapabilities':
            root = ET.fromstring(payload)
            scoped = links(manifest)['wms'] + '?'
            namespace = '{http://www.opengis.net/wms}'
            service = root.find(namespace+'Service')
            if service is not None:
                for name in ('MaxWidth', 'MaxHeight'):
                    node = service.find(namespace+name)
                    if node is None:
                        node = ET.SubElement(service, namespace+name)
                    node.text = str(map_limit)
            root.set('{http://www.w3.org/2001/XMLSchema-instance}schemaLocation',
                     'http://www.opengis.net/wms https://schemas.opengis.net/wms/1.3.0/capabilities_1_3_0.xsd')
            for parent in root.iter():
                for node in list(parent):
                    local = node.tag.split('}')[-1]
                    if (local == 'CRS' and node.text not in ('EPSG:4326','EPSG:3857')
                            or local == 'BoundingBox' and node.get('CRS') not in ('EPSG:4326','EPSG:3857')
                            or local == 'Post'):
                        parent.remove(node)
                if parent.tag == namespace+'Request':
                    for node in list(parent):
                        if node.tag.split('}')[-1] not in ('GetCapabilities','GetMap','GetFeatureInfo','GetLegendGraphic'):
                            parent.remove(node)
                if parent.tag in (namespace+'GetMap',namespace+'GetFeatureInfo',namespace+'GetLegendGraphic'):
                    expected = 'text/plain' if parent.tag == namespace+'GetFeatureInfo' else 'image/png'
                    for node in list(parent):
                        if node.tag == namespace+'Format' and node.text != expected:
                            parent.remove(node)
            for node in root.iter():
                if node.tag == namespace+'Dimension' and node.get('name') == 'time':
                    node.text = ','.join(sorted({item['valid_time'] for item in candidates}))
                    node.set('default', min(item['valid_time'] for item in candidates))
                    node.set('nearestValue', '0')
                for key in list(node.attrib):
                    if key.endswith('}href'):
                        node.set(key, scoped)
                if node.tag.endswith('}Name') and node.text and node.text.split(':')[-1] == gis['coverage']:
                    node.text = 'temperature'
                if node.tag == namespace+'Title' and node.text == gis['coverage']:
                    node.text = 'Температура поверхности, K'
            for node in root.findall('.//' + namespace + 'LegendURL/' + namespace + 'OnlineResource'):
                node.set('{http://www.w3.org/1999/xlink}href', scoped +
                         'SERVICE=WMS&VERSION=1.3.0&REQUEST=GetLegendGraphic&LAYER=temperature&STYLE=raster&FORMAT=image/png')
            payload = ET.tostring(root, encoding='utf-8', xml_declaration=True)
        response = Response(payload, content_type=result.headers.get('Content-Type', 'application/xml'))
        response.headers['Cache-Control'] = 'private, no-cache'
        response.set_etag(hashlib.sha256(json.dumps({'run': run_id, 'revision': revision,
            'field': manifest['identity']['field'], 'level': manifest['identity']['level'],
            'grid': manifest['identity']['native_grid_sha256'], 'member': manifest['identity']['member'],
            'wms_profile': 'qgis-512-v1', 'map_limit': map_limit,
            'renderer': 'geoserver-2.27.0', 'parameters': params}, sort_keys=True).encode()).hexdigest())
        return response

    return app
