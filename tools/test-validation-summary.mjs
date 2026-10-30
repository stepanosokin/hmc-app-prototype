import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {summarizeReport,renderSummary,MAX_OUTPUT_BYTES} from './validation-summary.mjs';

test('live summary distinguishes missing runtime from throttled field loading without response URLs',()=>{
    const missing=JSON.parse(renderSummary({state:{ready:true,canvas:false,contours:null}}));
    assert.equal(missing.state.contours,null);assert.equal(missing.state.ready,true);
    const result=renderSummary({state:{ready:false,canvas:false,contours:{state:'missing',message:'Нет поля',curves:0,metadata:'secret'}},
        viewport:{width:640,height:360},responses:Array(1000).fill({status:429,path:'/private-selection',body:'private-body'}).concat([{status:404},{status:200}])});
    const summary=JSON.parse(result);assert.deepEqual(summary.http_failures,{'404':1,'429':1000});
    assert.equal(summary.state.contours.state,'missing');assert.equal(summary.viewport.width,640);
    assert.ok(!/private|secret/.test(result));assert.ok(Buffer.byteLength(result)<MAX_OUTPUT_BYTES);
    assert.equal(summarizeReport({status:'passed',contour_ink_pixels:123,state:{ready:true,contours:{state:'ready',curves:92}}}).contour_ink_pixels,123);
});

test('NoData cases retain coverage counts without nested field or GPU data',()=>{
    const nodata=[];
    for(const [width,height] of [[1440,900],[390,844],[360,740],[640,360]])for(const kind of ['empty','zero','mixed'])
        nodata.push({kind,width,height,state:{raster:'private-nodata-marker'.repeat(100000)},metadata:{password:'secret'}});
    const output=renderSummary({status:'passed',nodata});
    assert.ok(Buffer.byteLength(output)<=MAX_OUTPUT_BYTES);assert.ok(!output.includes('private-nodata-marker'));assert.ok(!output.includes('secret'));
    assert.deepEqual(JSON.parse(output).nodata,{cases:12,kinds:['empty','zero','mixed'],viewports:['1440x900','390x844','360x740','640x360']});
    const large=renderSummary({nodata:Array.from({length:100},(_,i)=>({kind:'Authorization: Bearer hidden-'+i,width:i,height:200}))});
    assert.ok(Buffer.byteLength(large)<=MAX_OUTPUT_BYTES);assert.ok(!large.includes('hidden-'));
    assert.equal(JSON.parse(large).nodata.viewports.length,8);
});

test('browser failure remains readable while enormous nested metadata is excluded',()=>{
    const nested={metadata:{raster:'private-raster-marker'.repeat(100000)}};
    const result=renderSummary({status:'failed',failure:'Control is visible: #latestRun',failure_dom:'large-dom-marker'.repeat(100000),
        failure_state:{ready:true,time_state:'ready',catalogue_pending:false,selected:{selection:'old',field:'T_G:surface:0',member:null,metadata:nested}},
        updates:{atomic:{view:nested},races:[nested],new_run:{run:'run',fixture:'overlap',metadata:nested}},checks:['a','b'],
        cleanup:{browser_stopped:true,profile_removed:true,browser_processes_remaining:0,unknown:nested}});
    assert.ok(Buffer.byteLength(result)<MAX_OUTPUT_BYTES);
    assert.ok(!result.includes('private-raster-marker'));assert.ok(!result.includes('large-dom-marker'));
    const summary=JSON.parse(result);
    assert.equal(summary.failure,'Control is visible: #latestRun');assert.equal(summary.failure_state.selected.selection,'old');
    assert.equal(summary.failure_state.selected.field,'T_G:surface:0');assert.equal(summary.failure_state.selected.member,null);
    assert.equal(summary.updates.new_run.fixture,'overlap');assert.equal(summary.counts.checks,2);assert.equal(summary.cleanup.profile_removed,true);
    assert.ok(!renderSummary({updates:{races:{length:nested}},withdrawal:{operations:{length:nested}}}).includes('private-raster-marker'));
});
test('large multilingual errors and arrays remain bounded and redact diagnostic credentials',()=>{
    const message='Authorization: Bearer secret-bearer "Authorization":"Basic secret-basic" password="secret-password" api_key=secret-key&note=ok '+'Ошибка🌧'.repeat(1000);
    const output=renderSummary({status:'failed',scope:message,failure:message,error:message,starting_commit:message,
        errors:Array(100).fill({message}),cleanup:{errors:Array(100).fill(message)},withdrawal:{checks:Array(100).fill(message)},
        viewports:Array(100).fill({width:390,height:844,metadata:message})});
    assert.ok(Buffer.byteLength(output)<=MAX_OUTPUT_BYTES);
    for(const secret of ['secret-bearer','secret-basic','secret-password','secret-key'])assert.ok(!output.includes(secret));
    assert.equal(JSON.parse(output).errors.length,3);assert.equal(JSON.parse(output).viewports.length,8);
});
test('process records expose failures and last stage, not raw nested results',()=>{
    const summary=summarizeReport([{check:'seed',native_exit_code:0},{check:'browser',native_exit_code:1,metadata:{secret:'ignored'}},{check:'cleanup',native_exit_code:0}]);
    assert.equal(summary.records,3);assert.equal(summary.failed,1);
    assert.deepEqual(summary.failures,[{check:'browser',native_exit_code:1}]);assert.deepEqual(summary.last,{check:'cleanup',native_exit_code:0});
    assert.equal(summarizeReport([{check:'unknown',native_exit_code:null},{check:'cleanup',native_exit_code:0}]).failed,1);
    assert.throws(()=>summarizeReport(null),/Expected/);
});
test('CLI accepts BOM JSON/JSONL and rejects malformed or oversized reports without echoing input',()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hmc-summary-test-'));
    const invoke=file=>spawnSync(process.execPath,['tools/validation-summary.mjs',file],{encoding:'utf8',windowsHide:true});
    try{
        const json=path.join(directory,'report.json'),jsonl=path.join(directory,'process.jsonl');
        fs.writeFileSync(json,'\uFEFF'+JSON.stringify({status:'passed',metadata:'ignored'}));
        let result=invoke(json);assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).status,'passed');
        fs.writeFileSync(jsonl,'\uFEFF{"check":"failed","native_exit_code":1}\n\n');
        result=invoke(jsonl);assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).failed,1);
        fs.writeFileSync(json,'{"password":"do-not-echo",');result=invoke(json);
        assert.equal(result.status,1);assert.ok(!result.stderr.includes('do-not-echo'));assert.equal(result.stdout,'');
        fs.truncateSync(json,64*1024**2+1);result=invoke(json);assert.equal(result.status,1);assert.ok(result.stderr.length<200);
    }finally{
        assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
        assert.match(path.basename(directory),/^hmc-summary-test-/);
        fs.rmSync(directory,{recursive:true,force:true});assert.equal(fs.existsSync(directory),false);
    }
});
