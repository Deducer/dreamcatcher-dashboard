const { parse } = require('csv-parse/sync');

const DAY = 86400000;
const APPS = [
    { platform: 'ios', label: 'iOS', id: 'id6762375451' },
    { platform: 'android', label: 'Android', id: 'ai.thedreamcatcher.app' },
];
const EVENT_NAMES = ['rc_initial_purchase_event', 'rc_trial_started_event', 'rc_trial_converted_event', 'rc_trial_cancelled_event', 'rc_renewal_event', 'rc_cancellation_event', 'rc_non_subscription_purchase_event', 'rc_expiration_event', 'rc_billing_issue_event', 'rc_product_change_event'];
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const sum = values => {
    if (!values.length || !values.every(Number.isSafeInteger)) return null;
    const total = values.reduce((a, b) => a + b, 0);
    return Number.isSafeInteger(total) ? total : null;
};

function parseReport(csv, from, through) {
    let headers;
    const records = parse(csv, {
        bom: true, skip_empty_lines: true, max_record_size: 16384, to: 10001,
        columns: names => {
            headers = names.map(name => name.trim());
            if (new Set(headers).size !== headers.length || !['Date', 'Media Source (pid)', 'Campaign (c)', 'Installs'].every(name => headers.includes(name))) throw Error('Invalid report schema');
            return headers;
        },
    });
    if (!headers || records.length > 10000) throw Error('Incomplete report');
    const count = value => {
        if (value == null || /^(?:N\/A|None)?$/i.test(value.trim())) return null;
        if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value))) throw Error('Invalid count');
        return Number(value);
    };
    const dimension = value => (!value || value === 'None' || value === 'N/A') ? null : value;
    const eventHeaders = new Map(EVENT_NAMES.map(name => [name, headers.find(h => h.replace(/\s+/g, '') === name + '(Eventcounter)')]));
    return records.map(row => {
        if (!date(row.Date) || row.Date < from || row.Date > through) throw Error('Invalid report date');
        return {
            date: row.Date, agency: dimension(row['Agency/PMD (af_prt)']),
            mediaSource: dimension(row['Media Source (pid)']), campaign: dimension(row['Campaign (c)']),
            installs: count(row.Installs),
            events: Object.fromEntries([...eventHeaders].map(([name, header]) => [name, header ? count(row[header]) : null])),
        };
    });
}

async function readLimited(response) {
    if (Number(response.headers.get('content-length')) > 4 * 1024 * 1024) throw Error('Report too large');
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > 4 * 1024 * 1024) throw Error('Report too large');
            chunks.push(Buffer.from(value));
        }
    } finally { await reader.cancel().catch(() => {}); }
    return Buffer.concat(chunks).toString('utf8');
}

function createAppsFlyerService({ env = process.env, request = fetch, now = Date.now } = {}) {
    const snapshots = new Map();
    const pilotStart = '2026-09-13';
    const accessUntil = env.APPSFLYER_API_ACCESS_UNTIL || '2026-10-12';
    async function snapshot(app, from, through) {
        const existing = snapshots.get(app.id);
        if (existing && existing.through === through && now() < existing.until) return existing.promise;
        // Cache a single date-grouped snapshot per app, then filter locally.
        // Longer reports have only 24 calls/app/day; date controls must not burn that quota.
        const ttl = (Date.parse(through) - Date.parse(from)) / DAY < 2 ? 10 * 60000 : 4 * 3600000;
        const entry = { through, until: now() + ttl };
        entry.promise = (async () => {
            const checkedAt = new Date(now()).toISOString();
            try {
                let url = new URL(`https://hq1.appsflyer.com/api/agg-data/export/app/${app.id}/partners_by_date_report/v5`);
                url.search = new URLSearchParams({ from, to: through }).toString();
                const signal = AbortSignal.timeout(8000);
                let response;
                for (let redirects = 0; redirects <= 3; redirects++) {
                    response = await request(url.toString(), { redirect: 'manual', headers: { Authorization: 'Bearer ' + env.APPSFLYER_API_TOKEN, Accept: 'text/csv' }, signal });
                    if (![301, 302, 303, 307, 308].includes(response.status)) break;
                    const location = response.headers.get('location');
                    await response.body?.cancel();
                    if (!location || redirects === 3) throw Error('Invalid redirect');
                    url = new URL(location, url);
                    if (url.protocol !== 'https:' || !['hq1.appsflyer.com', 'hq.appsflyer.com'].includes(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) throw Error('Unsafe redirect');
                }
                if (!response.ok) {
                    const body = await readLimited(response);
                    const status = response.status === 429 || /limit reached|call.?limit/i.test(body) ? 'rate_limited' : [401, 402, 403].includes(response.status) ? 'access_unavailable' : 'unavailable';
                    entry.until = now() + 15 * 60000;
                    return { status, checkedAt, rows: null };
                }
                if (!/text\/csv|application\/csv/i.test(response.headers.get('content-type') || '')) throw Error('Unexpected report type');
                const rows = parseReport(await readLimited(response), from, through);
                return { status: 'connected', checkedAt, rows };
            } catch {
                entry.until = now() + 15 * 60000;
                return { status: 'unavailable', checkedAt, rows: null };
            }
        })();
        snapshots.set(app.id, entry);
        return entry.promise;
    }

    return async window => {
        const today = new Date(now()).toISOString().slice(0, 10);
        const snapshotStart = new Date(Math.max(Date.parse(pilotStart), Date.parse(today) - 365 * DAY)).toISOString().slice(0, 10);
        const from = window.start.slice(0, 10), through = new Date(Date.parse(window.end) - 1).toISOString().slice(0, 10);
        const paused = !date(accessUntil) || now() >= Date.parse(accessUntil);
        const status = !env.APPSFLYER_API_TOKEN ? 'not_connected' : paused ? 'paused' : through < snapshotStart ? 'not_collected' : null;
        const base = {
            ...window, provider: 'appsflyer', pilotOnly: true, deviceValidation: 'pending',
            subscriptionValidation: 'pending', partnerPostbacks: 'not_enabled',
            reportBasis: 'install_date_cohort', coverageStart: snapshotStart,
            partialCoverage: from < snapshotStart, apiAccessUntil: accessUntil,
        };
        const platforms = await Promise.all(APPS.map(async app => {
            if (status) return { ...app, status, rows: null, installs: null, events: {} };
            const report = await snapshot(app, snapshotStart, today);
            const rows = report.rows?.filter(row => row.date >= from && row.date <= through) ?? null;
            return {
                ...app, status: report.status, checkedAt: report.checkedAt,
                refreshAfter: new Date(snapshots.get(app.id).until).toISOString(), rows,
                installs: rows ? sum(rows.map(row => row.installs)) : null,
                events: Object.fromEntries(EVENT_NAMES.map(name => [name, rows ? sum(rows.map(row => row.events[name])) : null])),
            };
        }));
        return { ...base, platforms };
    };
}

module.exports = { createAppsFlyerService, parseReport };
