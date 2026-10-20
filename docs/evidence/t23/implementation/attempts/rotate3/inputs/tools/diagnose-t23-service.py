"""Diagnostic-only actual native service probe, executed inside isolated Compose.

No credentials or response bodies are emitted. Not an acceptance runner.
"""
import cProfile
import concurrent.futures
import json
import pstats
import sys
import time
from pathlib import Path


def timed(action):
    start = time.perf_counter()
    value = action()
    return value, (time.perf_counter() - start) * 1000


def main():
    mode = sys.argv[1]
    selection = (sys.argv[2] if len(sys.argv) > 2 else
                 json.loads(Path('/evidence/native-reference.json').read_text())['selection']['selection'])
    prefix = f'/api/v1/selections/{selection}/display/1'
    output = {'scope': 'diagnosis only; fresh actual source, OS cache not reset', 'mode': mode}
    profile = cProfile.Profile()
    if mode == 'http':
        import requests
        def get(path):
            response, duration = timed(lambda: requests.get('http://gateway:8000' + path, timeout=30))
            response.raise_for_status()
            return {'ms': duration, 'bytes': len(response.content)}
        sequences = []
        for _ in range(2):
            start = time.perf_counter()
            metadata = get(prefix + '/native.json')
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                blocks = list(pool.map(get, [prefix + f'/native/{i % 6}/{i // 6}.f32' for i in range(18)]))
            sequences.append({'metadata': metadata, 'blocks': blocks,
                              'total_ms': (time.perf_counter() - start) * 1000})
        output['sequences'] = sequences
        output['within_3000ms'] = all(s['total_ms'] <= 3000 for s in sequences)
    elif mode in ('api', 'gateway'):
        if mode == 'api':
            from publication import api
        else:
            from publication import gateway as api
        from publication.process_channel import ProcessChannel
        import pg8000.dbapi
        channel_calls = []
        connections = []
        original_run = ProcessChannel.run
        original_connect = pg8000.dbapi.connect
        def channel_run(self, operation, arguments, seconds):
            value, duration = timed(lambda: original_run(self, operation, arguments, seconds))
            channel_calls.append({'operation': operation, 'ms': duration})
            return value
        def connect(*args, **kwargs):
            value, duration = timed(lambda: original_connect(*args, **kwargs))
            connections.append(duration)
            return value
        ProcessChannel.run = channel_run
        pg8000.dbapi.connect = connect
        app = api.create_app()
        channel_calls.clear()
        def work():
            runs = []
            with app.test_client() as client:
                for _ in range(2):
                    start = time.perf_counter()
                    request_ms = []
                    for path in [prefix + '/native.json'] + [prefix + f'/native/{i % 6}/{i // 6}.f32' for i in range(18)]:
                        response, duration = timed(lambda: client.get(path))
                        if response.status_code != 200:
                            raise RuntimeError(f'API diagnostic status {response.status_code}')
                        request_ms.append(duration)
                    runs.append({'total_ms': (time.perf_counter() - start) * 1000, 'request_ms': request_ms})
            return runs
        output['runs'] = profile.runcall(work)
        output['channel_calls'] = channel_calls
        output['connections_ms'] = connections
        stats = pstats.Stats(profile)
        output['profile'] = [{'file': Path(key[0]).name, 'line': key[1], 'function': key[2],
                              'calls': value[1], 'own_ms': value[2] * 1000,
                              'cumulative_ms': value[3] * 1000}
                             for key, value in sorted(stats.stats.items(), key=lambda p: p[1][3], reverse=True)[:60]]
    else:
        # This profile includes the real native reader functions, without IPC.
        from publication.domain import resolve, database_transaction
        from publication import native_display
        def work():
            runs = []
            for _ in range(2):
                def resolve_once():
                    with database_transaction():
                        return resolve(selection)
                manifest, resolve_ms = timed(resolve_once)
                (root, item), source_ms = timed(lambda: native_display.source(manifest))
                _, metadata_ms = timed(lambda: native_display.metadata(root, item))
                _, blocks_ms = timed(lambda: [native_display.render(root, item, i % 6, i // 6) for i in range(18)])
                runs.append(dict(resolve_ms=resolve_ms, source_ms=source_ms,
                                 metadata_ms=metadata_ms, blocks_ms=blocks_ms))
            return runs
        output['runs'] = profile.runcall(work)
        stats = pstats.Stats(profile)
        output['profile'] = [{'file': Path(key[0]).name, 'line': key[1], 'function': key[2],
                              'calls': value[1], 'own_ms': value[2] * 1000,
                              'cumulative_ms': value[3] * 1000}
                             for key, value in sorted(stats.stats.items(), key=lambda p: p[1][3], reverse=True)[:35]]
    print(json.dumps(output, indent=2))


if __name__ == '__main__':
    main()
