import fs from 'node:fs';
import crypto from 'node:crypto';
const phase=process.argv[2],base='http://localhost:8140',directory='data/reports/wms-compat';fs.mkdirSync(directory,{recursive:true});
const catalogue=await (await fetch(base+'/api/v1/catalogue')).json();
const items=catalogue.selections.toSorted((a,b)=>a.selection.localeCompare(b.selection));
const selected=items.filter(x=>x.valid_times.length===24).at(0);
if(!selected)throw Error('Expected retained 24-time publication');
const url=base+selected.wms;
const request=async(query)=>{const r=await fetch(url+'?'+new URLSearchParams(query));const b=Buffer.from(await r.arrayBuffer());return {status:r.status,type:r.headers.get('content-type'),body:r.ok?b.toString():undefined};};
const caps=await request({SERVICE:'WMS',REQUEST:'GetCapabilities'});
const query={SERVICE:'WMS',VERSION:'1.3.0',REQUEST:'GetMap',LAYERS:'temperature',STYLES:'',CRS:'EPSG:4326',BBOX:'29,-24,71,63',WIDTH:'512',HEIGHT:'512',FORMAT:'image/png',TRANSPARENT:'TRUE'};
const dpi={DPI:'96',MAP_RESOLUTION:'96',FORMAT_OPTIONS:'dpi:96'};
const map=await request({...query,...dpi,TIME:selected.valid_time});
const defaultMap=await request(query);
const identify=await request({...query,...dpi,REQUEST:'GetFeatureInfo',QUERY_LAYERS:'temperature',INFO_FORMAT:'text/plain',WIDTH:'1205',HEIGHT:'701',I:'602',J:'350',TIME:selected.valid_time});
const result={phase,catalogue_count:items.length,catalogue_sha256:crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex'),selected_revision:selected.revision,forecast_times:selected.valid_times.length,
    capabilities:{status:caps.status,max_width:caps.body?.match(/<MaxWidth>(\d+)<\/MaxWidth>/)?.[1],max_height:caps.body?.match(/<MaxHeight>(\d+)<\/MaxHeight>/)?.[1]},
    dpi_map:{status:map.status,type:map.type},default_map:{status:defaultMap.status,type:defaultMap.type},identify:{status:identify.status,type:identify.type,body:identify.body}};
result.passed=result.capabilities.max_width==='512'&&result.capabilities.max_height==='512'&&map.status===200&&defaultMap.status===200&&identify.status===200&&/GRAY_INDEX\s*=\s*[0-9]/.test(identify.body??'');
fs.writeFileSync(directory+'/'+phase+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
