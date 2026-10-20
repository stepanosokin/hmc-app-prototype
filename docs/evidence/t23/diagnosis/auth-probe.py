"""Isolated DB-auth timing; reads credentials only from container environment."""
import cProfile
import hashlib
import importlib.metadata
import inspect
import json
import os
import time
import pg8000.dbapi
import scramp.utils


def connect():
    start = time.perf_counter()
    connection = pg8000.dbapi.connect(host='db', database='hmc', user=os.environ['DB_USER'],
                                    password=os.environ['DB_PASSWORD'], ssl_context=False)
    duration = (time.perf_counter() - start) * 1000
    connection.close()
    return duration


for attempt in range(60):
    try:
        connect()
        break
    except Exception:
        if attempt == 59:
            raise RuntimeError('Database not ready') from None
        time.sleep(.5)

plain = [connect() for _ in range(20)]
profiler = cProfile.Profile()
profiled = profiler.runcall(lambda: [connect() for _ in range(20)])
source = inspect.getsource(scramp.utils.hi)
print(json.dumps({'scope': 'isolated actual DB connection timing; not browser acceptance',
                  'pg8000': importlib.metadata.version('pg8000'),
                  'scramp': importlib.metadata.version('scramp'),
                  'unprofiled_ms': plain, 'profiled_ms': profiled,
                  'scramp_hi_source': source,
                  'scramp_hi_sha256': hashlib.sha256(source.encode()).hexdigest()}, indent=2))
