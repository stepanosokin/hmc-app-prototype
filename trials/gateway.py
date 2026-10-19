"""Isolated shared gateway for adapter trials; never a production key service."""

import hashlib
import json
import secrets
import threading
import time
from collections import deque
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from flask import Flask, Response, g, jsonify, request

from trials import ROOT
from trials.metrics import snapshot


def create_app() -> Flask:
    app = Flask('trial-gateway')
    lock = threading.Lock()
    buckets: dict[tuple[str, int], int] = {}
    cache: dict[str, tuple[float, bytes, str]] = {}
    usage: deque = deque(maxlen=2048)

    @app.before_request
    def begin():
        g.started, g.request_id = time.perf_counter(), secrets.token_hex(8)
        g.organization, g.cache = None, 'BYPASS'

    @app.after_request
    def account(response):
        if request.path not in {'/health', '/usage', '/metrics'}:
            row = {'request_id': g.request_id, 'organization': g.organization,
                   'operation': request.path, 'run': request.args.get('run'),
                   'revision': request.args.get('revision'), 'timestamp': datetime.now(timezone.utc).isoformat(),
                   'status': response.status_code, 'bytes': response.calculate_content_length(),
                   'duration_ms': (time.perf_counter() - g.started) * 1000, 'cache': g.cache}
            with lock:
                usage.append(row)
        response.headers['X-Request-ID'] = g.request_id
        response.headers['X-Cache'] = g.cache
        return response

    @app.get('/health')
    def health():
        return jsonify(status='ready')

    @app.get('/metrics')
    def metrics():
        return jsonify(snapshot())

    @app.get('/usage')
    def records():
        control = json.loads((ROOT / 'secrets.json').read_text())['control']
        if not secrets.compare_digest(request.headers.get('X-Trial-Control', ''), control):
            return jsonify(code='Forbidden'), 403
        with lock:
            return jsonify(requests=list(usage), retention='latest 2048 trial requests; not durable production accounting')

    @app.get('/<candidate>/<path:path>')
    def proxy(candidate, path):
        digest = hashlib.sha256(request.headers.get('X-API-Key', '').encode()).hexdigest()
        policy = json.loads((ROOT / 'policy.json').read_text())
        key = policy['keys'].get(digest)
        if key is None:
            return jsonify(code='Unauthorized'), 401
        g.organization = key['organization']
        if not key['enabled']:
            return jsonify(code='Forbidden'), 403
        minute = int(time.monotonic() // 60)
        with lock:
            for bucket in list(buckets):
                if bucket[1] != minute:
                    del buckets[bucket]
            bucket = (key['organization'], minute)
            count = buckets.get(bucket, 0)
            if count >= key['limit_per_minute']:
                return jsonify(code='TooManyRequests'), 429
            buckets[bucket] = count + 1
        if candidate not in {'narrow', 'pygeoapi'} or path not in {
                'api/v1/point', 'ogc/collections', 'ogc/collections/surface-temperature',
                'ogc/collections/surface-temperature/position'}:
            return jsonify(code='NotFound'), 404
        if len(request.query_string) > 4096:
            return jsonify(code='InvalidParameterValue'), 400
        cache_key = request.full_path
        use_cache = request.headers.get('X-Trial-Cache') == 'on'
        if use_cache:
            # Invalid input can preserve different previous accepted states.
            # Use the backend's accepted generation, never raw input identity.
            try:
                with urlopen(f'http://{candidate}:8000/generation', timeout=10) as generation_response:
                    state = json.loads(generation_response.read(4096))
            except (URLError, TimeoutError, ValueError):
                return jsonify(code='ServiceUnavailable'), 503
            use_cache = state['refresh_error'] is None
            if use_cache:
                cache_key = state['generation'] + ':' + cache_key
                with lock:
                    hit = cache.get(cache_key)
                if hit and time.monotonic() - hit[0] < 60:
                    g.cache = 'HIT'
                    return Response(hit[1], content_type=hit[2])
                g.cache = 'MISS'
        upstream = Request(f'http://{candidate}:8000/{path}?{request.query_string.decode()}',
                           headers={'Accept': 'application/json'})
        try:
            response = urlopen(upstream, timeout=10)
        except HTTPError as error:
            response = error
        except (URLError, TimeoutError):
            return jsonify(code='ServiceUnavailable'), 503
        with response:
            body = response.read(65537)
            if len(body) > 65536:
                return jsonify(code='ServiceUnavailable', description='bounded response exceeded'), 503
            content_type = response.headers.get('Content-Type', 'application/json')
            if use_cache and response.status == 200:
                with lock:
                    if len(cache) >= 128:
                        cache.pop(next(iter(cache)))
                    cache[cache_key] = (time.monotonic(), body, content_type)
            return Response(body, status=response.status, content_type=content_type)

    return app
