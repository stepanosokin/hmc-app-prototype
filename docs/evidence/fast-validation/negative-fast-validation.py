from pathlib import Path
import json
import subprocess
import sys

root=Path.cwd()
path=root/'docs/evidence/fast-validation/artifact-index.json'
original=path.read_bytes()
index=json.loads(original)
results=[]
try:
    for name,selections in [('missing-browsers',[]),('duplicate-chrome',[index['selected_reports'][0]]*2)]:
        changed=dict(index,selected_reports=selections)
        path.write_text(json.dumps(changed),encoding='utf-8')
        process=subprocess.run([sys.executable,'-B','docs/evidence/fast-validation/verify.py'],capture_output=True,text=True)
        assert process.returncode!=0 and 'Chrome/Edge matrix' in process.stderr,process.stderr
        results.append({'case':name,'exit':process.returncode,'expected_rejection':'Chrome/Edge matrix'})
finally:
    path.write_bytes(original)
(root/'data/reports/fast-validation/archive-negative.json').write_text(json.dumps(results,indent=2)+'\n',encoding='utf-8')
print(json.dumps(results))
