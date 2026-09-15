// AppsFlyer daily export quotas reset at 00:00 UTC, independently of HTTP status.
function quotaReset(status, body, now) {
    const daily = /maximum number[\s\S]*downloaded today|daily[\s_-]*(?:report[\s_-]*)?(?:quota|limit)|quota[\s\S]*per day/i.test(body);
    return { limited: daily || status === 429 || /call.?limit|limit reached/i.test(body),
        resetAt: daily ? new Date(Math.floor(now / 86400000) * 86400000 + 86400000).toISOString() : null };
}
module.exports = { quotaReset };
