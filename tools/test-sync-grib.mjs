import {test} from 'node:test';
import assert from 'node:assert/strict';
import {standConfiguration} from './sync-grib.mjs';

const service=name=>({Id:name,Image:'sha256:image',State:{Running:true},
    Config:{Labels:{'com.docker.compose.project':'test','com.docker.compose.service':name},Env:['WORKER_PASSWORD=private']},
    Mounts:[{Destination:'/assets',Type:'volume',Name:'actual-override-volume'}],
    NetworkSettings:{Networks:{actual_network:{Aliases:['db']}}}});
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
