"""Process-local bounded numeric tile cache; callers resolve eligibility first."""

from collections import OrderedDict
import os
import threading
import time
from collections import defaultdict

from publication.domain import ROOT, PublicationUnavailable
from publication.limited import WorkLimit


class TileCache:
    def __init__(self, *, cap: int = 256 * 1024**2):
        self.budget = int(os.environ.get('TILE_CACHE_BYTES', 16 * 1024**2))
        if not 0 <= self.budget <= 256 * 1024**2:
            raise ValueError('TILE_CACHE_BYTES must be in 0..268435456')
        self.budget = min(self.budget, cap)
        self.entries: OrderedDict[tuple, bytes] = OrderedDict()
        self.bytes = 0
        self.lock = threading.Lock()
        self.generator = threading.BoundedSemaphore(1)
        self.metrics: dict[str, float] = defaultdict(float)

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

    def snapshot(self) -> dict:
        with self.lock:
            return {**self.metrics, 'bytes': self.bytes, 'budget_bytes': self.budget,
                    'entries': len(self.entries)}

    def lookup(self, key: tuple, generate, *, metadata: bool = False, image: bool = False, seconds: float = 0) -> tuple[bytes, str]:
        started = time.monotonic()
        category = 'image' if image else 'metadata' if metadata else 'numeric'
        outcome = 'failure'
        transferred = 0
        try:
            payload, outcome = self._lookup(key, generate, metadata=metadata, image=image, seconds=seconds)
            transferred = len(payload)
            return payload, outcome
        finally:
            with self.lock:
                self.metrics[category + '_' + outcome] += 1
                self.metrics[category + '_bytes'] += transferred
                self.metrics[category + '_duration_ms'] += (time.monotonic()-started)*1000

    def _lookup(self, key: tuple, generate, *, metadata: bool = False, image: bool = False, seconds: float = 0) -> tuple[bytes, str]:
        with self.lock:
            if key in self.entries:
                self.entries.move_to_end(key)
                return self.entries[key], 'hit'
        if not self.generator.acquire(timeout=max(0, seconds)):
            raise WorkLimit(504 if seconds > 0 else 429)
        stage = 'generation'
        try:
            with self.lock:
                if key in self.entries:
                    self.entries.move_to_end(key)
                    return self.entries[key], 'hit'
            self.fault('generation')
            category = 'image' if image else 'metadata' if metadata else 'numeric'
            generation_started = time.monotonic()
            try:
                payload = generate()
            finally:
                with self.lock:
                    self.metrics[category + '_generation_attempts'] += 1
                    self.metrics[category + '_generation_duration_ms'] += (time.monotonic()-generation_started)*1000
            valid = payload.startswith(b'\x89PNG\r\n\x1a\n') if image else metadata or len(payload) == 258 * 258 * 5
            if not valid or len(payload) > 332820:
                raise PublicationUnavailable('invalid numeric tile size')
            stage = 'cache'
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
            with self.lock:
                self.metrics[stage + '_failure'] += 1
            raise PublicationUnavailable('numeric tile temporarily unavailable; retry same selection') from error
        finally:
            self.generator.release()
