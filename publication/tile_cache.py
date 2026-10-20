"""Process-local bounded numeric tile cache; callers resolve eligibility first."""

from collections import OrderedDict
import os
import threading

from publication.domain import ROOT, PublicationUnavailable
from publication.limited import WorkLimit


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

    def expire(self, roots: set[str]) -> None:
        """Discard denied selections before cache lookup, including warm hits."""
        with self.lock:
            for key in list(self.entries):
                if key[0].split('.', 1)[0] in roots:
                    self.bytes -= len(self.entries.pop(key))

    def get(self, key: tuple, generate) -> bytes:
        return self.lookup(key, generate)[0]

    def lookup(self, key: tuple, generate, *, metadata: bool = False) -> tuple[bytes, str]:
        with self.lock:
            if key in self.entries:
                self.entries.move_to_end(key)
                return self.entries[key], 'hit'
        if not self.generator.acquire(blocking=False):
            raise WorkLimit(429)
        try:
            self.fault('generation')
            payload = generate()
            if (not metadata and len(payload) != 258 * 258 * 5) or len(payload) > 332820:
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
            return payload, 'miss'
        except WorkLimit:
            raise
        except (OSError, RuntimeError) as error:
            raise PublicationUnavailable('numeric tile temporarily unavailable; retry same selection') from error
        finally:
            self.generator.release()
