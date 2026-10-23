import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativePointToWgs,nativeToWgs} from './native-layer.js';

test('source rotation preserves the quadrant beyond the rotated pole',()=>{
    const metadata={source_crs:{rotation:{kind:'ob_tran',o_lon_p:0,o_lat_p:25,lon_0:90}}};
    const point=nativePointToWgs([20,50],metadata);
    // Independently verified with pinned PROJ and Cartesian rotation.
    assert.ok(Math.abs(point[0]-(-116.60114683287341))<1e-10);
    assert.ok(Math.abs(point[1]-60.75978256446075)<1e-10);
});
test('old publications keep the legacy native sphere',()=>{
    assert.deepEqual(nativePointToWgs([20,50],{}),[20,nativeToWgs(50)]);
});
test('unknown source rotation fails explicitly',()=>{
    assert.throws(()=>nativePointToWgs([20,50],{source_crs:{rotation:{kind:'unknown'}}}),/CRS/);
});
