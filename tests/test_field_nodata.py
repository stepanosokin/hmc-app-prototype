"""Quality NoData must reach statistics and every numerical derivative."""
import io
import json
import os
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import eccodes as ec
import numpy as np
import zarr
from PIL import Image

from decoder.storage import field_metadata, decoded_arrays, write_field, check_field
from decoder.sampling import read_values
from publication.native_display import render, metadata as describe, portrayal, SIZE
from test_grib_fields import field_frame


def temperature_frame(values, category=0, number=0, bitmap=False):
    handle = ec.codes_new_from_message(field_frame(category, number))
    try:
        if bitmap:
            ec.codes_set(handle, 'bitmapPresent', 1)
            ec.codes_set(handle, 'missingValue', 9999)
        ec.codes_set_values(handle, values)
        return ec.codes_get_message(handle)
    finally:
        ec.codes_release(handle)


class FieldNoData(unittest.TestCase):
    def test_revalidation_normalizes_utc_before_creating_a_job(self):
        from publication import revalidate
        @contextmanager
        def database():
            yield object()
        plan: dict = {'actions': [{}]}
        def submit(clock, request):
            self.assertEqual(clock, '2026-10-27T15:00:00Z')
            raise RuntimeError('clock verified without allocating a job')
        for clock in ('2026-10-27T15:00:00Z', '2026-10-27T15:00:00+00:00', '2026-10-27T18:00:00+03:00'):
            with self.subTest(clock=clock), patch.object(revalidate, 'database', database), \
                 patch.object(revalidate.recovery, 'lock', return_value=True), \
                 patch.object(revalidate, 'preview', return_value=plan), \
                 patch.object(revalidate.retention, 'snapshot', return_value=({}, clock, [])), \
                 patch.object(revalidate.worker, 'submit', side_effect=submit):
                with self.assertRaisesRegex(RuntimeError, 'clock verified'):
                    revalidate.apply(plan, 'clock-test')

    def test_zero_kelvin_does_not_shift_scale(self):
        binary = temperature_frame([0, 280, 281, 282] * 3)
        metadata = field_metadata(binary, 1, sample_inventory=False, all_fields=True)
        self.assertEqual(metadata['values']['min'], 280)
        self.assertEqual(metadata['values']['missing_count'], 3)

    def test_mixed_missing_reasons_and_products(self):
        binary = temperature_frame([9999, 0, -1, 273.15] + [280] * 8, bitmap=True)
        metadata = field_metadata(binary, 1, sample_inventory=False, all_fields=True)
        values, native_missing = decoded_arrays(binary, [3, 4])
        self.assertEqual(metadata['values']['source_missing_count'], 1)
        self.assertEqual(metadata['values']['rejected_count'], 2)
        self.assertEqual(metadata['values']['missing_count'], 3)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            item = write_field(root, 'mixed', metadata, values, native_missing)
            self.assertEqual(check_field(root, item, values, native_missing)['missing_cells'], 3)
            group = zarr.open_group(str(root / item['zarr']), mode='r', zarr_format=2)
            np.testing.assert_array_equal(read_values(group, 'values'), values)
            np.testing.assert_array_equal(read_values(group, 'missing_reason').ravel()[:4], [1, 2, 2, 0])
            from publication.tiles import bilinear
            grid = metadata['grid']
            bounds, spacing = grid['outer_cell_edges_wsen'], grid['spacing_degrees_xy']
            _, valid = bilinear(values, read_values(group, 'missing').astype(bool),
                                np.array([bounds[0]+spacing[0]/2]), np.array([bounds[1]+spacing[1]/2]), bounds, spacing)
            self.assertEqual(valid[0], 0)
            payload = render(root, item, 0, 0)
            mask = np.frombuffer(payload[SIZE * SIZE * 4:], dtype='uint8').reshape(SIZE, SIZE)
            np.testing.assert_array_equal(mask[1, 1:5], [0, 0, 0, 1])
            self.assertGreater(json.loads(describe(root, item))['display_range'][0], 273)

    def test_empty_field_keeps_time_and_has_no_range(self):
        binary = temperature_frame([0] * 12)
        metadata = field_metadata(binary, 1, sample_inventory=False, all_fields=True)
        self.assertIsNone(metadata['values']['min'])
        self.assertIsNone(metadata['values']['max'])
        values, native_missing = decoded_arrays(binary, [3, 4])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            item = write_field(root, 'empty', metadata, values, native_missing)
            self.assertEqual(check_field(root, item, values, native_missing)['finite_cells'], 0)
            description = json.loads(describe(root, item))
            self.assertTrue(description['all_nodata'])
            self.assertIsNone(description['display_range'])
            self.assertEqual(metadata['valid_time'], '2026-10-21T06:00:00Z')
            image = Image.open(io.BytesIO(portrayal(root, item, 0, 0))).convert('RGBA')
            self.assertEqual(image.getchannel('A').getextrema(), (0, 0))

    def test_other_quantities_and_anomalies_keep_zero(self):
        for category, number in [(1, 8), (2, 2), (0, 9), (191, 192)]:
            with self.subTest(category=category, number=number):
                metadata = field_metadata(temperature_frame([0] * 12, category, number), 1,
                                          sample_inventory=False, all_fields=True)
                self.assertEqual(metadata['values']['missing_count'], 0)
                self.assertEqual(metadata['values']['min'], 0)

    def test_deviation_of_temperature_keeps_zero(self):
        from decoder.validity import validity
        metadata = field_metadata(temperature_frame([0] * 12), 1, sample_inventory=False, all_fields=True)
        metadata['interval'] = {'statistical_process': 6}
        reasons, _ = validity(np.zeros((3, 4)), np.zeros((3, 4), dtype=bool), metadata)
        self.assertFalse(reasons.any())

    def test_valid_zero_is_transparent_without_becoming_nodata(self):
        binary = temperature_frame([0] * 12, 1, 8)
        metadata = field_metadata(binary, 1, sample_inventory=False, all_fields=True)
        values, missing = decoded_arrays(binary, [3, 4])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            item = write_field(root, 'zero', metadata, values, missing)
            self.assertEqual(metadata['values']['finite_count'], 12)
            payload = render(root, item, 0, 0)
            mask = np.frombuffer(payload[SIZE * SIZE * 4:], dtype='uint8').reshape(SIZE, SIZE)
            self.assertEqual(mask[1, 1], 1)
            from publication.tiles import bilinear
            grid = metadata['grid']
            bounds, spacing = grid['outer_cell_edges_wsen'], grid['spacing_degrees_xy']
            interpolated, valid = bilinear(values, read_values(zarr.open_group(str(root/item['zarr']),mode='r'), 'missing').astype(bool),
                np.array([bounds[0]+spacing[0]]), np.array([bounds[1]+spacing[1]]), bounds, spacing)
            self.assertEqual((interpolated[0], valid[0]), (0, 1))
            description = json.loads(describe(root, item))
            self.assertTrue(description['zero_transparent'])
            self.assertFalse(description['all_nodata'])
            image = Image.open(io.BytesIO(portrayal(root, item, 0, 0))).convert('RGBA')
            self.assertEqual(image.getchannel('A').getextrema(), (0, 0))

    def test_source_only_missing_field_is_accepted(self):
        metadata = field_metadata(temperature_frame([9999] * 12, bitmap=True), 1,
                                  sample_inventory=False, all_fields=True)
        self.assertEqual(metadata['values']['source_missing_count'], 12)
        self.assertEqual(metadata['values']['rejected_count'], 0)
        self.assertIsNone(metadata['values']['min'])


