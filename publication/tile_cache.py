"""Process-local bounded numeric tile cache; callers resolve eligibility first."""

from collections import OrderedDict
import os
import threading

from publication.domain import ROOT, PublicationUnavailable


class TileCache:
    def __init__(self):
        self.budget = int(os.environ.get('TILE_CACHE_BYTES', 16 * 1024**2))
        if not 0 <= self.budget <= 256 * 1024**2:
            raise ValueError('TILE_CACHE_BYTES must be in 0..268435456')
        self.entries: OrderedDict[tuple, bytes] = OrderedDict()
        self.bytes = 0
        self.lock = threading.Lock()
        self.generator = threading.BoundedSemaphore(1)

    def fault(self, stage: str) -> None:
        # Available only in the explicitly isolated recovery acceptance stack.
        if os.environ.get('T6_TEST_FAULTS') == '1' and (ROOT / ('.t6-' + stage)).exists():
            raise OSError('explicit T6 ' + stage + ' interruption')

    def get(self, key: tuple, generate) -> bytes:
        with self.lock:
            if key in self.entries:
                self.entries.move_to_end(key)
                return self.entries[key]
        if not self.generator.acquire(blocking=False):
            raise PublicationUnavailable('numeric generator busy; retry same selection')
        try:
            self.fault('generation')
            payload = generate()
            if len(payload) != 258 * 258 * 5:
                raise PublicationUnavailable('invalid numeric tile size')
            self.fault('cache')
            # Population is atomic: no partial payload enters the cache.
            with self.lock:
                if len(payload) <= self.budget:
                    while self.bytes + len(payload) > self.budget:
                        _, evicted = self.entries.popitem(last=False)
                        self.bytes -= len(evicted)
                    previous = self.entries.pop(key, None)
                    if previous is not None:
                        self.bytes -= len(previous)
                    self.entries[key] = payload
                    self.bytes += len(payload)
            return payload
        except (OSError, RuntimeError) as error:
            raise PublicationUnavailable('numeric tile temporarily unavailable; retry same selection') from error
        finally:
            self.generator.release()
