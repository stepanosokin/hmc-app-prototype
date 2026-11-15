"""Full catalogue behaviour through the GIS gateway; tiny GRIBs are fixtures."""
import io
import hashlib
import json
import os
import uuid
import re
import subprocess
import sys
import unittest
from pathlib import Path
import xml.etree.ElementTree as ET
from unittest.mock import patch

import requests
from PIL import Image


class CatalogueFixture(unittest.TestCase):
    base = 'http://gateway:8000'

    def get(self, params=None, expected=200):
        response = requests.get(self.base + '/gis/v1/wms', params=params, timeout=90)
        self.assertEqual(response.status_code, expected, response.text[:300] if expected != 200 else response.content[:80])
        return response

    def publish(self, model, specs, rename=None, legacy_intervals=()):
        from test_field_nodata import temperature_frame
        from publication import revisions, worker, wind_speed
        from publication.domain import ROOT, database
        from decoder.sampling import file_hash
        from decoder.sampling import canonical
        current_metadata = revisions.field_metadata
        def historical_metadata(*args, **kwargs):
            metadata = current_metadata(*args, **kwargs)
            if metadata.get('interval'):
                for key in ('time_increment_type', 'time_increment_unit', 'time_increment'):
                    metadata['field_identity'].pop(key)
                metadata['field'] = 'GRIB2:' + hashlib.sha256(canonical(metadata['field_identity'])).hexdigest()
            return metadata
        frames = []
        for value, keys in specs:
            # ecCodes must know the reference date before constructing the
            # interval's absolute end date from startStep/endStep.
            ordered = {key: keys[key] for key in ('dataDate', 'dataTime') if key in keys}
            ordered.update(keys)
            frames.append(temperature_frame([value] * 12, **ordered))
        source = Path('/evidence') / ('catalogue-' + uuid.uuid4().hex + '.grib2')
        source.write_bytes(b''.join(frames))
        self.delivery = source
        identifier = worker.submit('2026-10-21T12:00:00Z',
                                   {'source_profile': 'grib2-fields', 'fixture': 'actual', 'model': model})
        with database() as cursor:
            cursor.execute('UPDATE app.jobs SET source_name=%s WHERE id=%s', (source.name, identifier))
            cursor.execute('SELECT * FROM app.jobs WHERE id=%s', (identifier,))
            job = cursor.fetchone()
            job['request']['source_directory'] = '/evidence'
            cursor.execute('UPDATE app.jobs SET request=%s WHERE id=%s', (json.dumps(job['request']), identifier))
        directory = ROOT / identifier / uuid.uuid4().hex
        directory.mkdir(parents=True)
        entries = {}
        for index, frame in enumerate(frames):
            target = directory / str(index)
            target.mkdir()
            # Build a genuine old-schema fixture, keeping actual GRIB decoding,
            # arrays, GIS publication and all consumer requests unchanged.
            with patch.object(revisions, 'field_metadata', historical_metadata if index in legacy_intervals else current_metadata):
                numerical = revisions.normalize(source, target / 'numerical', index+1, frame, 'actual', job=job)
            if rename:
                numerical.manifest['source']['field_descriptor']['label'] = rename
            batch, relative, checksum = worker.publish_batch(job, target, numerical, commit=False)
            key = revisions.batch_key(batch['identity'])
            entries[key] = {'key': key, 'field': batch['identity']['field'], 'valid_time': batch['identity']['valid_time'],
                            'manifest_path': relative, 'manifest_sha256': checksum}
        entries = wind_speed.add(job, entries, directory)
        revision = revisions.commit_revision(job, directory, batch['identity']['run'], None, entries, key, 1, source, file_hash(source))
        worker.transition(identifier, 'published')
        return revision

    def refresh_delivery(self, model, count, success=True):
        """Queue an actual worker refresh of the fixture's managed GRIB bytes."""
        import shutil
        from publication import worker
        from publication.domain import ROOT, database
        from decoder.sampling import file_hash
        request = {'source_profile': 'grib2-fields', 'fixture': 'actual', 'model': model,
                   'hours': list(range(1, count+1)), 'recoverable': True, 'rebuild': True}
        identifier = worker.submit('2026-10-22T12:00:00Z', request)
        managed = ROOT / identifier / 'source.grib2'
        managed.parent.mkdir()
        shutil.copyfile(self.delivery, managed)
        with database() as cursor:
            cursor.execute("UPDATE app.jobs SET request=jsonb_set(request,'{source_directory}',%s::jsonb) WHERE id=%s",
                           (json.dumps('/evidence'), identifier))
            cursor.execute('UPDATE app.jobs SET managed_source=%s, checksum=%s, source_name=%s WHERE id=%s',
                           (managed.relative_to(ROOT).as_posix(), file_hash(managed), self.delivery.name, identifier))
        result = subprocess.run([sys.executable, '-m', 'publication.worker', 'once', '--job', identifier],
                                capture_output=True, text=True)
        Path('/evidence', 'catalogue-refresh-' + identifier + '.log').write_text(result.stdout + result.stderr)
        self.assertEqual(result.returncode, 0 if success else 1, result.stderr[-500:])
        if not success:
            events = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
            self.assertTrue(any(event.get('event') == 'command_failed' and event.get('error_type') == 'ValueError'
                                for event in events))

    def catalogue(self):
        root = ET.fromstring(self.get().content)
        resource = root.find('.//{*}GetCapabilities//{*}OnlineResource')
        assert resource is not None
        href = resource.get('{http://www.w3.org/1999/xlink}href')
        assert href is not None
        from urllib.parse import parse_qs, urlsplit
        frozen = {key: values[0] for key, values in parse_qs(urlsplit(href).query).items()}
        folder = root.find('.//{*}Capability/{*}Layer')
        assert folder is not None
        self.assertEqual(folder.findtext('{*}Title'), 'Гидрометцентр')
        self.assertIsNone(folder.find('{*}Name'))
        return {model.findtext('{*}Title'): model.findall('{*}Layer') for model in folder.findall('{*}Layer')}, frozen