@unittest.skipUnless(os.environ.get('T65_HTTP') == '1', 'requires isolated publication services')
class PublishedNoData(unittest.TestCase):
    def seed(self, values, legacy=False, category=0, number=0):
        import uuid
        from publication import revisions, worker
        from publication.domain import ROOT, database
        from decoder.validity import validity
        binary = temperature_frame(values, category, number)
        source = Path('/evidence') / ('nodata-' + uuid.uuid4().hex + '.grib2')
        source.write_bytes(binary)
        identifier = worker.submit('2026-10-19T06:00:00Z', {'source_profile': 'grib2-fields', 'fixture': 'actual'})
        with database() as cursor:
            cursor.execute('SELECT * FROM app.jobs WHERE id=%s', (identifier,))
            job = cursor.fetchone()
        directory = ROOT / identifier / uuid.uuid4().hex
        directory.mkdir(parents=True)
        def legacy_validity(array, missing, metadata):
            result, report = validity(array, missing, {**metadata,
                'raw_identity': {**metadata['raw_identity'], 'parameterCategory': 191}})
            report['version'] = 'legacy-native-mask'
            return result, report
        with patch('decoder.validity.validity', legacy_validity if legacy else validity):
            numerical = revisions.normalize(source, directory / 'numerical', 1, binary, 'actual', job=job)
        batch, relative, checksum = worker.publish_batch(job, directory, numerical, commit=False)
        key = revisions.batch_key(batch['identity'])
        entry = {'key': key, 'field': batch['identity']['field'], 'valid_time': batch['identity']['valid_time'],
                 'manifest_path': relative, 'manifest_sha256': checksum}
        revision = revisions.commit_revision(job, directory, batch['identity']['run'], None, {key: entry}, key,
                                             1, source, job['checksum'] or __import__('hashlib').sha256(binary).hexdigest())
        worker.transition(identifier, 'published')
        return revision + '.' + key, batch

    def point(self, selection, batch, lon=10, lat=50):
        import requests
        response = requests.get('http://gateway:8000/api/v1/point', params={
            'selection': selection, 'run': batch['identity']['run'], 'revision': selection.split('.')[0],
            'layer': batch['identity']['field'], 'valid_time': batch['identity']['valid_time'], 'lon': lon, 'lat': lat}, timeout=90)
        return response

    def test_empty_field_publishes_and_gis_stays_transparent(self):
        from publication.domain import resolve
        selection, batch = self.seed([0] * 12)
        published = resolve(selection)
        self.assertTrue(published['gis']['all_nodata'])
        self.assertIsNone(published['gis_checks']['identified_value'])
        # Native coordinates from the tiny actual GRIB metadata fixture.
        from publication.domain import sampler
        numerical = sampler(published)
        cell = numerical.manifest['fields'][0]['metadata']['grid']['cell_centres'][0]
        response = self.point(selection, batch, cell['lon'], cell['lat'])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()['value'])
        self.assertEqual(response.json()['reason'], 'native_nodata')
        self.assertEqual(response.json()['nodata_reason'], 'rejected_value')

    def test_old_publication_replacement_failure_and_idempotence(self):
        from publication import revalidate
        from publication.domain import resolve, sampler
        selection, batch = self.seed([0, 280, 281, 282] * 3, legacy=True)
        published = resolve(selection)
        cell = sampler(published).manifest['fields'][0]['metadata']['grid']['cell_centres'][0]
        self.assertEqual(self.point(selection, batch, cell['lon'], cell['lat']).json()['value'], 0)
        plan = revalidate.preview('isolated65')
        with patch.object(revalidate, 'rebuild', side_effect=RuntimeError('injected preparation failure')):
            with self.assertRaisesRegex(RuntimeError, 'injected'):
                revalidate.apply(plan, 'isolated65')
        self.assertEqual(self.point(selection, batch, cell['lon'], cell['lat']).status_code, 200)
        result = revalidate.apply(plan, 'isolated65')
        from publication.domain import database
        with database() as cursor:
            cursor.execute('SELECT selection FROM app.jobs WHERE id=%s', (result['job'],))
            job_selection = cursor.fetchone()['selection']
        self.assertEqual(resolve(job_selection)['identity']['revision'], result['replacements'][-1]['revision'])
        replacement = next(item['revision'] for item in result['replacements'] if item['previous'] == selection.split('.')[0])
        new_selection = replacement + '.' + selection.split('.')[1]
        point = self.point(new_selection, batch, cell['lon'], cell['lat'])
        self.assertEqual(point.status_code, 200, point.text)
        self.assertIsNone(point.json()['value'])
        self.assertEqual(point.json()['nodata_reason'], 'rejected_value')
        self.assertEqual(self.point(selection, batch, cell['lon'], cell['lat']).status_code, 410)
        numerical = sampler(resolve(new_selection))
        self.assertEqual(numerical.manifest['fields'][0]['metadata']['values']['min'], 280)
        self.assertFalse(revalidate.preview('isolated65')['actions'])
        Path('/evidence/nodata-migration.json').write_text(json.dumps(result, indent=2))

    def test_valid_zero_publishes_as_transparent_and_identifies_as_zero(self):
        from publication.domain import resolve, sampler
        selection, batch = self.seed([0] * 12, category=1, number=8)
        published = resolve(selection)
        self.assertFalse(published['gis']['all_nodata'])
        self.assertTrue(published['gis']['all_transparent'])
        self.assertEqual(published['gis_checks']['identified_value'], 0)
        numerical = sampler(published)
        cell = numerical.manifest['fields'][0]['metadata']['grid']['cell_centres'][0]
        response = self.point(selection, batch, cell['lon'], cell['lat'])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['value'], 0)
        self.assertIsNone(response.json()['reason'])


if __name__ == '__main__':
    unittest.main()
