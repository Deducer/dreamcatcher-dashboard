const fs = require('node:fs/promises');
const DAY = 86400000;
const ACCOUNT = 'adacct_6a7209ea372c81a29343ecb7e4b20276';
const dateValid = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

function validateSnapshot(s) {
    if (s?.version !== 1 || s.account?.id !== ACCOUNT || s.account.currency !== 'USD' || !Number.isFinite(Date.parse(s.importedAt)) || s.report?.has_more !== false || !Array.isArray(s.report.data) || !s.report.data.length || !Array.isArray(s.campaigns)) throw Error('Invalid report');
    const seen = new Set();
    for (const r of s.report.data) {
        const key = r.campaign_id + ':' + r.readable_time;
        if (!s.campaigns.some(c => c.id === r.campaign_id) || seen.has(key) || !dateValid(r.readable_time) || !Number.isFinite(r.start_time) || !Number.isFinite(r.end_time) || r.end_time <= r.start_time || r.end_time * 1000 > Date.parse(s.importedAt) || ![r.impressions, r.clicks].every(v => Number.isSafeInteger(v) && v >= 0) || !Number.isFinite(r.spend) || r.spend < 0) throw Error('Invalid report row');
        seen.add(key);
    }
    return s;
}

function projectSnapshot(snapshot, window, now = Date.now()) {
    const s = validateSnapshot(snapshot);
    if (Date.parse(s.importedAt) > now + 300000) throw Error('Future report');
    const metadata = { mode: 'connector_snapshot', account: s.account.name, currency: 'USD', importedAt: s.importedAt, stale: now - Date.parse(s.importedAt) > 36 * 3600000,
        timeBasis: 'Ads account reporting dates; separate from UTC website dates.',
        action: 'Scheduled connector import daily at 8 AM Denver time, with recovery checks for stale reports. Runs on Ian’s Mac; the dashboard reads the latest successful import.' };
    if (window.partialDay) return { ...metadata, status: 'completed_days_only', data: null };
    const from = window.start.slice(0, 10), through = new Date(Date.parse(window.end) - 1).toISOString().slice(0, 10);
    const rows = s.report.data.filter(r => r.readable_time >= from && r.readable_time <= through).sort((a,b) => a.start_time - b.start_time);
    if (!rows.length) return { ...metadata, status: 'not_collected', data: null };
    // A day is complete only when every campaign in this report has an explicit row.
    const byDate = new Map();
    for (const r of rows) { if (!byDate.has(r.readable_time)) byDate.set(r.readable_time, []); byDate.get(r.readable_time).push(r); }
    const complete = [...byDate].filter(([,rs]) => rs.length === s.campaigns.length);
    const sum = rs => ({ impressions: rs.reduce((n,r) => n+r.impressions,0), clicks: rs.reduce((n,r) => n+r.clicks,0), spend: Math.round(rs.reduce((n,r) => n+Math.round(r.spend*100),0))/100 });
    const daily = complete.map(([date,rs]) => ({date,...sum(rs)}));
    if (!daily.length) return {...metadata, status:'not_collected', data:null};
    const included = complete.flatMap(([,rs]) => rs);
    const totals = sum(included);
    return { ...metadata, status: 'connected', data: { ...totals, cpc: totals.clicks ? totals.spend/totals.clicks : null,
        ctr: totals.impressions ? totals.clicks/totals.impressions : null,
        daily, reportedDays: daily.length, from: daily[0].date, through: daily.at(-1).date,
        partial: daily.length !== Math.round((Date.parse(through)-Date.parse(from))/DAY)+1,
        campaigns: s.campaigns.map(c => ({ name:c.name, status:c.status, ...sum(included.filter(r => r.campaign_id === c.id)) })) } };
}

async function readChatgptAds(window, {env=process.env, readFile=fs.readFile, now=Date.now} = {}) {
    try { return projectSnapshot(JSON.parse(await readFile(env.CHATGPT_ADS_REPORT_FILE || '/app/data/chatgpt-ads.json', 'utf8')), window, now()); }
    catch { return { status:'access_unavailable', data:null, action:'Agent: import a validated campaign report through the ChatGPT Ads connector.' }; }
}
module.exports = {validateSnapshot, projectSnapshot, readChatgptAds};
