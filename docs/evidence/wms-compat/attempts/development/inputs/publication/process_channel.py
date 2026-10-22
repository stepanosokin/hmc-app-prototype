"""Serialized bounded process channel; timeout kills work before releasing its slot."""

import atexit
import base64
import json
import queue
import subprocess
import sys
import threading
import time

from publication.limited import WorkLimit
class ProcessChannel:
    def __init__(self, module: str, maximum: int):
        self.module = module
        self.maximum = maximum
        self.reply_limit = (maximum+2)//3*4 + 65536
        self.child: subprocess.Popen | None = None
        self.lock = threading.Lock()
        atexit.register(self.close)

    def close(self):
        child, self.child = self.child, None
        if child is not None:
            if child.poll() is None:
                child.kill()
            child.wait()
            if child.stdin:
                child.stdin.close()
            if child.stdout:
                child.stdout.close()

    def run(self, operation: str, arguments: dict, seconds: float) -> dict:
        if seconds <= 0:
            raise WorkLimit(504)
        deadline = time.monotonic()+seconds
        if not self.lock.acquire(timeout=seconds):
            raise WorkLimit(504)
        try:
            remaining = deadline-time.monotonic()
            if remaining <= 0:
                raise WorkLimit(504)
            if self.child is None:
                self.child = subprocess.Popen([sys.executable, '-m', self.module],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            child = self.child
            assert child.stdin is not None and child.stdout is not None
            answers: queue.Queue = queue.Queue(maxsize=1)
            def communicate():
                try:
                    assert child.stdin is not None and child.stdout is not None
                    child.stdin.write(json.dumps({'operation': operation, **arguments}).encode() + b'\n')
                    child.stdin.flush()
                    reply = child.stdout.readline(self.reply_limit+1)
                    if len(reply) > self.reply_limit or not reply.endswith(b'\n'):
                        raise OSError('process reply length')
                    answers.put(json.loads(reply))
                except Exception:
                    answers.put({'error': 503})
            exchange = threading.Thread(target=communicate, daemon=True)
            exchange.start()
            try:
                result = answers.get(timeout=max(0, deadline-time.monotonic()))
            except queue.Empty as error:
                self.close()
                exchange.join()
                raise WorkLimit(504) from error
            exchange.join()
            if 'error' in result:
                if result['error'] >= 500:
                    self.close()
                raise WorkLimit(result['error'], result.get('headers'))
            try:
                payload = base64.b64decode(result['body'], validate=True)
            except (KeyError, TypeError, ValueError) as error:
                self.close()
                raise WorkLimit(503) from error
            if len(payload) > self.maximum:
                self.close()
                raise WorkLimit(503)
            result['body'] = payload
            return result
        finally:
            self.lock.release()


