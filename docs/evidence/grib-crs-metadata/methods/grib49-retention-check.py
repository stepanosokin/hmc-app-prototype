import json
import sys
from pathlib import Path
from publication import retention

path=Path('/evidence/verification-retention.json')
if sys.argv[1]=='pin':
    selection=json.loads(Path('/evidence/previous-selection.json').read_text(encoding='utf-8-sig'))['selection']
    root=selection.split('.',1)[0]
    original,clock,rows=retention.snapshot()
    old=next(row for row in rows if row['root']==root)
    assert old['expired_at'] is None and old['reason']=='superseded-budget'
    newer=[row for row in rows if row['run']==old['run'] and row['superseded_at'] is not None and
           (retention.instant(row['published_at']),row['root']) >= (retention.instant(old['published_at']),old['root'])]
    temporary=retention.policy(**{**original,'superseded_count':max(original['superseded_count'],len(newer)+1),
        'superseded_bytes':max(original['superseded_bytes'],sum(row['managed_bytes'] for row in newer)+1)})
    path.write_text(json.dumps({'original':original,'temporary':temporary,'checked_root':root,
        'reason_before':old['reason'],'files_deleted':False},indent=2)+'\n')
    retention.configure(temporary)
    assert next(row for row in retention.snapshot()[2] if row['root']==root)['state']=='eligible'
    print(json.dumps({'status':'pinned-for-verification','superseded_count':temporary['superseded_count'],
                      'superseded_bytes':temporary['superseded_bytes']}))
elif sys.argv[1]=='restore':
    saved=json.loads(path.read_text())
    assert retention.snapshot()[0]==saved['temporary'],'Unexpected concurrent policy change'
    retention.configure(saved['original'])
    assert retention.snapshot()[0]==saved['original']
    Path('/evidence/retention-restored.json').write_text(json.dumps({'status':'passed',
        'original_policy_restored':True,'files_deleted':False},indent=2)+'\n')
    print('Original retention policy restored exactly; no files deleted')
else:raise ValueError('pin or restore required')
