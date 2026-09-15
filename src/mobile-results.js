const { parse } = require('csv-parse/sync');
const { createHash } = require('node:crypto');
const { quotaReset } = require('./appsflyer-quota');
const DAY = 86400000;
const APPS = [{ platform: 'ios', label: 'iOS', id: 'id6762375451' }, { platform: 'android', label: 'Android', id: 'ai.thedreamcatcher.app' }];
const REPORTS = [
    ['installs_report', 'install', false], ['organic_installs_report', 'install', true],
    ['in_app_events_report', 'event', false], ['organic_in_app_events_report', 'event', true],
    ['reinstalls', 'reinstall', false], ['reinstalls_organic', 'reinstall', true],
];
const empty = value => !value || /^(none|n\/a)$/i.test(value) ? null : value;
function timestamp(value) {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value || '')) throw Error('Invalid UTC timestamp');
    const result = new Date(value.replace(' ', 'T') + 'Z');
    if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value.slice(0, 10)) throw Error('Invalid UTC date');
    return result.toISOString();
}
function parseActivity(csv, report, from, end) {
    let headers;
    const records = parse(csv, { bom: true, skip_empty_lines: true, max_record_size: 65536, to: 10001,
        columns: names => {
            headers = names.map(n => n.trim());
            if (new Set(headers).size !== headers.length || !['AppsFlyer ID', 'Event Time', 'Event Name', 'Media Source', 'Campaign'].every(n => headers.includes(n))) throw Error('Invalid activity schema');
            return headers;
        } });
    if (!headers || records.length >= 10000) throw Error('Incomplete activity report');
    return records.filter(r => r['Is Primary Attribution']?.toLowerCase() !== 'false').map(r => {
        const at = timestamp(r['Event Time']);
        if (at < from || at >= end) throw Error('Activity outside request window');
        const value = empty(r['Event Revenue USD']);
        if (value !== null && (!/^-?\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))) throw Error('Invalid revenue');
        const source = empty(r['Media Source']) || (report[2] ? 'Organic' : null);
        const campaign = empty(r.Campaign);
        return { at, kind: report[1], event: r['Event Name'], source, campaign,
            valueUsd: value === null ? null : Number(value), version: empty(r['App Version']),
            device: r['AppsFlyer ID'], customer: r['Customer User ID'],
            key: createHash('sha256').update(JSON.stringify([report[1], r['AppsFlyer ID'], at, r['Event Name'], r['Event Value'], source, campaign])).digest('hex') };
    });
}
async function limitedBody(response) {
    if (Number(response.headers.get('content-length')) > 4 * 1024 * 1024) throw Error('Too large');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4 * 1024 * 1024) throw Error('Too large'); chunks.push(Buffer.from(value)); } }
    finally { await reader.cancel().catch(() => {}); }
    return Buffer.concat(chunks).toString('utf8');
}
async function rawReport({ request, token, app, report, from, end, now = Date.now() }) {
    let url = new URL(`https://hq1.appsflyer.com/api/raw-data/export/app/${app.id}/${report[0]}/v5`);
    url.search = new URLSearchParams({ from: from.slice(0,19).replace('T',' '), to: end.slice(0,19).replace('T',' '), maximum_rows: '200000' });
    const signal = AbortSignal.timeout(12000);
    for (let i = 0; i < 4; i++) {
        // Signed raw-data redirects are credentialed by the URL, never our bearer token.
        const headers = url.hostname === 'rawdata.appsflyer.com' ? {} : { Authorization: 'Bearer ' + token };
        const response = await request(url.toString(), { headers, redirect: 'manual', signal });
        if ([301,302,303,307,308].includes(response.status)) {
            const location = response.headers.get('location'); await response.body?.cancel();
            if (!location) throw Error('Missing redirect'); url = new URL(location, url);
            if (url.protocol !== 'https:' || !['hq1.appsflyer.com','hq.appsflyer.com','rawdata.appsflyer.com'].includes(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) throw Error('Unsafe redirect');
            continue;
        }
        if (!response.ok) {
            const body = await limitedBody(response);
            const quota = quotaReset(response.status, body, now);
            return { quotaResetsAt: quota.resetAt, status: quota.limited ? 'rate_limited' : [401,402,403].includes(response.status) || /subscription package|doesn.t include|upgrade|permission denied/i.test(body) ? 'access_unavailable' : 'unavailable', rows: [] };
        }
        if (!/text\/csv|application\/csv|application\/octet-stream/i.test(response.headers.get('content-type') || '')) throw Error('Invalid response type');
        return { status: 'connected', rows: parseActivity(await limitedBody(response), report, from, end) };
    }
    throw Error('Too many redirects');
}
const VALIDATION = {
    reviewedAt: '2026-09-15', source: 'Reviewed device and provider evidence; independent of the selected date range',
    recordUrl: 'https://github.com/Project-Win-Inc/project-win/blob/production/1_tasks/ian-set-up-mmp-attribution.md',
    platforms: [
        { label: 'Android', build: '1.1.4 (35)', device: 'Passed · SDK receipt matched', subscription: 'Passed · sandbox initial purchase received by AppsFlyer, Sep 15 14:07 UTC', restore: 'Passed · restored and Premium retained after reopening (Ian confirmed)', campaign: 'Passed · AppsFlyer attributed the Sep 15 16:46 UTC install to dc_android_attribution_20260915 (checked 17:09 UTC); downstream conversion still pending' },
        { label: 'iOS', build: '1.1.4 (54)', device: 'Passed · SDK receipt matched', subscription: 'Passed · sandbox renewal received by AppsFlyer, Sep 15 15:38 UTC; clean first purchase/trial not yet tested', restore: 'Passed · restored and Premium retained after reopening (Ian confirmed)', campaign: 'Pending · supported iOS campaign/install test still required' },
    ],
    partner: 'ChatGPT Ads delivery is not enabled. QA isolation and partner mapping/receipt must pass first.',
};
function summarize(platform, results, window, excludedIds) {
    const devices = new Set(results.flatMap(r => r.rows).filter(r => excludedIds.has(r.customer)).map(r => r.device).filter(Boolean));
    const unique = new Map();
    for (const r of results.flatMap(r => r.rows)) {
        if (r.at < window.start || r.at >= window.end) continue;
        const qa = excludedIds.has(r.customer) || devices.has(r.device) || /^(dc_qa|qa_validation|ios_testing|test)$/i.test(r.source || '') || /^(dc_.*attribution_|analytics_setup|qa_)/i.test(r.campaign || '');
        const { device, customer, key, ...safe } = r;
        unique.set(key, { ...safe, classification: qa ? 'qa' : 'unclassified' });
    }
    const rows = [...unique.values()].sort((a,b) => b.at.localeCompare(a.at));
    const complete = results.every(r => r.status === 'connected');
    const counts = group => {
        const selected = rows.filter(r => r.classification === group);
        const count = kind => REPORTS.filter(r=>r[1]===kind).every(r=>results.some(result=>result.name===r[0]&&result.status==='connected')) ? selected.filter(r=>r.kind===kind).length : null;
        return { installs:count('install'), reinstalls:count('reinstall'), events:count('event') };
    };
    return { ...platform, status: complete ? 'connected' : results.some(r=>r.status === 'connected') ? 'partial' : results[0]?.status || 'unavailable',
        reports: results.map(({name,status,checkedAt,refreshAfter,quotaResetsAt})=>({name,status,checkedAt,refreshAfter,quotaResetsAt})),
        qa: counts('qa'), unclassified: counts('unclassified'), rowCount: rows.length, rows: rows.slice(0,200), truncatedDisplay: rows.length > 200 };
}
function createMobileResultsService({ env = process.env, request = fetch, now = Date.now, getExcludedIds = async () => new Set() } = {}) {
    const cache = new Map(); let handoffCache;
    async function snapshot(app, report, from, end) {
        const key = app.id + ':' + report[0]; const prior = cache.get(key);
        if (prior && now() < prior.until) return prior.promise;
        const entry = { until: now() + 4 * 3600000 };
        entry.promise = (async () => {
            let value;
            try { value = await rawReport({request,token:env.APPSFLYER_API_TOKEN,app,report,from,end,now:now()}); }
            catch { value = { status:'unavailable', rows:[] }; }
            if (value.quotaResetsAt) entry.until = Date.parse(value.quotaResetsAt);
            return {...value, name:report[0], checkedAt:new Date(now()).toISOString(), refreshAfter:new Date(entry.until).toISOString()};
        })(); cache.set(key, entry); return entry.promise;
    }
    async function handoffs(from, end) {
        if (!env.POSTHOG_PERSONAL_API_KEY) return {status:'not_connected', rows:[]};
        if (handoffCache && now() < handoffCache.until) return handoffCache.promise;
        handoffCache = { until:now()+15*60000, promise:(async()=>{
            try {
                const query = `SELECT timestamp, properties.referrer FROM events WHERE event = 'install referrer captured' AND timestamp >= toDateTime('${from.slice(0,19).replace('T',' ')}', 'UTC') AND timestamp < toDateTime('${end.slice(0,19).replace('T',' ')}', 'UTC') ORDER BY timestamp DESC LIMIT 10001`;
                const r=await request(`https://us.posthog.com/api/projects/${encodeURIComponent(env.POSTHOG_PROJECT_ID || '452799')}/query/`,{method:'POST',headers:{Authorization:'Bearer '+env.POSTHOG_PERSONAL_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({query:{kind:'HogQLQuery',query}}),signal:AbortSignal.timeout(10000)});
                if(!r.ok) { await r.body?.cancel(); throw Error('Handoff unavailable'); }
                const d=JSON.parse(await limitedBody(r)); if(!Array.isArray(d.results)||d.results.length>=10000||d.hasMore||d.has_more)throw Error('Incomplete handoffs');
                return {status:'connected',checkedAt:new Date(now()).toISOString(),rows:d.results.map(([at,ref])=>{const p=new URLSearchParams(ref||''); return {at:new Date(at).toISOString(),source:p.get('pid')||p.get('utm_source')||null,campaign:p.get('c')||p.get('utm_campaign')||null,clickIdPresent:p.has('af_tranid')};})};
            } catch {return {status:'unavailable',rows:[]};}
        })() }; return handoffCache.promise;
    }
    return async window => {
        const end = new Date(Math.floor(now()/1000)*1000).toISOString();
        const from = new Date(Math.max(Date.parse('2026-09-13'),Date.parse(end.slice(0,10))-30*DAY)).toISOString();
        const paused = !env.APPSFLYER_API_ACCESS_UNTIL ? now() >= Date.parse('2026-10-12') : !Number.isFinite(Date.parse(env.APPSFLYER_API_ACCESS_UNTIL)) || now() >= Date.parse(env.APPSFLYER_API_ACCESS_UNTIL);
        const state = !env.APPSFLYER_API_TOKEN ? 'not_connected' : paused ? 'paused' : window.end <= from ? 'not_collected' : null;
        let excluded = new Set(), exclusionsAvailable = true;
        let timer;
        try {excluded = await Promise.race([getExcludedIds(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Account lookup timed out')),6000);})]);}
        catch {exclusionsAvailable=false;} finally {clearTimeout(timer);}
        const [platforms,handoff] = await Promise.all([
            Promise.all(APPS.map(async app => {
                const reports = state ? REPORTS.map(r=>({name:r[0],status:state,rows:[]})) : await Promise.all(REPORTS.map(r=>snapshot(app,r,from,end)));
                return summarize(app,reports,window,excluded);
            })), handoffs(from,end),
        ]);
        return { reportBasis:'activity_time', coverageStart:from, coverageEnd:end, partialCoverage:window.start<from,
            exclusionsAvailable, validation:VALIDATION, platforms,
            handoffs:{...handoff, rows:handoff.rows.filter(r=>r.at>=window.start&&r.at<window.end)},
            classificationNote:'QA/internal records are identified by known internal accounts/devices or explicit test campaigns. Other records are unclassified, not verified production. AppsFlyer does not supply the billing environment in these reports. Values are reported event amounts, never business revenue.' };
    };
}
module.exports = {createMobileResultsService,parseActivity,summarize,rawReport,REPORTS};
