"""Seed two actual-source deliveries for the isolated withdrawal browser gate."""
import shutil
import uuid
from pathlib import Path

from decoder.sampling import file_hash
from publication import recovery, worker
from publication.domain import database


def main():
    for name, hours in [('a.grib2', [1]), ('b.grib2', [3])]:
        target = Path('/evidence/fixtures') / name
        shutil.copyfile('/evidence/sample.grib2', target)
        identifier = recovery.submit('2026-10-19T05:00:00Z',
            {'hours': hours, 'fixture': 'actual', 'recoverable': True, 'batch': uuid.uuid4().hex},
            name, file_hash(target), 0)
        if not worker.once(identifier):
            raise RuntimeError('Изолированный worker занят')
        with database() as cursor:
            cursor.execute('SELECT state,error FROM app.jobs WHERE id=%s', (identifier,))
            row = cursor.fetchone()
        if row['state'] != 'published':
            raise RuntimeError(str(row))


if __name__ == '__main__':
    main()
