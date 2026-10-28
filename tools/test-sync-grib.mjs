import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseOptions,standConfiguration,runOwned} from './sync-grib.mjs';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';

test('owned operation permits an unlimited wait and retains deadlines and cancellation',async t=>{
    for(const mode of ['unlimited','bounded','expired','cancelled']){
        await t.test(mode,async t=>{
            const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
            let killed=false,deadline,delay,inventory=0;
            child.kill=()=>{killed=true;setImmediate(()=>child.emit('close',null));};
            const before=['SIGINT','SIGTERM'].map(signal=>process.listenerCount(signal));
            t.mock.method(childProcess,'spawn',()=>{
                setImmediate(()=>{
                    if(mode==='expired')deadline();
                    else if(mode==='cancelled')process.emit('SIGINT');
                    else{child.stdout.write('completed');child.emit('close',0);}
                });
                return child;
            });
            t.mock.method(childProcess,'spawnSync',()=>{inventory++;return {status:0,stdout:'',stderr:''};});
            syncBuiltinESMExports();
            t.mock.method(globalThis,'setTimeout',(callback,milliseconds)=>{deadline=callback;delay=milliseconds;return 123;});
            t.mock.method(globalThis,'clearTimeout',()=>{});
            try{
                const result=runOwned([],process.env,'test-operation','owner',mode==='bounded'||mode==='expired'?1234:null);
                if(mode==='expired'||mode==='cancelled')await assert.rejects(result,/Операция прервана/);
                else assert.equal(await result,'completed');
                assert.equal(delay,mode==='bounded'||mode==='expired'?1234:undefined);
                assert.equal(killed,mode==='expired'||mode==='cancelled');
                assert.equal(inventory,2);
                assert.deepEqual(['SIGINT','SIGTERM'].map(signal=>process.listenerCount(signal)),before);
            }finally{
                t.mock.restoreAll();syncBuiltinESMExports();
            }
        });
    }
});

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
