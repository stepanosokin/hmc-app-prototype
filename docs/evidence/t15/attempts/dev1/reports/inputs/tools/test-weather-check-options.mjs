import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {parseOptions, shouldCapture} from './weather-check-options.mjs';

test('default and legacy full commands retain their complete matrices',()=>{
  const base=parseOptions([]), full=parseOptions(['--projections']);
  assert.equal(base.scenario,'base');
  assert.equal(base.acceptance,true);
  assert.equal(base.baseViewports.length,3);
  assert.equal(full.acceptance,true);
  assert.equal(full.baseViewports.length,3);
  assert.equal(full.projectionViewports.length,3);
  assert.equal(full.landscapeViewports.length,5);
  assert.equal(shouldCapture(full,'anything'),true);
});

test('a selected mobile scenario runs only the requested viewport as development',()=>{
  const plan=parseOptions(['--scenario=mobile-controls','--viewport=360x740','--screenshots=focused-controls']);
  assert.equal(plan.acceptance,false);
  assert.deepEqual(plan.baseViewports,[]);
  assert.deepEqual(plan.landscapeViewports,[]);
  assert.deepEqual(plan.projectionViewports,[[360,740,true]]);
  assert.equal(shouldCapture(plan,'projection-360x740-focused-controls'),true);
  assert.equal(shouldCapture(plan,'projection-360x740-initial'),false);
});

test('landscape and projection scenarios select their own matrices',()=>{
  const layout=parseOptions(['--scenario=landscape','--viewport=640x360']);
  assert.deepEqual(layout.landscapeViewports,[[640,360]]);
  assert.deepEqual(layout.projectionViewports,[]);
  assert.equal(layout.acceptance,false);
  const geometry=parseOptions(['--scenario=projections','--viewport=1440x900']);
  assert.deepEqual(geometry.projectionViewports,[[1440,900,false]]);
  assert.deepEqual(geometry.baseViewports,[]);
  assert.deepEqual(geometry.landscapeViewports,[]);
});

test('filtered full command cannot claim acceptance; failure-only skips regular captures',()=>{
  for(const argv of [['--projections','--viewport=390x844'],['--projections','--screenshots=failure']]){
    assert.equal(parseOptions(argv).acceptance,false);
  }
  assert.equal(shouldCapture(parseOptions(['--screenshots=failure']),'point'),false);
});

test('legacy focused flags remain development checks',()=>{
  assert.equal(parseOptions(['--projections','--mobile-controls']).scenario,'mobile-controls');
  assert.equal(parseOptions(['--projections','--landscape-only']).scenario,'landscape');
  assert.equal(parseOptions(['--projections','--landscape-only']).acceptance,false);
});

test('invalid or contradictory selection fails before allocating a browser',()=>{
  for(const argv of [['--scenaro=base'],['--scenario=unknown'],['--viewport=0x0'],
    ['--scenario=landscape','--viewport=390x844'],['--scenario=mobile-controls','--viewport=1440x900'],
    ['--scenario=base','--scenario=all'],['--landscape-only','--mobile-controls'],
    ['--screenshots='],['--screenshots=all,point'],['--scenario=base','--projections']]){
    assert.throws(()=>parseOptions(argv),undefined,argv.join(' '));
  }
});

test('CLI plan and invalid input work without Git or an installed browser',()=>{
  const env={...process.env,T22_CHROME:'missing-browser-for-plan-test.exe'};
  const plan=spawnSync(process.execPath,['tools/check-weather-prototype.mjs','--scenario=landscape','--viewport=640x360','--plan'],{encoding:'utf8',env,windowsHide:true});
  assert.equal(plan.status,0,plan.stderr);
  assert.equal(JSON.parse(plan.stdout).acceptance,false);
  const invalid=spawnSync(process.execPath,['tools/check-weather-prototype.mjs','--viewport=unknown'],{encoding:'utf8',env,windowsHide:true});
  assert.equal(invalid.status,2,invalid.stderr);
  assert.match(invalid.stderr,/Размер экрана/);
  assert.doesNotMatch(invalid.stderr,/dubious ownership|spawn/);
});
