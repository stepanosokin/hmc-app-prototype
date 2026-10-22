"""Thread-owned, short-lived reader connections; never cache policy decisions.

Only API/gateway roles participate. Worker sessions intentionally retain their
close-after-transaction behavior because they also own session advisory locks.
"""
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import pg8000.dbapi


@dataclass
class Session:
    connection: Any
    identity: tuple = field(repr=False)
    opened: float


_local = threading.local()


def discard(session: Session) -> None:
    try:
        session.connection.close()
    except Exception:
        # The failed socket is never returned to another transaction.
        pass


def close_idle() -> None:
    idle = getattr(_local, 'idle', [])
    while idle:
        discard(idle.pop())


if hasattr(os, 'register_at_fork'):
    os.register_at_fork(before=close_idle)


def acquire(seconds: float) -> Session:
    identity = (os.getpid(), os.environ['DB_USER'], os.environ['DB_PASSWORD'], seconds)
    # Keep each driver's exact socket timeout, including two-second accounting.
    # Dynamic short deadlines and workers retain close-after-transaction behavior.
    eligible = identity[1] in ('hmc_api', 'hmc_gateway') and seconds in (2, 5)
    idle = getattr(_local, 'idle', [])
    selected = None
    for session in list(idle):
        if session.identity[:3] != identity[:3] or time.monotonic() - session.opened >= 60:
            idle.remove(session)
            discard(session)
        elif eligible and selected is None and session.identity == identity:
            idle.remove(session)
            selected = session
    if selected is not None:
        return selected
    connection = pg8000.dbapi.connect(host='db', database='hmc', user=identity[1],
                                     password=identity[2], timeout=seconds, ssl_context=False)
    return Session(connection, identity if eligible else (), time.monotonic())


def release(session: Session, healthy: bool) -> None:
    idle = getattr(_local, 'idle', None)
    if idle is None:
        idle = _local.idle = []
    if (healthy and session.identity and session.identity[0] == os.getpid()
            and len(idle) < 3 and time.monotonic() - session.opened < 60):
        idle.append(session)
    else:
        discard(session)
