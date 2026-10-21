import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publishedGroups} from './selection.ts';

test('newest usable run starts at its first published time and retains revision identity',()=>{
    const base={model:'icon-eu',field:'T_G:surface:0',level:'surface',units:'K',fixture:'actual',state:'published'};
    const groups=publishedGroups([
        {...base,selection:'old',run:'2026-10-14T00:00:00Z',revision:'r1',valid_time:'2026-10-14T01:00:00Z'},
        {...base,selection:'late',run:'2026-10-15T00:00:00Z',revision:'r2',valid_time:'2026-10-15T03:00:00Z'},
        {...base,selection:'first',run:'2026-10-15T00:00:00Z',revision:'r2',valid_time:'2026-10-15T01:00:00Z'},
        {...base,selection:'fixture',fixture:'synthetic',run:'2026-10-16T00:00:00Z',revision:'r3',valid_time:'2026-10-16T01:00:00Z'}
    ]);
    assert.equal(groups[0].times[0].selection,'first');
    assert.equal(groups[0].times[1],null,'missing hour stays selectable without interpolation');
    assert.equal(groups[0].times[2].revision,'r2');
    assert.equal(groups.length,2,'synthetic supplements are not public products');
});

test('explicit validation catalogue exposes labelled overlapping runs without mixing their times',()=>{
    const base={model:'ICON-EU',field:'T_G:surface:0',level:0,units:'K',state:'published'};
    const items=[
        {...base,fixture:'actual',selection:'actual',run:'ICON-EU/2026-10-15T00:00:00Z',revision:'r1',valid_time:'2026-10-15T03:00:00Z'},
        {...base,fixture:'overlap',selection:'overlap-first',run:'SYNTHETIC-ICON-EU/2026-10-15T01:00:00Z',revision:'r2',valid_time:'2026-10-15T01:00:00Z'},
        {...base,fixture:'overlap',selection:'overlap-last',run:'SYNTHETIC-ICON-EU/2026-10-15T01:00:00Z',revision:'r2',valid_time:'2026-10-15T03:00:00Z'}
    ];
    assert.equal(publishedGroups(items).length,1);
    const groups=publishedGroups(items,true);
    assert.equal(groups.length,2);
    assert.equal(groups[0].selection.fixture,'overlap');
    assert.deepEqual(groups[0].times.map(item=>item?.selection??null),['overlap-first',null,'overlap-last']);
    assert.equal(groups[1].times[0].selection,'actual');
});
