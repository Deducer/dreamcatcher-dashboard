const fs = require('node:fs/promises');
const { readChatgptAds } = require('./chatgpt-ads');
const DAY = 86400000;

function instagramMetrics(payload) {
    const result = {};
    for (const name of ['views', 'reach', 'profile_views', 'website_clicks']) {
        const value = payload.data?.find(row => row.name === name)?.total_value?.value;
        result[name] = Number.isFinite(value) && value >= 0 ? value : null;
    }
    return result;
}

// Postiz remains the owner of OAuth and token refresh. The host sync exposes
// just this one connection in a private, server-only mount; never in an API.
function createChannelService({ env = process.env, fetchImpl = fetch, readFile = fs.readFile, now = Date.now } = {}) {
    const cache = new Map();
    return async window => {
        const chatgpt = await readChatgptAds(window, { env, readFile, now });
        const key = window.start + ':' + window.end;
        const hit = cache.get(key);
        if (hit && now() - hit.at < 15 * 60000) return { ...hit.result, chatgpt };
        let instagram;
        try {
            const c = JSON.parse(await readFile(env.POSTIZ_INSIGHTS_FILE || '/app/data/postiz-instagram.json', 'utf8'));
            if (c.provider !== 'instagram-standalone' || !/^\d+$/.test(c.accountId) || !c.token || c.disabled || c.refreshNeeded || now() - Date.parse(c.syncedAt) > 3600000 || !Number.isFinite(Date.parse(c.syncedAt)) || !Number.isFinite(Date.parse(c.expiresAt)) || Date.parse(c.expiresAt) <= now()) throw Error('Connection refresh required');
            if (Date.parse(window.start) < now() - 90 * DAY) {
                instagram = { status: 'not_collected', data: null, action: 'Choose dates within the last 90 days. Older Instagram insights are not available through this connection.' };
            } else {
                const params = new URLSearchParams({ metric: 'views,reach,profile_views,website_clicks', metric_type: 'total_value', period: 'day', since: Math.floor(Date.parse(window.start) / 1000), until: Math.floor(Date.parse(window.end) / 1000) });
                const response = await fetchImpl(`https://graph.instagram.com/v21.0/${c.accountId}/insights?${params}`, { headers: { Authorization: `Bearer ${c.token}` }, signal: AbortSignal.timeout(12000) });
                if (!response.ok) throw Error('Insights unavailable');
                const data = instagramMetrics(await response.json());
                if (Object.values(data).every(v => v === null)) throw Error('No insights returned');
                instagram = { status: 'connected', data, account: 'DreamCatcher', partial: Object.values(data).some(v => v === null), checkedAt: new Date(now()).toISOString(), source: 'Instagram Insights · Postiz connection' };
            }
        } catch {
            instagram = { status: 'access_unavailable', data: null, action: 'Agent: check the Postiz connection sync. Reconnect Instagram in Postiz if its authorization has expired.' };
        }
        const result = { start: window.start, end: window.end, generatedAt: new Date(now()).toISOString(), instagram,
            tiktok: { status: 'pending_review', data: null, action: 'Ian / Abb: let us know when TikTok approves the app; then we can validate insights access.' },
            chatgpt,
            search: { status: 'planned', data: null, action: 'Connect Search Console when search promotion starts.' } };
        cache.set(key, { at: now(), result });
        if (cache.size > 100) cache.delete(cache.keys().next().value);
        return result;
    };
}
module.exports = { createChannelService, instagramMetrics };
