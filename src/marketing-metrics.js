const DAY = 86400000;
const rate = (n, d) => ({ count: n, eligible: d, percent: d ? n / d * 100 : null });
const inWindow = (t, start, end) => t >= start && t < end;

// A cohort is evaluated as of its period end, giving both comparison periods
// identical observation budgets. Immature users never become failures.
function cohortMetrics(profiles, dreams, start, end) {
    const cohort = profiles.filter(p => inWindow(Date.parse(p.created_at), start, end));
    const profileIds = new Set(profiles.map(p => p.id));
    const byUser = new Map();
    for (const d of dreams) {
        if (!profileIds.has(d.user_id)) continue;
        const ts = Date.parse(d.created_at);
        if (!byUser.has(d.user_id)) byUser.set(d.user_id, []);
        byUser.get(d.user_id).push(ts);
    }
    function returned(fromDay, toDay) {
        const eligible = cohort.filter(p => Date.parse(p.created_at) + toDay * DAY <= end);
        const count = eligible.filter(p => {
            const joined = Date.parse(p.created_at);
            return (byUser.get(p.id) || []).some(t => inWindow(t, joined + fromDay * DAY, joined + toDay * DAY));
        }).length;
        return { ...rate(count, eligible.length), pending: cohort.length - eligible.length };
    }
    const activeDays = new Map();
    for (const [id, times] of byUser) {
        const days = new Set(times.filter(t => inWindow(t, start, end)).map(t => new Date(t).toISOString().slice(0, 10)));
        if (days.size) activeDays.set(id, days.size);
    }
    return {
        signups: cohort.length,
        activation: returned(0, 2),
        week2: returned(7, 14),
        week5: returned(28, 35),
        dreamers: activeDays.size,
        repeatDreamers: [...activeDays.values()].filter(n => n >= 2).length,
    };
}

function buildMarketingMetrics(profiles, dreams, days, now = Date.now(), attribution = []) {
    const end = now;
    const start = end - days * DAY;
    const priorStart = start - days * DAY;
    const known = new Set(profiles.map(p => p.id));
    dreams = dreams.filter(d => known.has(d.user_id));
    const current = cohortMetrics(profiles, dreams, start, end);
    const prior = cohortMetrics(profiles, dreams, priorStart, start);
    const weekly = [];
    // UTC Monday cohorts; include all cohorts intersecting the selected range.
    const monday = new Date(start);
    monday.setUTCHours(0, 0, 0, 0);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    for (let at = +monday; at < end; at += 7 * DAY) {
        const members = profiles.filter(p => inWindow(Date.parse(p.created_at), Math.max(at, start), Math.min(at + 7 * DAY, end)));
        const metrics = cohortMetrics(members, dreams, Math.max(at, start), end);
        weekly.push({ week: new Date(at).toISOString().slice(0, 10), partial: at < start || at + 7 * DAY > end, ...metrics });
    }
    const attr = new Map(attribution.map(a => [a.id, a]));
    const normalize = value => !value || ['skipped', '(not set)', 'null'].includes(value) ? 'Unknown' : value;
    function channels(field) {
        const groups = new Map();
        for (const p of profiles.filter(p => inWindow(Date.parse(p.created_at), start, end))) {
            const source = normalize(attr.get(p.id)?.[field]);
            if (!groups.has(source)) groups.set(source, []);
            groups.get(source).push(p);
        }
        return [...groups].map(([source, members]) => ({ source, ...cohortMetrics(members, dreams, start, end) }))
            .sort((a, b) => b.signups - a.signups);
    }
    const currentWeek = cohortMetrics(profiles, dreams, now - 7 * DAY, now);
    const previousWeek = cohortMetrics(profiles, dreams, now - 14 * DAY, now - 7 * DAY);
    return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), days, current, prior,
        weekly: weekly.reverse(), weeklyHabit: { current: currentWeek.repeatDreamers, prior: previousWeek.repeatDreamers },
        channels: { reported: channels('reported'), observed: channels('observed') } };
}

module.exports = { DAY, rate, cohortMetrics, buildMarketingMetrics };
