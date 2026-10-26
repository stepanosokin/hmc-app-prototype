import hashlib
import json
import unittest
from unittest.mock import patch

from publication.revisions import batch_key
from publication import catalogue


def digest(value):return hashlib.sha256(str(value).encode()).hexdigest()


class CompactCatalogue(unittest.TestCase):
    def roots(self,count=82):
        roots=[];entries=[]
        for hour in range(count):
            for field in range(30):
                record={'model':'ENA','run':'ENA/2026-10-21T06:00:00Z','field':'GRIB2:'+digest(field),'level':0,
                    'valid_time':f'2026-10-{21+hour//24:02d}T{hour%24:02d}:00:00Z','native_grid_sha256':digest('grid'),
                    'member':None,'units':'Pa','fixture':'actual','native_version':3,'field_profile':'grib2-fields/1',
                    'field_label':'Поле GRIB '+str(field),'field_short_name':'unknown','field_level_type':'surface','display_blocks':32}
                key=batch_key(record)
                entries.append({'key':key,'valid_time':record['valid_time'],'field':record['field'],
                    'manifest_path':f'batches/{key}.json','manifest_sha256':digest(key),'discovery':record})
            roots.append({'revision':digest(hour),'run':'ENA/2026-10-21T06:00:00Z','completeness':'unknown','batches':list(entries)})
        return roots

    def test_all_82_revisions_share_batches_without_repeated_urls_or_time_arrays(self):
        roots=self.roots()
        rows=[{'revision':root['revision'],'manifest_path':str(i),'manifest_sha256':digest(i)} for i,root in enumerate(roots)]
        with patch.object(catalogue.revisions,'load_revision',side_effect=lambda path,sha:roots[int(path)]):
            result=catalogue.compact(rows,[],set())
        self.assertEqual(len(result['templates']),30)
        self.assertEqual(len(result['batches']),2460)
        self.assertEqual(len(result['revisions']),82)
        self.assertEqual(len(result['revisions'][-1]['batches']),2460)
        self.assertLess(len(json.dumps(result,ensure_ascii=False).encode()),2*1024**2)
        self.assertNotIn('valid_times',json.dumps(result))

    def test_expired_roots_are_not_read_and_bad_batch_identity_is_rejected(self):
        root=self.roots(1)[0]
        row={'revision':root['revision'],'manifest_path':'root','manifest_sha256':'checksum'}
        with patch.object(catalogue.revisions,'load_revision',return_value=root) as load:
            self.assertEqual(catalogue.compact([row],[],{root['revision']})['revisions'],[])
            load.assert_not_called()
            root['batches'][0]['discovery']['level']=5
            with self.assertRaisesRegex(ValueError,'identity mismatch'):catalogue.compact([row],[],set())

    def test_delivery_job_and_encoding_metadata_do_not_duplicate_field_templates(self):
        root=self.roots(2)[-1]
        for ordinal,entry in enumerate(root['batches']):
            entry['discovery'].update(publication_job='delivery-'+str(ordinal),contract='hmc-field-tile/4',engine='project-bilinear/1')
        row={'revision':root['revision'],'manifest_path':'root','manifest_sha256':'checksum'}
        with patch.object(catalogue.revisions,'load_revision',return_value=root):
            result=catalogue.compact([row],[],set())
        self.assertEqual(len(result['templates']),30,'Delivery metadata must not defeat field deduplication')
        self.assertEqual(len(result['batches']),60)


if __name__=='__main__':unittest.main()
