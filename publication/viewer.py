"""Russian viewer assets and a bounded, public-only same-origin gateway bridge."""

import re
from pathlib import Path

import requests
from flask import Flask, Response, request, send_from_directory


def create_app() -> Flask:
    app = Flask('hmc-viewer', static_folder=None)
    source, runtime = Path('/viewer'), Path('/viewer-runtime')
    routes = (
        re.compile(r'api/v1/(?:catalogue|point)'),
        re.compile(r'ogc/collections/[0-9a-f.]+'),
        re.compile(r'gis/v1/runs/[A-Za-z0-9_.:/-]+/revisions/[0-9a-f]+/wms'),
        re.compile(r'api/v1/selections/[0-9a-f.]+/display/[12]/(?:native\.json|native/[0-9]+/[0-9]+\.f32)'),
    )

    @app.after_request
    def headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        return response

    @app.get('/')
    def index():
        return send_from_directory(source, 'index.html')

    @app.get('/<path:path>')
    def asset_or_public(path):
        if path == '__start':
            return Response('<!doctype html><html lang="ru"><meta charset="utf-8">'
                '<meta name="viewport" content="width=device-width,initial-scale=1">Подготовка проверки…</html>',
                content_type='text/html; charset=utf-8')
        if any(route.fullmatch(path) for route in routes):
            try:
                # Never forward browser credentials or choose a client-supplied host.
                with requests.get('http://gateway:8000/' + path, params=list(request.args.items(multi=True)),
                                  timeout=(2, 35), stream=True, allow_redirects=False) as upstream:
                    chunks, size = [], 0
                    for chunk in upstream.iter_content(65536):
                        size += len(chunk)
                        if size > 4 * 1024**2:
                            return Response('Ответ сервиса превышает допустимый размер.', status=502)
                        chunks.append(chunk)
                    response = Response(b''.join(chunks), status=upstream.status_code,
                        content_type=upstream.headers.get('Content-Type', 'application/octet-stream'))
                    for name in ('X-Request-ID', 'Retry-After', 'X-HMC-Cache'):
                        if name in upstream.headers:
                            response.headers[name] = upstream.headers[name]
                    return response
            except requests.RequestException:
                return Response('Сервис прогнозов временно недоступен.', status=503)
        if path in ('style.css', 'worker-projection.mjs'):
            return send_from_directory(source, path)
        if path in ('land.js', 'native-display.v1.json') or path.startswith(('vendor/', 'build/')):
            return send_from_directory(runtime, path)
        return Response('Страница не найдена.', status=404)

    return app
