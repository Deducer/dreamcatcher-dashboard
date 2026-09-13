const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DAY, buildMarketingMetrics, cohortMetrics } = require('../src/marketing-metrics');
const { readAll, optionalSource } = require('../src/marketing');
const now = Date.parse('2026-09-13T12:00:00Z');
const profile = (id, age) => ({ id, created_at: new Date(now - age * DAY).toISOString() });
const dream = (user_id, age) => ({ user_id, created_at: new Date(now - age * DAY).toISOString() });

test('activation uses 48-hour maturity, counts once, and excludes pre-signup dreams', () => {
    const profiles = [profile('activated', 3), profile('late', 5), profile('pending', 1), profile('before', 4)];
    const dreams = [dream('activated', 2.8), dream('activated', 2.5), dream('late', 2), dream('pending', .5), dream('before', 5)];
    const m = cohortMetrics(profiles, dreams, now - 7 * DAY, now);
    assert.equal(m.activation.count, 1);
    assert.equal(m.activation.eligible, 3);
    assert.equal(m.activation.pending, 1);
    assert.ok(Math.abs(m.activation.percent - 100 / 3) < 1e-10);
});

test('retention requires full observation and uses half-open signup-relative windows', () => {
    const profiles = [profile('return', 20), profile('boundary', 20), profile('pending', 10)];
    const dreams = [dream('return', 13), dream('boundary', 6), dream('pending', 2)];
    const m = cohortMetrics(profiles, dreams, now - 30 * DAY, now);
    assert.deepEqual(m.week2, { count: 1, eligible: 2, percent: 50, pending: 1 });
    assert.equal(m.week5.percent, null);
});

test('prior cohorts use the prior period end, not extra observation time', () => {
    const m = buildMarketingMetrics([profile('old', 31)], [dream('old', 30.5)], 30, now);
    assert.equal(m.prior.activation.eligible, 0);
    assert.equal(m.prior.activation.pending, 1);
});

test('habit builders require two UTC days; unknown/orphan records do not inflate counts', () => {
    const p = [profile('one-day', 40), profile('two-days', 40)];
    const d = [dream('one-day', 1), dream('one-day', 1.01), dream('two-days', 1), dream('two-days', 2), dream('orphan', 1), dream('orphan', 2)];
    const m = buildMarketingMetrics(p, d, 30, now);
    assert.equal(m.weeklyHabit.current, 1);
    assert.equal(m.current.dreamers, 2);
});

test('source tables preserve unknowns, separate evidence and stay within their cohorts', () => {
    const p = [profile('a', 20), profile('b', 20), profile('c', 20)];
    const m = buildMarketingMetrics(p, [dream('a', 19), dream('a', 12)], 30, now,
        [{ id: 'a', reported: 'friend', observed: 'google-play' }, { id: 'b', reported: 'skipped', observed: '(not set)' }]);
    assert.equal(m.channels.reported.reduce((sum, r) => sum + r.signups, 0), 3);
    assert.equal(m.channels.reported.find(r => r.source === 'Unknown').signups, 2);
    assert.equal(m.channels.reported.find(r => r.source === 'Unknown').dreamers, 0);
    assert.equal(m.channels.observed.find(r => r.source === 'google-play').activation.count, 1);
});

test('zero denominators are null, never fabricated zero conversion', () => {
    const m = buildMarketingMetrics([], [], 30, now);
    assert.equal(m.current.activation.percent, null);
    assert.equal(m.current.signups, 0);
    assert.deepEqual(m.channels.reported, []);
});

test('Supabase pagination reads beyond its default row limit and fails closed on later errors', async () => {
    let calls = 0;
    const rows = await readAll(() => ({ range: async offset => {
        calls++;
        return { data: Array.from({ length: offset === 0 ? 1000 : 5 }, (_, i) => ({ id: offset + i })) };
    } }));
    assert.equal(calls, 2);
    assert.equal(rows.length, 1005);
    await assert.rejects(readAll(() => ({ range: async offset => offset ? { error: new Error('offline') } : { data: Array(1000).fill({}) } })));
});

test('missing or failed integrations are explicit, without leaking upstream errors', async () => {
    assert.deepEqual(await optionalSource(false, () => { throw Error('must not execute'); }), { status: 'not_connected', data: null });
    assert.deepEqual(await optionalSource(true, () => { throw Error('secret'); }), { status: 'unavailable', data: null });
});
