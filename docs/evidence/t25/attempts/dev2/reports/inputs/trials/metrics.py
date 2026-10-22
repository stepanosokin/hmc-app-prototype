"""Read-only Linux container telemetry; cgroup totals are not worker RSS."""

from pathlib import Path
import time

STARTED = time.monotonic()


def snapshot() -> dict:
    root = Path('/sys/fs/cgroup')
    cpu = {key: int(value) for key, value in
           (line.split() for line in (root / 'cpu.stat').read_text().splitlines())}
    io: dict[str, int] = {}
    for line in (root / 'io.stat').read_text().splitlines():
        for item in line.split()[1:]:
            key, value = item.split('=')
            io[key] = io.get(key, 0) + int(value)
    status = Path('/proc/self/status').read_text().splitlines()
    rss = next(int(line.split()[1]) * 1024 for line in status if line.startswith('VmRSS:'))
    process_io = {key.rstrip(':'): int(value) for key, value in
                  (line.split() for line in Path('/proc/self/io').read_text().splitlines())}
    return {'worker_rss_bytes': rss, 'cgroup_memory_bytes': int((root / 'memory.current').read_text()),
            'cpu_max': (root / 'cpu.max').read_text().strip(),
            'memory_limit_bytes': int((root / 'memory.max').read_text()),
            'cgroup_memory_peak_bytes': int((root / 'memory.peak').read_text()),
            'cgroup_cpu': cpu, 'cgroup_io': io, 'uptime_seconds': time.monotonic() - STARTED,
            'cgroup_io_status': 'available' if io else 'unavailable: empty io.stat on this Docker/WSL2 host',
            'worker_io': process_io,
            'scope': 'whole container CPU/memory; current HTTP worker RSS and /proc/self/io; rchar includes logical reads, read_bytes block I/O can be zero with cached pages; empty cgroup I/O is unavailable, not zero'}
