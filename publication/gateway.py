"""Only the explicit public API/GIS paths reach internal services."""

import requests
from flask import Flask, Response, request


def create_app() -> Flask:
    app = Flask('hmc-gateway')

    @app.get('/<path:path>')
    def forward(path):
        if not (path in ('api/v1/catalogue', 'health') or path.startswith(('api/v1/point', 'api/v1/jobs/',
                     'api/v1/selections/', 'gis/v1/runs/'))):
            return Response(status=404)
        try:
            upstream = requests.get('http://api:8000/' + path, params=list(request.args.items(multi=True)),
                                    timeout=90, allow_redirects=False)
        except requests.RequestException:
            return Response('upstream unavailable', status=503)
        return Response(upstream.content, status=upstream.status_code,
                        headers={key: value for key, value in upstream.headers.items()
                                 if key.lower() in ('content-type', 'cache-control', 'etag', 'retry-after')})

    return app
