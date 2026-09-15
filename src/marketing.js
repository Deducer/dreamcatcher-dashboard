const { buildMarketingMetrics, DAY } = require('./marketing-metrics');

async function readAll(makeQuery) {
    const rows = [];
    for (let offset = 0; offset < 1000000; offset += 1000) {
        const { data, error } = await makeQuery().range(offset, offset + 999);
        if (error || !Array.isArray(data)) throw new Error('Data query failed');
        rows.push(...data);
        if (data.length < 1000) return rows;
    }
    throw new Error('Dataset exceeds query limit');
}

async function jsonRequest(url, key, body, signal) {
    const response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: signal || AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
    return response.json();
}

async function withDeadline(load, timeoutMs) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Source timed out')); }, timeoutMs);
    });
    try { return await Promise.race([Promise.resolve().then(() => load(controller.signal)), deadline]); }
    finally { clearTimeout(timer); }
}

async function optionalSource(configured, load, timeoutMs = 8000) {
    if (!configured) return { status: 'not_connected', data: null };
    try { const data = await withDeadline(load, timeoutMs); return { status: 'connected', fetchedAt: new Date().toISOString(), data }; }
    catch { return { status: 'unavailable', data: null }; }
}

function createMarketingService({ supabase, env = process.env, refreshExcludedIds, isExcludedEmail }) {
    const cache = new Map();
    const coreCache = new Map();
    const chartOptions = new Map();
    async function loadCore(days, endAt, signal) {
        // Complete UTC days keep the web, product and billing windows comparable.
        // Point-in-time billing overview metrics are explicitly labelled separately.
        const now = Date.parse(endAt);
        const excluded = await refreshExcludedIds();
        const [allProfiles, allDreams] = await Promise.all([
            readAll(() => supabase.from('profiles').select('id,created_at').order('id').abortSignal(signal)),
            // No dream text, interpretation, names, or email addresses leave this service.
            readAll(() => supabase.from('dreams').select('id,user_id,created_at').order('id').lt('created_at', new Date(now).toISOString()).abortSignal(signal)),
        ]);
        const profiles = allProfiles.filter(p => !excluded.has(p.id));
        const dreams = allDreams.filter(d => !excluded.has(d.user_id));
        const start = new Date(now - days * DAY).toISOString();
        const end = new Date(now).toISOString();
        return { profiles, dreams, start, end, now, excluded };
    }
    async function getCore(days, endAt) {
        const key = `${days}:${endAt}`;
        const cached = coreCache.get(key);
        if (cached && Date.now() - cached.at < 5 * 60000) return cached.promise;
        const promise = withDeadline(signal => loadCore(days, endAt, signal), 12000).catch(error => { coreCache.delete(key); throw error; });
        if (coreCache.size >= 12) coreCache.delete(coreCache.keys().next().value);
        coreCache.set(key, { at: Date.now(), promise });
        return promise;
    }
    async function collect(days, endAt) {
        const { profiles, dreams, start, end, now, excluded } = await getCore(days, endAt);

        const ph = async (query, signal) => {
            const result = await jsonRequest(`https://us.posthog.com/api/projects/${encodeURIComponent(env.POSTHOG_PROJECT_ID || '452799')}/query/`, env.POSTHOG_PERSONAL_API_KEY,
                { query: { kind: 'HogQLQuery', query } }, signal);
            if (!Array.isArray(result.results) || result.hasMore || result.has_more) throw new Error('Incomplete analytics response');
            return result.results;
        };
        const [posthog, revenuecat, web, email, billingCohorts] = await Promise.all([
            optionalSource(env.POSTHOG_PERSONAL_API_KEY, async signal => {
                // Restrict to verified, non-internal account IDs. Anonymous activity
                // is deliberately not presented as a signed-in conversion funnel.
                const ids = profiles.map(p => p.id).filter(id => /^[0-9a-f-]{36}$/i.test(id));
                const attribution = [], events = new Map();
                for (let i = 0; i < ids.length; i += 200) {
                    const list = ids.slice(i, i + 200).map(id => `'${id}'`).join(',');
                    const base = `FROM events WHERE distinct_id IN (${list}) AND properties.app_env = 'production' AND timestamp < toDateTime('${end.slice(0, 19).replace('T', ' ')}', 'UTC')`;
                    const rows = await ph(`SELECT distinct_id, argMax(person.properties.acquisition_source, timestamp), argMax(person.properties.install_utm_source, timestamp) ${base} GROUP BY distinct_id LIMIT 201`, signal);
                    attribution.push(...rows.map(([id, reported, observed]) => ({ id, reported, observed })));
                    const reaches = await ph(`SELECT event, uniqExact(distinct_id) ${base} AND timestamp >= toDateTime('${start.slice(0, 19).replace('T', ' ')}', 'UTC') AND event IN ('paywall viewed','paywall purchase started','paywall purchase succeeded','paywall purchase cancelled','paywall purchase failed') GROUP BY event LIMIT 10`, signal);
                    for (const [event, count] of reaches) events.set(event, (events.get(event) || 0) + Number(count));
                }
                return { attribution, events: Object.fromEntries(events), scope: 'Known signed-in accounts; production events only. Step reach, not a sequential funnel.' };
            }),
            optionalSource(env.REVENUECAT_SECRET_API_KEY, async signal => {
                const result = await jsonRequest(`https://api.revenuecat.com/v2/projects/${encodeURIComponent(env.REVENUECAT_PROJECT_ID || 'projb2ec85a8')}/metrics/overview?currency=USD`, env.REVENUECAT_SECRET_API_KEY, undefined, signal);
                if (!Array.isArray(result.metrics)) throw new Error('Invalid billing response');
                // Use RevenueCat's own MRR; lifetime proceeds are NOT monthly revenue.
                return { currency: result.currency, metrics: result.metrics.filter(m => ['mrr', 'active_subscriptions', 'active_trials', 'revenue'].includes(m.id)).map(m => ({ id: m.id, name: m.name, value: m.value, period: m.period, unit: m.unit, updatedAt: m.last_updated_at_iso8601 })) };
            }),
            optionalSource(env.VERCEL_TOKEN && env.VERCEL_PROJECT_ID, async signal => {
                const params = new URLSearchParams({ projectId: env.VERCEL_PROJECT_ID, environment: 'production', since: start, until: end });
                if (env.VERCEL_TEAM_ID) params.set('teamId', env.VERCEL_TEAM_ID);
                const result = await jsonRequest(`https://api.vercel.com/v1/query/web-analytics/visits/count?${params}`, env.VERCEL_TOKEN, undefined, signal);
                if (!Number.isFinite(result.data?.visitors) || !Number.isFinite(result.data?.pageviews)) throw new Error('Invalid web analytics');
                if (!result.query?.since || !result.query?.until || Math.abs(Date.parse(result.query.since) - Date.parse(start)) > 60000 || Math.abs(Date.parse(result.query.until) - now) > 60000) throw new Error('Web analytics window mismatch');
                return { visitors: result.data.visitors, pageviews: result.data.pageviews };
            }),
            optionalSource(true, async signal => {
                const rows = await readAll(() => supabase.from('email_events').select('id,email_id,event_type,recipient,occurred_at').gte('occurred_at', start).lt('occurred_at', end).order('id').abortSignal(signal));
                const counts = {};
                for (const row of rows) {
                    if (isExcludedEmail(row.recipient)) continue;
                    if (!counts[row.event_type]) counts[row.event_type] = new Set();
                    if (row.email_id) counts[row.event_type].add(row.email_id);
                }
                return { counts: Object.fromEntries(Object.entries(counts).map(([key, ids]) => [key, ids.size])), coverageStartsAt: '2026-08-26', partial: start < '2026-08-26T00:00:00.000Z' };
            }),
            optionalSource(env.REVENUECAT_SECRET_API_KEY, async signal => {
                const base = `https://api.revenuecat.com/v2/projects/${encodeURIComponent(env.REVENUECAT_PROJECT_ID || 'projb2ec85a8')}/charts`;
                const key = env.REVENUECAT_SECRET_API_KEY;
                const chartEnd = new Date(now - DAY).toISOString().slice(0, 10);
                const summaries = {};
                for (const chart of ['trial_conversion_rate', 'actives_new']) {
                    if (!chartOptions.has(chart)) chartOptions.set(chart, await jsonRequest(`${base}/${chart}/options`, key, undefined, signal));
                    const options = chartOptions.get(chart);
                    if (!options.resolutions?.some(r => r.id === '0') || !options.filters?.find(f => f.id === 'store')?.options?.some(o => o.id === 'app_store')) throw new Error('Unsupported billing chart');
                    const params = new URLSearchParams({ start_date: start.slice(0, 10), end_date: chartEnd, resolution: '0', currency: 'USD', filters: JSON.stringify([{ name: 'store', values: ['app_store', 'play_store'] }]) });
                    const result = await jsonRequest(`${base}/${chart}?${params}`, key, undefined, signal);
                    if (!result.summary?.total || result.unsupported_params?.filters?.length) throw new Error('Invalid billing chart');
                    summaries[chart] = result.summary.total;
                }
                const trials = summaries.trial_conversion_rate;
                const paid = summaries.actives_new;
                const required = ['Trial Starts', 'Conversions', 'Expirations', 'Pending'];
                if (!required.every(k => Number.isFinite(trials[k])) || !Number.isFinite(paid['Total Paid Subscriptions'])) throw new Error('Incomplete billing metrics');
                // RevenueCat Charts contain production transactions only; exclude Test Store explicitly.
                return { start: start.slice(0, 10), end: chartEnd, scope: 'production', scopeVerified: true, stores: ['app_store', 'play_store'],
                    trials: { started: trials['Trial Starts'], converted: trials.Conversions, expired: trials.Expirations, pending: trials.Pending,
                        percent: trials.Pending === 0 && trials['Trial Starts'] > 0 ? trials.Conversions / trials['Trial Starts'] * 100 : null },
                    paid: { total: paid['Total Paid Subscriptions'], conversions: paid['Trial Conversions'], direct: paid['Direct Subscriptions'], resubscriptions: paid.Resubscriptions, productChanges: paid['Product Changes'] } };
            }),
        ]);
        const metrics = buildMarketingMetrics(profiles, dreams, days, now, posthog.data?.attribution || []);
        // Individual IDs are used for joins in memory, never returned to the browser.
        if (posthog.data) delete posthog.data.attribution;
        return { ...metrics, generatedAt: new Date().toISOString(), excludedAccounts: excluded.size, sources: { posthog, revenuecat, web, email, billingCohorts } };
    }
    return async (days, { coreOnly = false, end: endAt = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z' } = {}) => {
        const key = `${days}:${endAt}`;
        if (coreOnly) {
            const { profiles, dreams, now, excluded } = await getCore(days, endAt);
            return { ...buildMarketingMetrics(profiles, dreams, days, now), generatedAt: new Date().toISOString(), excludedAccounts: excluded.size,
                sources: Object.fromEntries(['posthog', 'revenuecat', 'web', 'email', 'billingCohorts'].map(name => [name, { status: 'loading', data: null }])) };
        }
        const cached = cache.get(key);
        if (cached && Date.now() - cached.at < cached.ttl) return cached.promise;
        const entry = { at: Date.now(), ttl: 5 * 60000 };
        const promise = collect(days, endAt).then(data => {
            if (Object.values(data.sources).some(source => source.status === 'unavailable')) entry.ttl = 15000;
            return data;
        }).catch(error => { cache.delete(key); throw error; });
        entry.promise = promise;
        if (cache.size >= 12) cache.delete(cache.keys().next().value);
        cache.set(key, entry);
        return promise;
    };
}

module.exports = { createMarketingService, readAll, optionalSource };
