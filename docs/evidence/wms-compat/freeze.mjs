import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const files=['.gitattributes','docs/qgis.md','publication/api.py','publication/gateway.py','publication/qgis_desktop.py','publication/wms.py','tests/test_publication_qgis.py','tests/test_wms_options.py'];
const directory='data/reports/wms-compat/frozen';fs.mkdirSync(directory,{recursive:true});
const inputs=files.map(file=>{
 const bytes=fs.readFileSync(file);
 const raw=execFileSync('git',['hash-object','--no-filters','--',file],{encoding:'utf8'}).trim();
 const filtered=execFileSync('git',['hash-object','--path='+file,'--',file],{encoding:'utf8'}).trim();
 if(raw!==filtered)throw Error('Git filter changes input '+file);
 const target=path.join(directory,file==='.gitattributes'?'gitattributes.snapshot':file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
 return {path:file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),git_blob:raw};
});
fs.writeFileSync('data/reports/wms-compat/frozen.json',JSON.stringify({base_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),inputs},null,2));
console.log(JSON.stringify({frozen:inputs.length,filters_equal:true}));
