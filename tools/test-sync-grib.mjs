import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseOptions,standConfiguration} from './sync-grib.mjs';

const service=name=>({Id:name,Image:'sha256:image',State:{Running:true},
    Config:{Labels:{'com.docker.compose.project':'test','com.docker.compose.service':name},Env:['WORKER_PASSWORD=private']},
    Mounts:[{Destination:'/assets',Type:'volume',Name:'actual-override-volume'}],
    NetworkSettings:{Networks:{actual_network:{Aliases:['db']}}}});

test('legacy mode is explicit, accepts either flag position and rejects malformed options',()=>{
    assert.deepEqual(parseOptions(['--plan','p.json']),{'--plan':'p.json'});
    for(const args of [['--include-unlocated','--plan','p.json'],['--plan','p.json','--include-unlocated']]){
        assert.deepEqual(parseOptions(args),{'--plan':'p.json','--include-unlocated':true});
    }
    for(const args of [[],['--plan'],['--plan','--include-unlocated'],['--plan','p','--plan','q'],
        ['--plan','p','--include-unlocated','--include-unlocated'],['--plan','p','--unknown']]){
        assert.throws(()=>parseOptions(args));
    }
});

test('operation storage budget is explicit, bounded to safe integer bytes and never defaulted by parser',()=>{
    assert.equal(parseOptions(['--plan','p','--storage-budget-bytes','34359738368'])['--storage-budget-bytes'],'34359738368');
    assert.equal(parseOptions(['--plan','p'])['--storage-budget-bytes'],undefined);
    for(const value of ['0','-1','1.5','32GiB','1e12','9007199254740992','']){
        assert.throws(()=>parseOptions(['--plan','p','--storage-budget-bytes',value]));
    }
    assert.throws(()=>parseOptions(['--plan','p','--storage-budget-bytes','16','--storage-budget-bytes','32']));
});
test('uses the running stand volume/image/network and refuses stopped or ambiguous services',()=>{
    const services=['db','api','gateway','geoserver'].map(service);
    assert.equal(standConfiguration(services,'test').assets,'actual-override-volume');
    assert.equal(standConfiguration(services,'test').image,'sha256:image');
    services[0].State.Running=false;
    assert.throws(()=>standConfiguration(services,'test'),/остановлена/);
    services[0].State.Running=true;
    assert.throws(()=>standConfiguration([...services,service('db')],'test'),/однозначно/);
    assert.throws(()=>standConfiguration(services,'other'),/остановлена/);
});
