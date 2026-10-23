"""Explicit public demo and organization profiles; policy precedes caches."""

import re
import json
import sys
import time
import uuid
import queue
from datetime import datetime, timezone

import pg8000.dbapi
import requests
from flask import Flask, Response, jsonify, request, g

from publication.access import identify
from publication import budgets
from publication import wms
from publication.limited import WorkLimit
from publication.process_channel import ProcessChannel

ROUTES = (
    re.compile(r'api/v1/(?:catalogue|point|modules|models|runs|revisions|openapi\.json)'),
    re.compile(r'ogc(?:/(?:conformance|collections(?:/[0-9a-f.]+(?:/position)?)?))?'),
    re.compile(r'api/v1/jobs/[0-9a-f-]{36}'),
    re.compile(r'api/v1/selections/[0-9a-f.]+/(?:tiles\.json|tiles/[23]/[0-9]+/[0-9]+/[0-9]+\.f32)'),
    re.compile(r'api/v1/selections/[0-9a-f.]+/display/[12]/(?:native\.json|native/[0-9]+/[0-9]+\.f32)'),
    re.compile(r'api/v1/selections/[0-9a-f.]+/display/1/experiment/(?:ortho|laea)\.f32'),
    re.compile(r'gis/v1/runs/[A-Za-z0-9_.:/-]+/revisions/[0-9a-f]+/wms'),
)
SECRET_PARAMETERS = {'key', 'api_key', 'apikey', 'token', 'access_token', 'authorization', 'x-api-key'}


