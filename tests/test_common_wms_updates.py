"""Publication lifecycle observed exclusively through the public GIS gateway."""
import json
import os
from pathlib import Path
import unittest
import uuid
import xml.etree.ElementTree as ET

from test_common_wms_catalogue import CatalogueFixture


@unittest.skipUnless(os.environ.get('T108_HTTP') == '1', 'requires isolated update stand')
class CommonUpdates(CatalogueFixture):
    def test_partial_withdrawal_and_expired_latest_survive_collection(self):
        from publication import grib_sync, retention
        from test_field_nodata import temperature_frame
        withdraw_model = 'WMS108-WITHDRAW-' + uuid.uuid4().hex[:8]
        expiry_model = 'WMS108-EXPIRY-' + uuid.uuid4().hex[:8]
        height = {'typeOfLevel': 'heightAboveGround', 'level': 2}
        self.publish(withdraw_model, [(280, height)])
        temperature_source = self.delivery
        self.delivery = Path('/evidence') / ('update-pressure-' + uuid.uuid4().hex + '.grib2')
        self.delivery.write_bytes(temperature_frame([100000] * 12, category=3, number=0))
        self.refresh_delivery(withdraw_model, 1)
        before, frozen = self.catalogue()
        self.assertEqual(len(before[withdraw_model]), 2)
        temperature_source.rename(temperature_source.with_suffix('.withdrawn'))
        plan = grib_sync.preview(Path('/evidence'), 'wms108-partial', ['/evidence'])
        withdrawal = grib_sync.apply(plan, Path('/evidence'), 'wms108-partial', ['/evidence'])
        self.assertTrue(withdrawal['replacements'])
        partial, replacement = self.catalogue()
        self.assertEqual([leaf.findtext('{*}Title') for leaf in partial[withdraw_model]], ['Давление у поверхности'])
        self.observe(withdraw_model, replacement, 100000, 'Давление у поверхности')
        self.get(frozen, expected=410)
        # Restoring bytes creates a new revision; no old link is resurrected.
        self.delivery = temperature_source.with_suffix('.withdrawn')
        self.refresh_delivery(withdraw_model, 1)
        restored, _ = self.catalogue()
        self.assertEqual(len(restored[withdraw_model]), 2)
        self.get(frozen, expected=410)
        self.publish(expiry_model, [(278, {**height, 'dataDate': 20261020})])
        older_models, older = self.catalogue()
        import re
        pinned_runs = []
        for leaves in older_models.values():
            match = re.search(r'Расчёт: ([^;]+);', leaves[0].findtext('{*}Abstract') or '')
            assert match is not None
            pinned_runs.append(match[1])
        self.publish(expiry_model, [(288, height)])
        _, newer = self.catalogue()
        configuration, policy_clock, policy_roots = retention.snapshot()
        try:
            retention.configure({**configuration, 'clock': '2026-10-29T06:00:00Z',
                'reader_grace_seconds': 0, 'demo_runs': sorted(set(configuration['demo_runs'] + pinned_runs))})
            self.assertFalse(self.model(expiry_model))
            self.get(newer, expected=410)
            self.observe(expiry_model, older, 278)
            collected = retention.collect(apply=True)
            self.assertTrue(collected['removed'])
            self.assertFalse(self.model(expiry_model))
            self.get(newer, expected=410)
            self.observe(expiry_model, older, 278)
        finally:
            retention.configure(configuration)
        self.assertFalse(self.model(expiry_model))
        Path('/evidence/common-updates-withdrawal.json').write_text(json.dumps({'status': 'passed',
            'withdrawal': withdrawal, 'collection': collected}, ensure_ascii=False, indent=2, default=str))

    def model(self, model, frozen=None):
        import requests
        response = requests.get(self.base + '/gis/v1/wms', params=frozen, timeout=90)
        if response.status_code == 404 and frozen is None:
            return []
        self.assertEqual(response.status_code, 200, response.text[:300])
        root = ET.fromstring(response.content)
        folder = root.find(f".//{{*}}Layer[{{*}}Title='{model}']")
        return [] if folder is None else folder.findall('{*}Layer')

    def observe(self, model, frozen, value, title='Температура на высоте 2 м'):
        leaf = next(leaf for leaf in self.model(model, frozen) if leaf.findtext('{*}Title') == title)
        name = leaf.findtext('{*}Name')
        params = {**frozen, 'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetFeatureInfo',
                  'LAYERS': name, 'QUERY_LAYERS': name, 'STYLES': '', 'CRS': 'EPSG:4326',
                  'BBOX': '-.01,-.01,.01,.01', 'WIDTH': '3', 'HEIGHT': '3',
                  'FORMAT': 'image/png', 'INFO_FORMAT': 'text/plain', 'I': '1', 'J': '1'}
        import re
        info = self.get(params).text
        observed = re.search(r'GRAY_INDEX\s*=\s*([^\s]+)', info)
        assert observed is not None
        self.assertAlmostEqual(float(observed[1]), value, delta=.0001)
        self.assertIn('Редакция:', info)
        # Operations share the advertised immutable token, including legends.
        mapped = {key: item for key, item in params.items() if key not in ('QUERY_LAYERS', 'INFO_FORMAT', 'I', 'J')}
        mapped.update(REQUEST='GetMap', FORMAT='image/png')
        self.assertEqual(self.get(mapped).headers['Content-Type'], 'image/png')
        self.get({**frozen, 'REQUEST': 'GetLegendGraphic', 'LAYER': name, 'FORMAT': 'image/png'})
        return {'params': params, 'identify': info, 'name': name}

    def test_model_updates_are_atomic_and_independent(self):
        model_a = 'WMS108-A-' + uuid.uuid4().hex[:8]
        model_b = 'WMS108-B-' + uuid.uuid4().hex[:8]
        height = {'typeOfLevel': 'heightAboveGround', 'level': 2}
        self.publish(model_a, [(280, height), (100000, {'category': 3, 'number': 0})])
        self.publish(model_b, [(275, height)])
        models, original = self.catalogue()
        # A partially delivered NEW run replaces the whole model immediately.
        newer = {**height, 'dataTime': 1200, 'forecastTime': 3}
        self.publish(model_a, [(290, newer)])
        partial, new = self.catalogue()
        self.assertEqual(len(partial[model_a]), 1)
        self.assertEqual(partial[model_a][0].findtext('{*}Dimension'), '2026-10-21T15:00:00Z')
        old_observation = self.observe(model_a, original, 280)
        new_observation = self.observe(model_a, new, 290)
        self.assertEqual(old_observation['name'], new_observation['name'])
        self.observe(model_b, new, 275)
        self.assertEqual(len(self.model(model_a, original)), 2)
        # Correcting the older reference time never replaces the 12 UTC run.
        self.publish(model_a, [(281, height)])
        self.assertEqual(self.catalogue()[1], new)
        # A later revision replaces the whole time domain, never fills gaps.
        self.publish(model_a, [(291, {**newer, 'forecastTime': 6})])
        corrected, correction = self.catalogue()
        self.assertEqual(corrected[model_a][0].findtext('{*}Dimension'), '2026-10-21T18:00:00Z')
        self.observe(model_a, correction, 291)
        self.observe(model_a, new, 290)
        self.observe(model_b, correction, 275)
        bad_time = {**new_observation['params'], 'snapshot': correction['snapshot'], 'TIME': '2026-10-21T15:00:00Z'}
        error = self.get(bad_time, expected=404)
        self.assertTrue(any(ord(char) > 127 for char in error.json()['description']))
        # Genuine validation failure in the worker leaves the previous snapshot.
        from test_field_nodata import temperature_frame
        self.delivery = Path('/evidence') / ('update-invalid-' + uuid.uuid4().hex + '.grib2')
        self.delivery.write_bytes(b''.join(temperature_frame([280] * 12, **newer, tablesVersion=version)
                                          for version in (34, 35)))
        self.refresh_delivery(model_a, 2, success=False)
        self.assertEqual(self.catalogue()[1], correction)
        self.observe(model_a, correction, 291)
        # Other models can advance independently after that failure.
        self.publish(model_b, [(276, {**height, 'dataTime': 1200})])
        _, independent = self.catalogue()
        self.observe(model_a, independent, 291)
        self.observe(model_b, independent, 276)
        Path('/evidence/common-updates-models.json').write_text(json.dumps({'status': 'passed',
            'original': original, 'partial': new, 'correction': correction, 'independent': independent,
            'observations': [old_observation, new_observation]}, ensure_ascii=False, indent=2))


    def test_withdrawn_latest_is_not_a_base_for_later_delivery(self):
        model = 'WMS108-BASE-' + uuid.uuid4().hex[:8]
        from publication import grib_sync
        height = {'typeOfLevel': 'heightAboveGround', 'level': 2}
        self.publish(model, [(280, height)])
        self.publish(model, [(100000, {'category': 3, 'number': 0})])
        before, frozen = self.catalogue()
        self.assertEqual(len(before[model]), 1)
        # The source of the latest revision disappears; the older source stays.
        self.delivery.rename(self.delivery.with_suffix('.withdrawn'))
        plan = grib_sync.preview(Path('/evidence'), 'wms108', ['/evidence'])
        result = grib_sync.apply(plan, Path('/evidence'), 'wms108', ['/evidence'])
        self.assertTrue(result['withdrawn'])
        after, _ = self.catalogue()
        self.assertNotIn(model, after)
        self.get(frozen, expected=410)
        # A later real worker delivery must start empty, never inherit the
        # temperature from an older revision that is still individually usable.
        self.delivery = self.delivery.with_suffix('.withdrawn')
        self.refresh_delivery(model, 1)
        restored, _ = self.catalogue()
        self.assertEqual([leaf.findtext('{*}Title') for leaf in restored[model]],
                         ['Давление у поверхности'])
        self.get(frozen, expected=410)
        Path('/evidence/common-updates-base.json').write_text(json.dumps({'status': 'passed',
            'withdrawn': result['withdrawn'], 'restored_titles':
                [leaf.findtext('{*}Title') for leaf in restored[model]]}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    import sys
    from publication import grib_sync, retention
    from test_field_nodata import temperature_frame
    phase = sys.argv[1]
    if phase not in ('desktop-seed', 'desktop-advance', 'desktop-failure', 'desktop-withdraw', 'desktop-expire', 'desktop-restore'):
        raise ValueError('Unknown desktop fixture phase')
    fixture = CatalogueFixture()
    height = {'typeOfLevel': 'heightAboveGround', 'level': 2}
    state_path = Path('/evidence/desktop-update-state.json')
    state = json.loads(state_path.read_bytes()) if state_path.exists() else {}
    if phase == 'desktop-seed':
        state = {'model': 'WMS108-DESKTOP-' + uuid.uuid4().hex[:8],
                 'independent_model': 'WMS108-INDEPENDENT-' + uuid.uuid4().hex[:8]}
    desktop_model, independent_model = state['model'], state['independent_model']
    if phase == 'desktop-seed':
        fixture.publish(desktop_model, [(280, height), (100000, {'category': 3, 'number': 0})])
        fixture.publish(independent_model, [(275, height)])
    elif phase == 'desktop-advance':
        fixture.publish(desktop_model, [(290, {**height, 'dataTime': 1200})])
        state['temperature_source'] = str(fixture.delivery)
    elif phase == 'desktop-failure':
        fixture.publish(desktop_model, [(281, height)])
        fixture.delivery = Path('/evidence') / ('desktop-invalid-' + uuid.uuid4().hex + '.grib2')
        fixture.delivery.write_bytes(b''.join(temperature_frame([290] * 12, **height, dataTime=1200, tablesVersion=version)
                                              for version in (34, 35)))
        fixture.refresh_delivery(desktop_model, 2, success=False)
    elif phase == 'desktop-withdraw':
        fixture.delivery = Path('/evidence') / ('desktop-pressure-' + uuid.uuid4().hex + '.grib2')
        fixture.delivery.write_bytes(temperature_frame([100000] * 12, category=3, number=0, dataTime=1200))
        fixture.refresh_delivery(desktop_model, 1)
        source = Path(state['temperature_source'])
        source.rename(source.with_suffix('.withdrawn'))
        plan = grib_sync.preview(Path('/evidence'), 'wms108-desktop', ['/evidence'])
        state['withdrawal'] = grib_sync.apply(plan, Path('/evidence'), 'wms108-desktop', ['/evidence'])
    elif phase == 'desktop-expire':
        configuration, policy_clock, policy_roots = retention.snapshot()
        state['policy_before_expiry'] = configuration
        models, _ = fixture.catalogue()
        import re
        runs = []
        for model, leaves in models.items():
            if model != desktop_model:
                match = re.search(r'Расчёт: ([^;]+);', leaves[0].findtext('{*}Abstract') or '')
                assert match is not None
                runs.append(match[1])
        retention.configure({**configuration, 'clock': '2026-10-29T12:00:00Z',
            'reader_grace_seconds': 0, 'demo_runs': sorted(set(runs + [desktop_model + '/2026-10-21T06:00:00Z']))})
    else:
        retention.configure(state['policy_before_expiry'])
    models, frozen = fixture.catalogue()
    state_path.write_text(json.dumps(state, indent=2, default=str))
    Path('/evidence', phase + '.json').write_text(json.dumps({'status': 'passed', 'snapshot': frozen,
        'name': next((leaf.findtext('{*}Name') for leaf in models.get(desktop_model, [])
                      if leaf.findtext('{*}Title') == 'Температура на высоте 2 м'), None),
        'model': desktop_model, 'independent_model': independent_model,
        'models': {model: [{'name': leaf.findtext('{*}Name'), 'title': leaf.findtext('{*}Title')}
                           for leaf in leaves] for model, leaves in models.items()}}, ensure_ascii=False, indent=2))
