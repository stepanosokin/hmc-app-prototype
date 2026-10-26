"""Withdrawal plans and the actual publication/HTTP boundary on an isolated stand."""
import copy
import json
import os
import unittest
import uuid
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import requests

from publication import grib_sync, recovery, retention, revisions, worker
from publication.domain import database, database_transaction, load_manifest, resolve
from decoder.sampling import file_hash


class PlanBoundaries(unittest.TestCase):
    def test_name_only_empty_renamed_and_unknown_provenance(self):
        rows = [dict(root='mixed', run='run', state='eligible', kind='revision',
                     manifest_path='mixed.json', manifest_sha256='sha', job_id='job'),
                dict(root='legacy', run='run', state='eligible', kind='legacy',
                     manifest_path='legacy.json', manifest_sha256='sha', job_id='job'),
                dict(root='unknown', run='run', state='eligible', kind='legacy',
                     manifest_path='unknown.json', manifest_sha256='sha', job_id='job')]
        entries = [dict(key='a'), dict(key='b')]
        def legacy(path, checksum):
            return {'source': {'name': 'a.grib2', **({'directory':'data/grib'} if path == 'legacy.json' else {})}}
        with patch.object(revisions, 'load_revision', return_value={'batches': entries}), \
             patch.dict(os.environ, {'GRIB_SOURCE_DIRECTORY':'data/grib'}), \
             patch.object(revisions, 'selected', side_effect=lambda manifest, entry: {'source': {'name': entry['key']+'.grib2','directory':'data/grib'}}), \
             patch.object(grib_sync, 'load_manifest', side_effect=legacy):
            kept = grib_sync.plan_rows(['b.grib2'], rows, 'stand', {})
            self.assertEqual([a['root'] for a in kept['actions']], ['mixed', 'legacy'])
            self.assertEqual(kept['actions'][0]['keep'], [entries[1]])
            self.assertEqual(kept['unchecked'][0]['root'], 'unknown')
            self.assertFalse(grib_sync.plan_rows(['a.grib2', 'b.grib2'], rows, 'stand', {})['actions'])
            empty = grib_sync.plan_rows([], rows, 'stand', {})
            self.assertTrue(all(not a['keep'] for a in empty['actions']))
            renamed = grib_sync.plan_rows(['new-name.grib2', 'b.grib2'], rows, 'stand', {})
            self.assertEqual(renamed['actions'], kept['actions'])
            for changed in (renamed, empty, {**kept, 'target': 'other'}, {**kept, 'actions': []}):
                with self.assertRaises(ValueError):
                    grib_sync.validate_plan(kept, changed)

    def test_folder_errors_are_not_an_empty_inventory(self):
        with self.assertRaises(ValueError):
            grib_sync.input_names(Path('/this-folder-does-not-exist'))

    def test_submission_freezes_source_directory_before_worker_environment_changes(self):
        with patch.dict(os.environ, {'GRIB_SOURCE_DIRECTORY':'./data/grib'}), \
             patch.object(recovery, 'capture', return_value='job') as capture:
            recovery.submit('2026-10-19T05:00:00Z', {'crs_configuration':{}}, 'a.grib2', None, 1)
        request = capture.call_args.args[1]
        with patch.dict(os.environ, {'GRIB_SOURCE_DIRECTORY':'other'}):
            self.assertEqual(request['source_directory'], 'data/grib')


