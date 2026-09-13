const test = require('node:test');
const assert = require('node:assert/strict');
const { acquisitionWindow, normalizeReport, createAcquisitionService } = require('../src/acquisition');

test('reports exclude today and reject providers returning an extra hour', () => {
    const window = acquisitionWindow(7, Date.parse('2026-09-13T18:15:00Z'));
    assert.equal(window.start, '2026-09-06T00:00:00.000Z');
    assert.equal(window.end, '2026-09-13T00:00:00.000Z');
    const result = { query: { since: window.start, until: window.end }, data: { visitors: 0, pageviews: 0, privateField: 'discard' } };
    assert.deepEqual(normalizeReport(result, window), { visitors: 0, pageviews: 0 });
    assert.throws(() => normalizeReport({ ...result, query: { ...result.query, until: '2026-09-13T01:00:00Z' } }, window), /Window mismatch/);
    assert.throws(() => normalizeReport({ ...result, data: { visitors: null, pageviews: 0 } }, window), /Invalid totals/);
    assert.throws(() => normalizeReport({ ...result, data: [{ timestamp: window.end, visitors: 1, pageviews: 1 }] }, window, 'day'), /Invalid day/);
});

test('plan gates and one unavailable source do not hide healthy reports; failures retry', async () => {
    let clock = Date.parse('2026-09-13T18:15:00Z');
    let calls = [];
    const service = createAcquisitionService({
        env: { VERCEL_TOKEN: 'test', VERCEL_PROJECT_ID: 'test' }, now: () => clock,
        request: async url => {
            const p = new URL(url).searchParams;
            calls.push(p);
            const dimension = p.get('by');
            if (dimension?.startsWith('utm')) return { status: 402, ok: false };
            if (dimension === 'requestPath') throw Error('Timeout');
            if (dimension) {
                assert.equal(p.get('until'), '2026-09-12T23:59:59.999Z');
                assert.equal(p.get('filter'), "environment eq 'production'");
            }
            const until = dimension ? new Date(Date.parse(p.get('until')) + 1).toISOString() : p.get('until');
            const data = dimension ? [{ [dimension === 'day' ? 'timestamp' : dimension]: dimension === 'day' ? p.get('since') : '', visitors: 2, pageviews: 3, ignored: 'private' }] : { visitors: 2, pageviews: 3 };
            return { ok: true, status: 200, json: async () => ({ query: { since: p.get('since'), until }, data }) };
        },
    });
    const [a, b] = await Promise.all([service(30), service(30)]);
    assert.deepEqual(a, b);
    assert.equal(calls.length, 7);
    assert.equal(a.sources.totals.status, 'connected');
    assert.deepEqual(a.sources.referrers.data, [{ value: '', visitors: 2, pageviews: 3 }]);
    assert.equal(a.sources.campaigns.status, 'plan_required');
    assert.equal(a.sources.pages.status, 'unavailable');
    assert.equal(a.sources.pages.data, null);
    assert.equal(calls[1].get('since'), '2026-07-15T00:00:00.000Z');
    assert.equal(calls[1].get('until'), '2026-08-14T00:00:00.000Z');
    clock += 16000;
    await service(30);
    assert.equal(calls.length, 14);
});

test('unconfigured reports are unknown, not zero; credentials are never returned', async () => {
    const service = createAcquisitionService({ env: {}, request: () => { throw Error('Must not call'); } });
    const result = await service(7);
    for (const source of Object.values(result.sources)) assert.deepEqual(source, { status: 'not_connected', data: null });
});
