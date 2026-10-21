export const referenceTime = (run) => run.slice(run.lastIndexOf('/') + 1);
/** Catalogue ordering preserves publication order, including corrected revisions. */
export function publishedGroups(selections, validationFixtures = false) {
    const groups = new Map();
    for (const item of selections) {
        if (item.state !== 'published' || item.field !== 'T_G:surface:0' || item.units !== 'K' ||
            item.fixture && item.fixture !== 'actual' && !(validationFixtures && item.fixture === 'overlap'))
            continue;
        const key = JSON.stringify([item.model, item.run, item.revision, item.field, item.level]);
        if (!groups.has(key))
            groups.set(key, { key, selection: item, times: [], start: 0 });
        groups.get(key).times.push(item);
    }
    return [...groups.values()].reverse().sort((a, b) => referenceTime(b.selection.run).localeCompare(referenceTime(a.selection.run))).map(group => {
        const times = group.times.filter((x) => x !== null).sort((a, b) => a.valid_time.localeCompare(b.valid_time));
        group.start = Date.parse(times[0].valid_time);
        const end = Date.parse(times[times.length - 1].valid_time);
        if (!Number.isFinite(group.start) || !Number.isFinite(end) || end - group.start > 31 * 86400000)
            throw Error('Некорректный диапазон сроков прогноза.');
        const byTime = new Map(times.map(item => [Date.parse(item.valid_time), item]));
        group.times = Array.from({ length: Math.floor((end - group.start) / 3600000) + 1 }, (_, i) => byTime.get(group.start + i * 3600000) ?? null);
        return group;
    });
}