@unittest.skipUnless(os.environ.get('T52_HTTP') == '1', 'requires isolated GRIB sync stand')
class WithdrawalHTTP(unittest.TestCase):
    base = 'http://gateway:8000'
    directory = Path('/evidence/fixtures')

    def catalogue(self):
        response = requests.get(self.base+'/api/v1/catalogue', timeout=90)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['selections']

    def publish(self, source, hours):
        identifier = recovery.submit('2026-10-19T05:00:00Z',
            {'hours': hours, 'fixture': 'actual', 'recoverable': True, 'batch': uuid.uuid4().hex}, source,
            file_hash(self.directory/source), 0)
        self.assertTrue(worker.once(identifier))
        with database() as cursor:
            cursor.execute('SELECT * FROM app.jobs WHERE id=%s', (identifier,))
            job = cursor.fetchone()
        self.assertEqual(job['state'], 'published', job.get('error'))
        return job

    def test_full_withdrawal_lifecycle(self):
        a = self.publish('a.grib2', [1])
        b = self.publish('b.grib2', [3])
        before = self.catalogue()
        self.assertEqual(len(before), 3)  # old +1, mixed +1/+3
        mixed = resolve(b['selection'])
        revision = revisions.latest(mixed['identity']['run'])
        assert revision is not None
        a_entry = next(entry for entry in revision['batches'] if revisions.selected(revision, entry)['source']['name']=='a.grib2')
        batch = load_manifest(a_entry['manifest_path'], a_entry['manifest_sha256'])
        catalogue_plan = grib_sync.preview(self.directory, 'isolated')
        # Exercise the still-supported legacy discovery/URL path as well.
        with database() as cursor:
            cursor.execute('INSERT INTO app.catalogue VALUES(%s,%s,%s,%s,clock_timestamp())',
                           (batch['selection'], a['id'], a_entry['manifest_path'], a_entry['manifest_sha256']))
            retention.register(cursor, batch['selection'], batch, a_entry['manifest_path'])
        with self.assertRaises(ValueError):
            grib_sync.apply(catalogue_plan, self.directory, 'isolated')
        before = self.catalogue()
        (self.directory/'a.grib2').unlink()
        plan = grib_sync.preview(self.directory, 'isolated')
        self.assertEqual(len(plan['actions']), 3)
        self.assertEqual(len([a for a in plan['actions'] if a['keep']]), 1)
        Path('/evidence/preview.json').write_text(json.dumps(plan, indent=2))
        unchanged = copy.deepcopy(plan)
        (self.directory/'b.grib2').write_bytes((self.directory/'original.grib2').read_bytes())
        grib_sync.validate_plan(unchanged, grib_sync.preview(self.directory, 'isolated'))
        (self.directory/'new-name.grib2').write_bytes(b'new')
        with self.assertRaises(ValueError):
            grib_sync.apply(plan, self.directory, 'isolated')
        (self.directory/'new-name.grib2').unlink()
        self.assertEqual(self.catalogue(), before)
        with patch.object(grib_sync, 'write_once', side_effect=OSError('preparation failure')):
            with self.assertRaises(OSError):
                grib_sync.apply(plan, self.directory, 'isolated')
        self.assertEqual(self.catalogue(), before)
        @contextmanager
        def rollback():
            with database_transaction():
                yield
                raise RuntimeError('transaction failure')
        with patch.object(grib_sync, 'database_transaction', rollback):
            with self.assertRaises(RuntimeError):
                grib_sync.apply(plan, self.directory, 'isolated')
        self.assertEqual(self.catalogue(), before)
        result = grib_sync.apply(plan, self.directory, 'isolated')
        Path('/evidence/applied.json').write_text(json.dumps(result, indent=2))
        after = self.catalogue()
        self.assertEqual(len(after), 1)
        self.assertEqual(after[0]['valid_time'], '2026-10-15T03:00:00Z')
        for selection in before:
            for url in (selection['collection'], selection['native_display'], selection['wms']+'?SERVICE=WMS&REQUEST=GetCapabilities'):
                response = requests.get(self.base+url, timeout=90)
                self.assertEqual(response.status_code, 410, (url, response.text[:200]))
        # Ordinary ingestion must not inherit removed A from any older root.
        self.publish('b.grib2', [3])
        self.assertEqual(len(self.catalogue()), 1)
        (self.directory/'a.grib2').write_bytes((self.directory/'original.grib2').read_bytes())
        self.assertFalse(grib_sync.preview(self.directory, 'isolated')['actions'])
        self.publish('a.grib2', [1])
        restored = revisions.latest(mixed['identity']['run'])
        assert restored is not None
        self.assertEqual(len(restored['batches']), 2)
        # Empty is an intentional full withdrawal; originals are stored outside
        # the authoritative source folder by the runner before this phase.
        for path in self.directory.iterdir():
            path.unlink()
        empty = grib_sync.preview(self.directory, 'isolated')
        self.assertTrue(empty['actions'])
        self.assertFalse(any(action['keep'] for action in empty['actions']))
        grib_sync.apply(empty, self.directory, 'isolated')
        self.assertFalse(self.catalogue())
        # A full withdrawal reduces the superseded count. Previously expired
        # roots must stay expired even if they lacked a durable tombstone.
        for name in ('a.grib2', 'b.grib2'):
            (self.directory/name).write_bytes(Path('/evidence/sample.grib2').read_bytes())
        old = self.publish('a.grib2', [1])
        self.publish('a.grib2', [3])
        self.publish('b.grib2', [1, 3])
        configuration, _, _ = retention.snapshot()
        retention.configure({**configuration, 'superseded_count': 1})
        old_root = old['selection'].split('.')[0]
        with self.assertRaises(retention.ExpiredSelection):
            retention.ensure(old_root)
        (self.directory/'a.grib2').unlink()
        grib_sync.apply(grib_sync.preview(self.directory, 'isolated'), self.directory, 'isolated')
        with self.assertRaises(retention.ExpiredSelection):
            retention.ensure(old_root)
        self.assertTrue(all(item['valid_time'] in ('2026-10-15T01:00:00Z','2026-10-15T03:00:00Z') for item in self.catalogue()))
        (self.directory/'b.grib2').unlink()
        grib_sync.apply(grib_sync.preview(self.directory, 'isolated'), self.directory, 'isolated')
        retention.configure(configuration)
        self.assertFalse(self.catalogue())
        self.assertIsNone(revisions.latest(mixed['identity']['run']))
        # Withdrawing an older mixed root must not promote its leftover above
        # a newer, unaffected root. Also simulate a lost COMMIT acknowledgement.
        for name in ('a.grib2', 'b.grib2'):
            (self.directory/name).write_bytes(Path('/evidence/sample.grib2').read_bytes())
        self.publish('a.grib2', [1])
        self.publish('b.grib2', [3])
        unaffected = self.publish('b.grib2', [1])
        (self.directory/'a.grib2').unlink()
        historical = grib_sync.preview(self.directory, 'isolated')
        @contextmanager
        def lost_acknowledgement():
            with database_transaction():
                yield
            raise RuntimeError('COMMIT acknowledgement lost')
        with patch.object(grib_sync, 'database_transaction', lost_acknowledgement):
            with self.assertRaises(RuntimeError):
                grib_sync.apply(historical, self.directory, 'isolated')
        current = revisions.latest(mixed['identity']['run'])
        assert current is not None
        self.assertEqual(current['revision'], unaffected['selection'].split('.')[0])
        self.assertEqual(len(current['batches']), 2)
        for selection in self.catalogue():
            resolve(selection['selection'])  # Every committed manifest survived.
        (self.directory/'b.grib2').unlink()
        grib_sync.apply(grib_sync.preview(self.directory, 'isolated'), self.directory, 'isolated')
        self.assertFalse(self.catalogue())
