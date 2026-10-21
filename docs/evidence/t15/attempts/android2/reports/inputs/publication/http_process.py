"""Reusable credential-free gateway HTTP executor; channel enforces wall time."""

import json
import sys

from publication.limited import http_work, WorkLimit


def main():
    for line in sys.stdin.buffer:
        result: dict
        try:
            args = json.loads(line)
            result = {'body': ''} if args.get('operation') == 'initialize' else http_work(args)
        except WorkLimit as error:
            result = {'error': error.status, 'headers': error.headers}
        except Exception:
            result = {'error': 503}
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
