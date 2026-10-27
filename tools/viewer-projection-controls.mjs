import assert from 'node:assert/strict';

// Cross-file UI contract, checked before allocating browser/service fixtures.
export function projectionControls(html, main) {
    const select=html.match(/<select\b[^>]*\bid="projection"[^>]*>([\s\S]*?)<\/select>/);
    assert.ok(select,'Missing projection selector');
    const options=[...select[1].matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map(([,attributes,label])=>({
        id:attributes.match(/\bvalue="([^"]+)"/)?.[1],label:label.trim(),
        selected:/(?:^|\s)selected(?:\s|=|$)/.test(attributes),
    }));
    assert.ok(options.length&&options.every(o=>o.id&&o.label&&!/\?{2}|\uFFFD/.test(o.label)),'Invalid projection option');
    const ids=options.map(o=>o.id);
    assert.equal(new Set(ids).size,ids.length,'Duplicate projection option');
    const selected=options.filter(o=>o.selected);
    assert.equal(selected.length,1,'Expected one explicit initial projection');
    const initial=main.match(/\bmode\s*:\s*Mode\s*=\s*['"]([^'"]+)['"]/)?.[1];
    assert.equal(selected[0].id,initial,'HTML and TypeScript initial projections differ');
    const modeType=main.match(/\btype\s+Mode\s*=\s*([^;]+);/)?.[1]??'';
    const modes=[...modeType.matchAll(/['"]([^'"]+)['"]/g)].map(m=>m[1]);
    assert.deepEqual([...ids].sort(),modes.sort(),'Selector and supported modes differ');
    const compact=html.match(/<(?:small|span)\b[^>]*\bid="compactProjection"[^>]*>([^<]*)</)?.[1]?.trim();
    assert.equal(compact,selected[0].label,'Initial compact projection label differs');
    return {initial,label:compact,ids};
}
