"""Explicit failed-file/continue-batch fixture; never writes producer sources."""
from pathlib import Path
import json
import hashlib

target=Path('/evidence/batch-input')
target.mkdir(exist_ok=False)
data=Path('/input/ICON_EU_T_G_2026101500.grib2').read_bytes()
(target/'ICON_EU_T_G_2026101500.grib2').write_bytes(data)
broken=bytearray(data)
position=16
while broken[position+4]!=3:
    position+=int.from_bytes(broken[position:position+4],'big')
broken[position+12:position+14]=(99).to_bytes(2,'big')
(target/'00-unsupported.grb').write_bytes(broken)
(target/'proj.txt').write_text('INVALID PROJ TEXT MUST BE IGNORED')
(target/'nested').mkdir()
(target/'nested'/'must-not-load.grb').write_bytes(broken)
manifest=[{'name':path.relative_to(target).as_posix(),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
          for path in target.rglob('*') if path.is_file()]
Path('/evidence/batch-fixtures.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Created explicit two-file batch and excluded nested GRIB fixture')