@unittest.skipUnless(os.environ.get('T107_HTTP') == '1', 'requires isolated catalogue stand')
class CommonCatalogue(CatalogueFixture):
    def test_full_catalogue_variants_and_growing_accumulation(self):
        height = {'typeOfLevel': 'heightAboveGround', 'level': 2}
        temperature = (280, height)
        shifted = (285, {**height, 'longitudeOfFirstGridPointInDegrees': 20,
                         'longitudeOfLastGridPointInDegrees': 50, 'iDirectionIncrementInDegrees': 10})
        rain = lambda end: (3, {'category': 1, 'number': 8, 'tablesVersion': 35,
                                'stepType': 'accum', 'startStep': 0, 'endStep': end})
        specs: list[tuple[float, dict]] = [temperature, shifted, (100000, {'category': 3, 'number': 0}), rain(3), rain(6),
                 (3, {'category': 2, 'number': 2, 'typeOfLevel': 'heightAboveGround', 'level': 10}),
                 (4, {'category': 2, 'number': 3, 'typeOfLevel': 'heightAboveGround', 'level': 10})]
        self.publish('WMS107-A', specs)
        self.publish('WMS107-B', [(101000, {'category': 3, 'number': 1, 'typeOfLevel': 'meanSea', 'level': 0})])
        models, frozen = self.catalogue()
        leaves = models['WMS107-A']
        self.assertEqual(len(leaves), 5)  # two grids, pressure, rain, derived speed
        self.assertEqual(len(models['WMS107-B']), 1)
        names = {}
        observations = []
        for leaf in leaves + models['WMS107-B']:
            name, title = leaf.findtext('{*}Name'), leaf.findtext('{*}Title')
            assert name is not None and title is not None
            self.assertEqual(leaf.findtext('{*}Style/{*}Title'), title)
            self.assertNotIn('Поле GRIB', title)
            self.assertNotIn(', K', title)
            self.assertIn('единицы:', leaf.findtext('{*}Abstract') or '')
            times = (leaf.findtext('{*}Dimension') or '').split(',')
            names[title] = name
            legend_params = {**frozen, 'SERVICE': 'WMS', 'VERSION': '1.3.0',
                             'REQUEST': 'GetLegendGraphic', 'LAYER': name, 'FORMAT': 'image/png'}
            self.assertEqual(self.get(legend_params).content,
                             self.get({**legend_params, 'TIME': min(times)}).content)
            for time in times:
                geographic = leaf.find('{*}EX_GeographicBoundingBox')
                assert geographic is not None
                x = (float(geographic.findtext('{*}westBoundLongitude') or 'nan') + float(geographic.findtext('{*}eastBoundLongitude') or 'nan')) / 2
                y = (float(geographic.findtext('{*}southBoundLatitude') or 'nan') + float(geographic.findtext('{*}northBoundLatitude') or 'nan')) / 2
                params = {**frozen, 'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap',
                          'LAYERS': name, 'STYLES': '', 'TIME': time, 'CRS': 'EPSG:4326',
                          'BBOX': f'{y-.01},{x-.01},{y+.01},{x+.01}', 'WIDTH': '3', 'HEIGHT': '3', 'FORMAT': 'image/png'}
                mapped = self.get(params).content
                image = Image.open(io.BytesIO(mapped)).convert('RGBA')
                pixel = image.getpixel((1, 1))
                assert isinstance(pixel, tuple)
                self.assertGreater(pixel[3], 0)
                info = self.get({**params, 'REQUEST': 'GetFeatureInfo', 'QUERY_LAYERS': name,
                                 'INFO_FORMAT': 'text/plain', 'I': '1', 'J': '1'}).text
                value = re.search(r'GRAY_INDEX\s*=\s*([^\s]+)', info)
                assert value is not None
                expected = (285 if x > 10 else 280) if title.startswith('Температура') else (
                    5 if title.startswith('Скорость') else 3 if title.startswith('Суммарные') else
                    101000 if title.startswith('Давление на уровне моря') else 100000)
                self.assertAlmostEqual(float(value[1]), expected, delta=.0001)
                self.assertIn('Срок: ' + time, info)
                if title.startswith('Суммарные осадки'):
                    self.assertIn('Интервал: ', info)
                    self.assertEqual(len(times), 2)
                self.assertEqual(Image.open(io.BytesIO(self.get({**frozen, 'SERVICE': 'WMS', 'VERSION': '1.3.0',
                    'REQUEST': 'GetLegendGraphic', 'LAYER': name, 'FORMAT': 'image/png'}).content)).format, 'PNG')
                observations.append({'title': title, 'name': name, 'time': time, 'identify': info,
                                     'params': params, 'map_sha256': hashlib.sha256(mapped).hexdigest()})
        self.assertTrue(any(title.startswith('Скорость ветра на высоте 10 м') for title in names))
        temperatures = [title for title in names if title.startswith('Температура на высоте 2 м')]
        self.assertEqual(len(temperatures), 2)
        self.assertTrue(all('сетка' in title for title in temperatures))
        # Rename descriptive metadata and publish a new revision: Name is scientific.
        self.publish('WMS107-A', specs, rename='Переименованный показатель')
        renamed, _ = self.catalogue()
        self.assertEqual({leaf.findtext('{*}Name') for leaf in renamed['WMS107-A']}, set(names.values()) -
                         {leaf.findtext('{*}Name') for leaf in models['WMS107-B']})
        newer = [(value, {**keys, 'dataDate': 20261022}) for value, keys in specs]
        self.publish('WMS107-A', newer)
        latest, _ = self.catalogue()
        self.assertEqual({leaf.findtext('{*}Name') for leaf in latest['WMS107-A']},
                         {leaf.findtext('{*}Name') for leaf in renamed['WMS107-A']})
        changed = [(281, {**height, 'number': 6, 'dataDate': 20261022})]
        self.publish('WMS107-A', newer + changed)
        changed_models, _ = self.catalogue()
        self.assertEqual(len({leaf.findtext('{*}Name') for leaf in changed_models['WMS107-A']} -
                             {leaf.findtext('{*}Name') for leaf in latest['WMS107-A']}), 1)
        # The same accumulated quantity with another fixed sampling rule must
        # survive alongside it, while varying duration stays in one leaf.
        different_rule = (3, {**rain(3)[1], 'typeOfTimeIncrement': 3})
        self.publish('WMS107-D', [rain(3), different_rule])
        distinct, _ = self.catalogue()
        self.assertEqual(len(distinct['WMS107-D']), 2)
        self.assertEqual(len({leaf.findtext('{*}Name') for leaf in distinct['WMS107-D']}), 2)
        self.publish('WMS107-E', [rain(3), rain(6)], legacy_intervals=(0,))
        mixed, mixed_frozen = self.catalogue()
        self.assertEqual(len(mixed['WMS107-E']), 1)
        mixed_leaf = mixed['WMS107-E'][0]
        mixed_times = (mixed_leaf.findtext('{*}Dimension') or '').split(',')
        self.assertEqual(len(mixed_times), 2)
        for time in mixed_times:
            self.get({**mixed_frozen, 'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap',
                      'LAYERS': mixed_leaf.findtext('{*}Name'), 'STYLES': '', 'TIME': time, 'CRS': 'EPSG:4326',
                      'BBOX': '-.01,-.01,.01,.01', 'WIDTH': '3', 'HEIGHT': '3', 'FORMAT': 'image/png'})
        self.refresh_delivery('WMS107-E', 2)
        refreshed, refreshed_frozen = self.catalogue()
        self.assertNotEqual(refreshed_frozen, mixed_frozen)
        self.assertEqual(len(refreshed['WMS107-E']), 1)
        self.assertEqual(refreshed['WMS107-E'][0].findtext('{*}Name'), mixed_leaf.findtext('{*}Name'))
        self.assertEqual(refreshed['WMS107-E'][0].findtext('{*}Dimension'), mixed_leaf.findtext('{*}Dimension'))
        # A table distinction with no explainable portrayal must fail preparation
        # rather than silently choose a variant or replace the previous catalogue.
        self.publish('WMS107-F', [temperature])
        before_ambiguous, before_frozen = self.catalogue()
        from test_field_nodata import temperature_frame
        self.delivery = Path('/evidence') / ('ambiguous-' + uuid.uuid4().hex + '.grib2')
        self.delivery.write_bytes(b''.join(temperature_frame([280] * 12, **height, tablesVersion=version)
                                           for version in (34, 35)))
        self.refresh_delivery('WMS107-F', 2, success=False)
        after_ambiguous, after_frozen = self.catalogue()
        self.assertEqual(after_frozen, before_frozen)
        self.assertEqual([leaf.findtext('{*}Name') for leaf in after_ambiguous['WMS107-F']],
                         [leaf.findtext('{*}Name') for leaf in before_ambiguous['WMS107-F']])
        listing = {model: [{'name': leaf.findtext('{*}Name'), 'title': leaf.findtext('{*}Title'),
                            'times': leaf.findtext('{*}Dimension')} for leaf in leaves]
                   for model, leaves in after_ambiguous.items()}
        Path('/evidence/common-catalogue.json').write_text(json.dumps({'status': 'passed',
            'snapshot': after_frozen, 'catalogue': listing, 'observations': observations}, ensure_ascii=False, indent=2))

    @unittest.skipUnless(os.environ.get('T107_RESTART') == '1', 'read-only phase after restart')
    def test_catalogue_restart(self):
        saved = json.loads(Path('/evidence/common-catalogue.json').read_bytes())
        self.assertEqual(saved['status'], 'passed')
        root = ET.fromstring(self.get(saved['snapshot']).content)
        for model, leaves in saved['catalogue'].items():
            folder = root.find(f".//{{*}}Layer[{{*}}Title='{model}']")
            assert folder is not None
            self.assertEqual([{'name': leaf.findtext('{*}Name'), 'title': leaf.findtext('{*}Title'),
                              'times': leaf.findtext('{*}Dimension')} for leaf in folder.findall('{*}Layer')], leaves)
        for observation in saved['observations']:
            self.assertEqual(hashlib.sha256(self.get(observation['params']).content).hexdigest(), observation['map_sha256'])
        Path('/evidence/common-catalogue-restart.json').write_text(json.dumps({'status': 'passed',
            'models': len(saved['catalogue']), 'maps': len(saved['observations'])}))
