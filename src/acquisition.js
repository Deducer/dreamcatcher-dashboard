const DAY = 86400000;

function acquisitionWindow(days, now = Date.now()) {
    const end = Date.parse(new Date(now).toISOString().slice(0, 10));
    return { days, start: new Date(end - days * DAY).toISOString(), end: new Date(end).toISOString() };
}

// UI dates are inclusive. Provider queries use a half-open UTC interval.
function resolveWindow(query, now = Date.now()) {
    if (query.start !== undefined || query.end !== undefined) {
        const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
        if (!valid(query.start) || !valid(query.end)) throw Error('Choose valid start and end dates.');
        const start = Date.parse(query.start), end = Date.parse(query.end) + DAY;
        const days = (end - start) / DAY;
        if (days < 1 || days > 90) throw Error('Choose between 1 and 90 days.');
        if (end > Date.parse(acquisitionWindow(1, now).end)) throw Error('Choose an end date no later than yesterday (UTC).');
        return { days, start: new Date(start).toISOString(), end: new Date(end).toISOString() };
    }
    const days = { '7d': 7, '30d': 30, '90d': 90 }[query.range || '30d'];
    if (!Number.isInteger(days)) throw Error('Choose 7d, 30d, 90d, or a custom date range.');
    return acquisitionWindow(days, now);
}

function normalizeReport(result, window, dimension) {
    if (Date.parse(result.query?.since) !== Date.parse(window.start) || Date.parse(result.query?.until) !== Date.parse(window.end)) throw new Error('Window mismatch');
    const valid = row => Number.isFinite(row?.visitors) && row.visitors >= 0 && Number.isFinite(row?.pageviews) && row.pageviews >= 0;
    if (!dimension) {
        if (!valid(result.data)) throw new Error('Invalid totals');
        return { visitors: result.data.visitors, pageviews: result.data.pageviews };
    }
    if (!Array.isArray(result.data) || result.data.length > 101 || !result.data.every(valid)) throw new Error('Invalid report');
    return result.data.map(row => {
        const value = row[dimension === 'day' ? 'timestamp' : dimension];
        if (typeof value !== 'string' && value !== null) throw new Error('Invalid dimension');
        if (dimension === 'day' && (!Number.isFinite(Date.parse(value)) || Date.parse(value) < Date.parse(window.start) || Date.parse(value) >= Date.parse(window.end))) throw new Error('Invalid day');
        return { value: value ?? '', visitors: row.visitors, pageviews: row.pageviews };
    });
}

function createAcquisitionService({ env = process.env, request = fetch, now = Date.now } = {}) {
    const cache = new Map();
    async function report(window, dimension) {
        if (!env.VERCEL_TOKEN || !env.VERCEL_PROJECT_ID) return { status: 'not_connected', data: null };
        // Aggregate rounds its inclusive upper bound up to the next hour. Count
        // uses an exclusive day boundary. Verify the echoed range for both.
        const until = dimension ? new Date(Date.parse(window.end) - 1).toISOString() : window.end;
        const params = new URLSearchParams({ projectId: env.VERCEL_PROJECT_ID, since: window.start, until });
        if (env.VERCEL_TEAM_ID) params.set('teamId', env.VERCEL_TEAM_ID);
        if (dimension) { params.set('by', dimension); params.set('limit', '100'); params.set('filter', "environment eq 'production'"); }
        try {
            const response = await request(`https://api.vercel.com/v1/query/web-analytics/visits/${dimension ? 'aggregate' : 'count'}?${params}`, {
                headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` }, signal: AbortSignal.timeout(8000),
            });
            if (response.status === 402) return { status: 'plan_required', data: null };
            if (!response.ok) throw new Error('Provider unavailable');
            const data = normalizeReport(await response.json(), window, dimension);
            return { status: 'connected', data, fetchedAt: new Date(now()).toISOString() };
        } catch { return { status: 'unavailable', data: null }; }
    }
    return async selection => {
        const window = typeof selection === 'number' ? acquisitionWindow(selection, now()) : selection;
        const { days } = window;
        const key = `${days}:${window.end}`;
        const cached = cache.get(key);
        if (cached && now() - cached.at < cached.ttl) return cached.promise;
        const previous = { start: new Date(Date.parse(window.start) - days * DAY).toISOString(), end: window.start };
        const entry = { at: now(), ttl: 5 * 60000 };
        entry.promise = Promise.all([
            report(window), report(previous), report(window, 'referrerHostname'),
            report(window, 'day'), report(window, 'requestPath'), report(window, 'utmCampaign'), report(window, 'utmSource'),
        ]).then(([totals, previous, referrers, daily, pages, campaigns, taggedSources]) => {
            const sources = { totals, previous, referrers, daily, pages, campaigns, taggedSources };
            if (Object.values(sources).some(s => s.status === 'unavailable')) entry.ttl = 15000;
            return { ...window, generatedAt: new Date(now()).toISOString(), sources };
        }).catch(error => { cache.delete(key); throw error; });
        cache.clear();
        cache.set(key, entry);
        return entry.promise;
    };
}

module.exports = { acquisitionWindow, resolveWindow, normalizeReport, createAcquisitionService };