def create_app() -> Flask:
    app = Flask('hmc-gateway', static_folder=None)
    channels: queue.Queue = queue.LifoQueue(maxsize=8)
    for _ in range(8):
        channels.put(ProcessChannel('publication.http_process', 4*1024**2))
    # Prepare code for the browser's two fetches; no field data is requested.
    startup = [channels.get(), channels.get()]
    for channel in startup:
        try:
            channel.run('initialize', {}, 5)
        except (WorkLimit, OSError):
            print(json.dumps({'http_worker': 'initialization-deferred'}), file=sys.stderr, flush=True)
        channels.put(channel)

    def forward_work(arguments, seconds):
        deadline = time.monotonic()+seconds
        try:
            channel = channels.get(timeout=seconds)
        except queue.Empty as error:
            raise WorkLimit(504) from error
        try:
            return channel.run('http', arguments, deadline-time.monotonic())
        finally:
            channels.put(channel)

    def failure(status: int):
        code, description = {
            400: ('InvalidParameterValue', 'Недопустимые параметры запроса.'),
            401: ('Unauthorized', 'Требуется действующий ключ организации.'),
            403: ('Forbidden', 'Профиль ключа не разрешает этот продукт.'),
            413: ('OutputLimit', 'Превышен допустимый размер ответа.'),
            429: ('TooManyRequests', 'Превышен бюджет запросов. Повторите позже.'),
            503: ('Unavailable', 'Сервис временно недоступен.'),
            504: ('DeadlineExceeded', 'Превышено допустимое время запроса.'),
        }[status]
        response = jsonify(code=code, description=description)
        response.status_code = status
        response.headers['Cache-Control'] = 'no-store'
        if status == 401:
            response.headers['WWW-Authenticate'] = 'Bearer realm="organization"'
        if status in (429, 503, 504):
            response.headers['Retry-After'] = '60' if status == 429 else '2'
        return response

    @app.before_request
    def observe():
        g.started = time.monotonic()
        protected = request.path.startswith('/org/')
        path = request.path[5:] if protected else request.path[1:]
        # Store categories, never client-supplied URLs/query strings.
        operation = ('tile-metadata' if path.endswith(('/tiles.json', '/native.json')) else 'tile' if '/tiles/2/' in path or '/display/1/native/' in path or '/display/1/experiment/' in path
                     else 'wms' if path.startswith('gis/') else 'point' if path == 'api/v1/point'
                     else 'position' if path.endswith('/position') else 'discovery' if path.startswith('ogc')
                     or path in ('api/v1/modules', 'api/v1/models', 'api/v1/runs', 'api/v1/revisions', 'api/v1/openapi.json')
                     else 'catalogue' if path == 'api/v1/catalogue' else 'job' if path.startswith('api/v1/jobs/') else 'unknown')
        g.event = {'request_id': str(uuid.uuid4()), 'observed_at': datetime.now(timezone.utc).isoformat(),
                   'organization': None, 'key_id': None,
                   'bucket': 'unidentified' if protected else 'public', 'operation': operation,
                   'product': None, 'run': None, 'revision': None, 'cache': 'not-accessed'}
        g.recorded = False

    def metrics(response):
        g.event.update(status=response.status_code, duration_ms=(time.monotonic()-g.started)*1000,
                       bytes=0 if request.method == 'HEAD' else len(response.get_data()))

    def backend_observation(headers):
        headers = {key.lower(): value for key, value in headers.items()}
        g.event.update(cache=headers.get('x-hmc-cache', 'unavailable'),
                       product=headers.get('x-hmc-product'), run=headers.get('x-hmc-run'), revision=headers.get('x-hmc-revision'))

    @app.after_request
    def cache_policy(response):
        response.headers.setdefault('Cache-Control', 'no-store')
        response.headers['X-Request-ID'] = g.event['request_id']
        if request.path.startswith('/org/'):
            response.vary.update(('Authorization', 'X-API-Key'))
        if request.path == '/health':
            return response
        try:
            if not g.recorded:
                budgets.begin(g.event, False)
            metrics(response)
            budgets.finish(g.event)
        except (pg8000.dbapi.Error, OSError, KeyError):
            if response.status_code < 400:
                response = failure(503)
                response.headers['X-Request-ID'] = g.event['request_id']
            metrics(response)
            g.event['durable_store'] = 'unavailable'
            print(json.dumps(g.event), file=sys.stderr, flush=True)
        return response

    @app.get('/<path:path>')
    def forward(path):
        protected = path.startswith('org/')
        upstream_path = path[4:] if protected else path
        if not (any(route.fullmatch(upstream_path) for route in ROUTES)
                or not protected and upstream_path == 'health'):
            return Response(status=404)
        if any(name.lower() in SECRET_PARAMETERS for name in request.args):
            return failure(400)
        authorization = request.headers.get('Authorization', '')
        api_key = request.headers.get('X-API-Key', '')
        if protected:
            if authorization and api_key:
                return failure(401)
            token = api_key
            if authorization:
                scheme, separator, token = authorization.partition(' ')
                if scheme.lower() != 'bearer' or not separator:
                    return failure(401)
            if not token:
                return failure(401)
            try:
                status, identity = identify(token, 'api' if upstream_path.split('/', 1)[0] == 'ogc'
                                            else upstream_path.split('/', 1)[0])
            except (pg8000.dbapi.Error, OSError, KeyError):
                return failure(503)
            if identity is not None:
                g.event.update(organization=identity['organization'], key_id=str(identity['id']),
                               bucket='org:' + identity['organization'])
            if status != 200:
                return failure(status)
        elif authorization or api_key:
            return failure(400)
        try:
            if upstream_path != 'health':
                allowed, limits = budgets.begin(g.event, True)
                g.recorded = True
                if not allowed:
                    return failure(429)
            else:
                limits = budgets.Limits()
            if '/tiles/2/' in upstream_path or '/tiles/3/' in upstream_path:
                z, x, y = (int(part.removesuffix('.f32')) for part in upstream_path.rsplit('/', 3)[-3:])
                if not (0 <= z <= limits.zoom and 0 <= x < 2**z and 0 <= y < 2**z):
                    return failure(400)
            if upstream_path.startswith('gis/'):
                params = {name.upper(): value for name, value in request.args.items()}
                wms.check_dimensions(params, limits.dimension)
            # Never forward credentials or trust client prefix/identity headers.
            g.event['cache'] = 'unavailable'
            upstream = forward_work({'url': 'http://api:8000/' + upstream_path,
                                   'params': list(request.args.items(multi=True)),
                                   'headers': {'X-Publication-Prefix': '/org' if protected else '',
                                               'X-HMC-Request-ID': g.event['request_id'],
                                               'X-HMC-WMS-Dimension': str(min(wms.MAX_MAP_SIZE, limits.dimension)),
                                               'X-HMC-Deadline': str(time.time() + limits.seconds - 0.25)},
                                   'seconds': limits.seconds, 'output': limits.output}, limits.seconds)
        except WorkLimit as error:
            backend_observation(error.headers)
            return failure(error.status)
        except ValueError:
            return failure(400)
        except (requests.RequestException, pg8000.dbapi.Error, OSError, KeyError):
            return failure(503)
        headers = {key.lower(): value for key, value in upstream['headers'].items()}
        backend_observation(headers)
        return Response(upstream['body'], status=upstream['status'],
                        headers={key: value for key, value in headers.items()
                                 if key.lower() in ('content-type', 'cache-control', 'etag', 'retry-after')})

    return app
