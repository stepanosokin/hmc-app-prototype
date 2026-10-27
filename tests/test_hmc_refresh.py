"""Resource-free edge cases for incremental GRIB management."""
import unittest
from pathlib import Path
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from publication import grib_sync, hmc_refresh, retention


class HmcRefreshBoundaries(unittest.TestCase):
    def test_name_comparison_is_case_sensitive(self):
        row = dict(root='r', state='eligible', kind='legacy', run='run', job_id='job', manifest_path='m', manifest_sha256='s')
        batch = {'source': {'name': 'A.grib', 'directory': 'data/grib'}}
        with patch.object(grib_sync, 'source_manifest', return_value=batch):
            plan = grib_sync.plan_rows(['a.grib'], [row], 'target', {}, source_directories=['data/grib'])
        self.assertEqual(plan['actions'][0]['missing'], ['A.grib'])

    def test_unrelated_pending_jobs_block_refresh_and_clear(self):
        from contextlib import contextmanager
        @contextmanager
        def fake_database():
            class Cursor:
                def execute(self, *args):
                    pass
                def fetchall(self):
                    return [{'id': 'job', 'state': 'staged', 'request': {}}]
            yield Cursor()
        with patch.object(grib_sync, 'preview', return_value={'pending': [{'id': 'job'}]}), \
                patch.object(hmc_refresh, 'database', fake_database):
            for remove_all in [False, True]:
                with self.assertRaisesRegex(RuntimeError, 'незавершённые'):
                    hmc_refresh.build_plan(Path('/input'), 'target', [], False, remove_all)

    def test_remove_all_covers_old_other_directory_unknown_expired_and_grib_demos(self):
        rows = [dict(root=str(index), state=state, kind='legacy', run='run', job_id='job',
                     manifest_path=str(index), manifest_sha256='sha')
                for index, state in enumerate(['eligible', 'expired', 'eligible', 'eligible'])]
        batches = [{'source': {'name': 'old', 'directory': 'other'}},
                   {'source': {'name': 'old'}}, {'source': {}},
                   {'source': {'name': 'fixture'}, 'fixture': 'correction'}]
        with patch.object(grib_sync, 'source_manifest', side_effect=lambda relative, _: batches[int(relative)]):
            plan = grib_sync.plan_rows([], rows, 'target', {}, remove_all=True)
        self.assertEqual([row['root'] for row in plan['actions']], ['0', '1', '2', '3'])
        self.assertTrue(all(not row['keep'] for row in plan['actions']))
        self.assertEqual(len(plan['unchecked']), 0)

    def test_partial_or_withdrawn_delivery_is_not_an_unchanged_file(self):
        row: dict = dict(state='eligible', kind='legacy', manifest_path='batch', manifest_sha256='sha')
        plan = {'catalogue': [row], 'source_directories': ['data/grib'], 'include_unlocated': False}
        batch = {'source': {'name': 'a', 'directory': 'data/grib'}, 'identity': {'publication_job': 'job'}}
        jobs: dict = {'job': {'state': 'published', 'request': {'hours': [1, 2]}}}
        with patch.object(grib_sync, 'source_manifest', return_value=batch):
            self.assertEqual(hmc_refresh.published_names(plan, jobs), [])
            jobs['job']['request']['hours'] = [1]
            self.assertEqual(hmc_refresh.published_names(plan, jobs), ['a'])
            jobs['job']['state'] = 'failed'
            self.assertEqual(hmc_refresh.published_names(plan, jobs), [])
            jobs['job']['state'] = 'published'
            row['state'] = 'expired'
            self.assertEqual(hmc_refresh.published_names(plan, jobs), [])

    def test_remove_all_withdraws_actual_and_grib_demo_parts_of_a_mixed_revision(self):
        from publication import revisions
        identity = dict(run='run', field='field', level='level', valid_time='time', native_grid_sha256='grid', member=None)
        batches: dict = {'actual': {'identity': identity, 'source': {'name': 'gone'}},
                   'synthetic': {'identity': {**identity, 'field': 'other'}, 'fixture': 'correction', 'source': {'name': 'fixture'}}}
        entries = [dict(key=revisions.batch_key(batch['identity']), manifest_path=name, manifest_sha256='sha')
                   for name, batch in batches.items()]
        row = dict(root='r', state='eligible', kind='revision', run='run', job_id='job', manifest_path='revision', manifest_sha256='sha')
        with patch.object(revisions, 'load_revision', return_value={'run': 'run', 'batches': entries}), \
                patch.object(grib_sync, 'source_manifest', side_effect=lambda relative, _: batches[relative]):
            plan = grib_sync.plan_rows([], [row], 'target', {}, remove_all=True)
        self.assertEqual(plan['actions'][0]['missing'], ['fixture', 'gone'])
        self.assertEqual(plan['actions'][0]['keep'], [])

    def test_wall_cleanup_deadline_preserves_grace_with_a_frozen_policy_clock(self):
        now = datetime.now(timezone.utc)
        row = {'reason': 'source-withdrawn', 'delete_after': '2026-10-19T05:02:00Z',
               'cleanup_after': now+timedelta(seconds=60)}
        self.assertTrue(retention.cleanup_protected(row, '2026-10-19T05:00:00Z'))
        row['cleanup_after'] = now-timedelta(seconds=1)
        self.assertFalse(retention.cleanup_protected(row, '2026-10-19T05:00:00Z'))
        row['cleanup_after'] = None
        self.assertTrue(retention.cleanup_protected(row, '2026-10-19T05:00:00Z'))


if __name__ == '__main__':
    unittest.main()
