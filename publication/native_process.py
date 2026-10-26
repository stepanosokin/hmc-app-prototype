"""Native reader retains verified immutable samplers within a bounded channel."""

import base64
import json
import sys


def main():
    from pathlib import Path
    import os
    import time
    from publication import native_display
    from publication.domain import resolve, database_transaction
    from publication.retention import ExpiredSelection
    from publication.limited import request_deadline
    for line in sys.stdin.buffer:
        result: dict
        try:
            args = json.loads(line)
            request_deadline.set(args.get('deadline'))
            if os.environ.get('T6_TEST_FAULTS') == '1' and Path('/assets/.t23a-source-delay').exists():
                time.sleep(15)
            if args['operation'] == 'native-initialize':
                payload = b''
            elif args['operation'] == 'native-resolve':
                with database_transaction():
                    payload = json.dumps(resolve(args['selection'])).encode()
            elif args['operation'] == 'native-source':
                root, item = native_display.source(args['manifest'])
                payload = json.dumps({'root': str(root), 'item': item}).encode()
            elif args['operation'] == 'native-metadata':
                payload = native_display.metadata(Path(args['root']), args['item'])
            elif args['operation'] == 'native-experiment':
                from publication.display_experiment import render
                payload = render(Path(args['root']), args['item'], args['mode'])
            elif args['operation']=='native-portrayal':
                payload=native_display.portrayal(Path(args['root']),args['item'],*args['coordinates'])
            else:
                payload = native_display.render(Path(args['root']), args['item'], *args['coordinates'])
            result = {'body': base64.b64encode(payload).decode()}
        except ExpiredSelection:
            result = {'error': 410}
        except KeyError:
            result = {'error': 404 if args.get('operation') == 'native-resolve' else 503}
        except Exception:
            result = {'error': 503}
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
