"""Explicit public demo and organization profiles; policy precedes caches."""

import re

import pg8000.dbapi
import requests
from flask import Flask, Response, jsonify, request

from publication.access import authorize

ROUTES = (
    re.compile(r'api/v1/(?:catalogue|point)'),
    re.compile(r'api/v1/jobs/[0-9a-f-]{36}'),
    re.compile(r'api/v1/selections/[0-9a-f.]+/(?:tiles\.json|tiles/2/[0-9]+/[0-9]+/[0-9]+\.f32)'),
    re.compile(r'gis/v1/runs/[A-Za-z0-9_.:/-]+/revisions/[0-9a-f]+/wms'),
)
SECRET_PARAMETERS = {'key', 'api_key', 'apikey', 'token', 'access_token', 'authorization', 'x-api-key'}


def create_app() -> Flask:
    app = Flask('hmc-gateway', static_folder=None)

    def failure(status: int):
        code, description = {
            400: ('InvalidParameterValue', 'Передавайте ключ только заголовком в защищённом профиле.'),
            401: ('Unauthorized', 'Требуется действующий ключ организации.'),
            403: ('Forbidden', 'Профиль ключа не разрешает этот продукт.'),
            503: ('Unavailable', 'Сервис временно недоступен.'),
        }[status]
        response = jsonify(code=code, description=description)
        response.status_code = status
        response.headers['Cache-Control'] = 'no-store'
        if status == 401:
            response.headers['WWW-Authenticate'] = 'Bearer realm="organization"'
        if status == 503:
            response.headers['Retry-After'] = '2'
        return response

    @app.after_request
    def cache_policy(response):
        response.headers.setdefault('Cache-Control', 'no-store')
        if request.path.startswith('/org/'):
            response.vary.update(('Authorization', 'X-API-Key'))
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
                status = authorize(token, upstream_path.split('/', 1)[0])
            except (pg8000.dbapi.Error, OSError, KeyError):
                return failure(503)
            if status != 200:
                return failure(status)
        elif authorization or api_key:
            return failure(400)
        try:
            # Never forward credentials or trust client prefix/identity headers.
            upstream = requests.get('http://api:8000/' + upstream_path, params=list(request.args.items(multi=True)),
                                    headers={'X-Publication-Prefix': '/org' if protected else ''},
                                    timeout=90, allow_redirects=False)
        except requests.RequestException:
            return failure(503)
        return Response(upstream.content, status=upstream.status_code,
                        headers={key: value for key, value in upstream.headers.items()
                                 if key.lower() in ('content-type', 'cache-control', 'etag', 'retry-after')})

    return app
