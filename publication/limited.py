"""Killable wall-clock bounded HTTP and tile work; never pass client credentials."""

import base64
import json
import subprocess
import sys
from contextvars import ContextVar

import requests

request_deadline: ContextVar[float | None] = ContextVar('publication_request_deadline', default=None)


class WorkLimit(RuntimeError):
    def __init__(self, status: int, headers: dict | None = None):
        self.status = status
        self.headers = headers or {}


def run(operation: str, arguments: dict, seconds: float) -> dict:
    try:
        child = subprocess.run([sys.executable, '-m', 'publication.limited', operation],
                               input=json.dumps(arguments).encode(), capture_output=True, timeout=seconds)
    except subprocess.TimeoutExpired as error:
        raise WorkLimit(504) from error
    if child.returncode:
        raise WorkLimit(503)
    result = json.loads(child.stdout)
    if 'error' in result:
        raise WorkLimit(result['error'], result.get('headers'))
    result['body'] = base64.b64decode(result['body'])
    return result


def http_work(args: dict) -> dict:
    with requests.get(args['url'], params=args['params'], headers=args.get('headers', {}),
                      timeout=(3, args['seconds']), stream=True, allow_redirects=False) as response:
        headers = {k: v for k, v in response.headers.items() if k.lower() in (
            'content-type', 'cache-control', 'etag', 'retry-after', 'x-hmc-cache',
            'x-hmc-product', 'x-hmc-run', 'x-hmc-revision')}
        maximum = args['output']
        if int(response.headers.get('Content-Length', '0')) > maximum:
            raise WorkLimit(413, headers)
        payload = bytearray()
        for chunk in response.iter_content(16384):
            payload.extend(chunk)
            if len(payload) > maximum:
                raise WorkLimit(413, headers)
        return {'body': base64.b64encode(payload).decode(), 'status': response.status_code,
                'headers': headers}


def main() -> None:
    args = json.load(sys.stdin)
    result: dict
    try:
        if sys.argv[1] == 'tile':
            import os
            import time
            from pathlib import Path
            if os.environ.get('T6_TEST_FAULTS') == '1' and Path('/assets/.t9-tile-delay').exists():
                time.sleep(15)
            from publication.tiles import render, encode
            payload = encode(*render(Path(args['root']), args['item'], *args['coordinates']), args['encoding'])
            result = {'body': base64.b64encode(payload).decode()}
        else:
            result = http_work(args)
    except WorkLimit as error:
        result = {'error': error.status, 'headers': error.headers}
    except Exception:
        result = {'error': 503}
    print(json.dumps(result))


if __name__ == '__main__':
    main()
