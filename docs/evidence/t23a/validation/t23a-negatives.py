import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile

spec=importlib.util.spec_from_file_location('evidence', '/workspace/tools/check_evidence.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
results=[]
assert module.check(Path('/workspace')) > 0
assert module.check_native_display(Path('/workspace')) > 0
with tempfile.TemporaryDirectory() as directory:
    root=Path(directory)
    archive=root/'docs/evidence/t23a'
    shutil.copytree('/workspace/docs/evidence/t23a',archive)
    original=(archive/'artifact-index.json').read_bytes()
    def case(name, change):
        index=json.loads(original)
        restore=[]
        def edit(path, mutation):
            target=archive/path
            restore.append((target,target.read_bytes()))
            value=json.loads(target.read_bytes())
            mutation(value)
            target.write_text(json.dumps(value))
            artifact=next(item for item in index['artifacts'] if item['name']==path)
            artifact.update(bytes=target.stat().st_size,sha256=hashlib.sha256(target.read_bytes()).hexdigest())
        try:
            change(index,edit)
            (archive/'artifact-index.json').write_text(json.dumps(index))
            try:
                module.check_native_display(root)
            except (ValueError,KeyError,TypeError) as error:
                results.append({'case':name,'status':'rejected','reason':str(error)})
            else:
                raise AssertionError('accepted incomplete proof: '+name)
        finally:
            for target,payload in restore:target.write_bytes(payload)
            (archive/'artifact-index.json').write_bytes(original)
    case('empty comparisons',lambda i,e:e(i['selected'][0]['comparison'],lambda v:v.update(views=[])))
    case('missing server comparison',lambda i,e:e(i['selected'][0]['comparison'],lambda v:v.update(views=[x for x in v['views'] if x['scope']=='map'])))
    case('zero samples',lambda i,e:e(i['selected'][0]['comparison'],lambda v:v['views'][0].update(valid_samples=0)))
    case('empty renderer modes',lambda i,e:e(i['selected'][0]['report'],lambda v:v['viewports'][0].update(views=[])))
    case('one renderer mode',lambda i,e:e(i['selected'][0]['report'],lambda v:v['viewports'][0]['views'].pop()))
    case('missing retirement',lambda i,e:i.update(retirements=[]))
    case('live resources',lambda i,e:e(i['retirements'][0],lambda v:v['remaining'].update(container=['live'])))
    case('changed inputs',lambda i,e:e(i['selected'][0]['inputs_end'],lambda v:v[0].update(sha256='0'*64)))
    case('cold budget',lambda i,e:e(i['selected'][0]['report'],lambda v:v['viewports'][0].update(cold_first_show_ms=3001)))
    case('checksum',lambda i,e:i['artifacts'][0].update(sha256='0'*64))
Path('/evidence/evidence-negative.json').write_text(json.dumps({'status':'passed','positive':'historical and native archives verified','negative_checks':results},indent=2)+'\n')
print(json.dumps({'status':'passed','negative_checks':len(results)}))
