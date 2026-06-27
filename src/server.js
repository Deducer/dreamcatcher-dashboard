const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

console.log('SUPABASE_URL set:', !!supabaseUrl, supabaseUrl ? `(${supabaseUrl.substring(0, 20)}...)` : '');
console.log('SUPABASE_SERVICE_KEY set:', !!supabaseKey, supabaseKey ? `(${supabaseKey.length} chars)` : '');

const supabase = createClient(supabaseUrl, supabaseKey);

// Internal accounts excluded from all dashboard metrics (founders / test /
// first-party content). DISPLAY-LAYER ONLY — the rows remain in the database.
// NOTE: the get_dream_statistics RPC already excludes these because it only
// counts research_opt_in = true users (none of these have opted in) — so the
// exclusion here only needs to cover the direct profiles/dreams queries.
const EXCLUDED_USER_IDS = [
    '50660950-54f5-485c-be1e-4a0d82d3a7c4', // theiancross@gmail.com (founder)
    '543264f8-23cb-4813-8920-e5bf0541d0f3', // abb.kapoor@gmail.com (founder)
    '6ad6e6b3-1aa6-4437-9931-20e5801e267e', // test@example.com (test)
    '869f0bfe-cf9c-40ef-bb81-ab1fbe37565c', // app-review@thedreamcatcher.ai (review)
    '23293769-d405-4519-a08d-ece0525aef5b', // reviewer@thedreamcatcher.ai (review)
    'f3102dac-b205-4e21-9bad-fe36e1c3aa1e', // review-friend-sol@thedreamcatcher.ai (review)
    'e144c450-f349-45d3-ad22-0b2bfa499a3b', // review-friend-mira@thedreamcatcher.ai (review)
    '89329293-bf46-4001-8372-97b2af77bc08', // featured@thedreamcatcher.ai (featured/demo content)
    'a8b53b63-10d4-43c3-8b1e-9cc61634b960', // test_nxprobe_check@example.com (test)
    'ddec79ec-c32f-4651-83b3-ff2179f41058', // name@example.com (test)
    '9c028f35-03d6-4703-80ab-40c477d27cd3', // thetest@gmail.com (test)
    'f9d50f66-bcf5-4943-9254-8709d2d00952', // test@gmail.com (test)
    '97599fa2-6b28-4c88-bedb-a2fd186d4295', // test@testing.com (test)
];

// Email-pattern exclusion — the DURABLE mechanism. Unlike the static UUID list
// above, these rules automatically catch NEW and plus-addressed accounts (e.g.
// ian+051026@thedreamcatcher.ai, used for testing) the moment they sign up,
// without anyone having to add a UUID by hand.
//   - Any address at one of these domains is internal (our own domain: every
//     founder / review / featured / future address on it).
const EXCLUDED_EMAIL_DOMAINS = ['thedreamcatcher.ai'];
//   - Specific external addresses belonging to the team. Plus-tags and casing
//     are normalized away, so theiancross+anything@gmail.com also matches.
const EXCLUDED_EMAILS = [
    'theiancross@gmail.com',
    'ian@vayulabs.com',
    'ian@creditbuildercard.com',
];

// Lowercase + strip Gmail-style "+tag" sub-addressing so ian+051026@x === ian@x.
function normalizeEmail(email) {
    const [local, domain] = String(email || '').toLowerCase().trim().split('@');
    if (!domain) return '';
    return `${local.split('+')[0]}@${domain}`;
}
function isExcludedEmail(email) {
    const e = String(email || '').toLowerCase().trim();
    const domain = e.split('@')[1];
    if (!domain) return false;
    if (EXCLUDED_EMAIL_DOMAINS.includes(domain)) return true;
    return EXCLUDED_EMAILS.includes(normalizeEmail(e));
}

// The live exclusion set = static UUIDs ∪ every user whose email matches the
// rules above. Refreshed from the cached email map via refreshExcludedIds().
// Seeded with the static IDs so metrics stay filtered before the first refresh.
let EXCLUDED_USER_ID_SET = new Set(EXCLUDED_USER_IDS);
let EXCLUDED_IN_LIST = `(${EXCLUDED_USER_IDS.join(',')})`;
// Apply the exclusion to a query builder. `column` is the user id column on the
// table being queried ('id' for profiles, 'user_id' for dreams).
const excludeInternal = (query, column) => query.not(column, 'in', EXCLUDED_IN_LIST);

// Cached user_id -> email map (emails live in auth.users, not profiles).
// Used to give email-level visibility into metric buckets + the excluded list.
let _emailCache = { map: null, at: 0 };
const EMAIL_CACHE_TTL = 5 * 60 * 1000;
async function getEmailMap() {
    if (_emailCache.map && Date.now() - _emailCache.at < EMAIL_CACHE_TTL) {
        return _emailCache.map;
    }
    const map = {};
    let page = 1;
    while (page <= 50) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
        if (error || !data || !data.users || data.users.length === 0) break;
        data.users.forEach(u => { map[u.id] = u.email; });
        if (data.users.length < 1000) break;
        page++;
    }
    _emailCache = { map, at: Date.now() };
    return map;
}
const emailFor = (map, id) => map[id] || `(unknown · ${String(id).slice(0, 8)})`;

// Recompute the live exclusion set from the (cached) email map: static UUIDs
// plus every account whose email matches the internal rules. Cheap — operates
// in memory on the already-fetched map. Call before running metric queries so
// excludeInternal() filters out newly-created internal/test accounts too.
async function refreshExcludedIds() {
    const map = await getEmailMap();
    const set = new Set(EXCLUDED_USER_IDS);
    for (const [id, email] of Object.entries(map)) {
        if (isExcludedEmail(email)) set.add(id);
    }
    EXCLUDED_USER_ID_SET = set;
    EXCLUDED_IN_LIST = `(${[...set].join(',')})`;
    return set;
}

// Helper functions
function getDateRange(range, earliestDate = null) {
    const now = new Date();
    const end = now;
    let start, prevStart, prevEnd;

    switch (range) {
        case '7d':
            start = new Date(now);
            start.setDate(start.getDate() - 7);
            prevEnd = new Date(start);
            prevStart = new Date(prevEnd);
            prevStart.setDate(prevStart.getDate() - 7);
            break;
        case '30d':
            start = new Date(now);
            start.setDate(start.getDate() - 30);
            prevEnd = new Date(start);
            prevStart = new Date(prevEnd);
            prevStart.setDate(prevStart.getDate() - 30);
            break;
        case '90d':
            start = new Date(now);
            start.setDate(start.getDate() - 90);
            prevEnd = new Date(start);
            prevStart = new Date(prevEnd);
            prevStart.setDate(prevStart.getDate() - 90);
            break;
        case 'all':
            // Use earliest data date or default to 1 year ago
            start = earliestDate ? new Date(earliestDate) : new Date(now);
            if (!earliestDate) {
                start.setFullYear(start.getFullYear() - 1);
            }
            prevStart = null;
            prevEnd = null;
            break;
        default:
            start = new Date(now);
            start.setDate(start.getDate() - 30);
            prevEnd = new Date(start);
            prevStart = new Date(prevEnd);
            prevStart.setDate(prevStart.getDate() - 30);
    }

    return { start, end, prevStart, prevEnd, days: range === 'all' ? null : parseInt(range) || 30 };
}

function groupByDate(items, dateField = 'created_at') {
    const grouped = {};
    items.forEach(item => {
        const date = new Date(item[dateField]).toISOString().split('T')[0];
        grouped[date] = (grouped[date] || 0) + 1;
    });
    return grouped;
}

function getTimeSeriesArray(groupedData, days, aggregation = 'day') {
    const result = [];
    const today = new Date();
    const numDays = days || 30;

    if (aggregation === 'day') {
        for (let i = numDays - 1; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            result.push({ date: dateStr, count: groupedData[dateStr] || 0 });
        }
    } else if (aggregation === 'week') {
        // Group by week
        const numWeeks = Math.ceil(numDays / 7);
        for (let i = numWeeks - 1; i >= 0; i--) {
            const weekEnd = new Date(today);
            weekEnd.setDate(weekEnd.getDate() - (i * 7));
            const weekStart = new Date(weekEnd);
            weekStart.setDate(weekStart.getDate() - 6);

            let weekCount = 0;
            for (let d = 0; d < 7; d++) {
                const date = new Date(weekStart);
                date.setDate(date.getDate() + d);
                const dateStr = date.toISOString().split('T')[0];
                weekCount += groupedData[dateStr] || 0;
            }

            const label = weekStart.toISOString().split('T')[0];
            result.push({ date: label, count: weekCount });
        }
    } else if (aggregation === 'month') {
        // Group by month
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - numDays);

        const months = [];
        let current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        const endMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        while (current <= endMonth) {
            months.push(new Date(current));
            current.setMonth(current.getMonth() + 1);
        }

        months.forEach(monthStart => {
            const monthEnd = new Date(monthStart);
            monthEnd.setMonth(monthEnd.getMonth() + 1);

            let monthCount = 0;
            const d = new Date(monthStart);
            while (d < monthEnd) {
                const dateStr = d.toISOString().split('T')[0];
                monthCount += groupedData[dateStr] || 0;
                d.setDate(d.getDate() + 1);
            }

            result.push({
                date: monthStart.toISOString().split('T')[0],
                count: monthCount
            });
        });
    }

    return result;
}

// Auth Middleware
const authMiddleware = (req, res, next) => {
    const authCookie = req.cookies.dashboard_auth;
    if (authCookie === process.env.DASHBOARD_PASSWORD) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

// Routes

// Login Endpoint
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === process.env.DASHBOARD_PASSWORD) {
        res.cookie('dashboard_auth', password, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000
        });
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

// Logout Endpoint
app.post('/api/logout', (req, res) => {
    res.clearCookie('dashboard_auth');
    res.json({ success: true });
});

// Main Stats Endpoint with time range support
app.get('/api/stats', authMiddleware, async (req, res) => {
    try {
        const range = req.query.range || '30d';

        // Refresh the internal-account exclusion set (static UUIDs + email-rule
        // matches) before any query so new/test accounts are filtered out.
        await refreshExcludedIds();

        // For "all" range, find the earliest data point first
        let earliestDate = null;
        if (range === 'all') {
            const [earliestProfile, earliestDream] = await Promise.all([
                excludeInternal(supabase.from('profiles').select('created_at'), 'id').order('created_at', { ascending: true }).limit(1),
                excludeInternal(supabase.from('dreams').select('created_at'), 'user_id').order('created_at', { ascending: true }).limit(1)
            ]);

            const dates = [
                earliestProfile.data?.[0]?.created_at,
                earliestDream.data?.[0]?.created_at
            ].filter(Boolean).map(d => new Date(d));

            if (dates.length > 0) {
                earliestDate = new Date(Math.min(...dates));
            }
        }

        const { start, end, prevStart, prevEnd, days } = getDateRange(range, earliestDate);

        // Resolve emails in parallel with the stats queries (cached, ~1 request)
        const emailMapPromise = getEmailMap();

        // Fetch all data in parallel
        const queries = [
            // Existing RPC for emotions, tags, etc. (already excludes internal
            // accounts via its research_opt_in filter — see EXCLUDED_USER_IDS note)
            supabase.rpc('get_dream_statistics'),

            // Total users (all time)
            excludeInternal(supabase.from('profiles').select('*', { count: 'exact', head: true }), 'id'),

            // Total dreams (all time)
            excludeInternal(supabase.from('dreams').select('*', { count: 'exact', head: true }), 'user_id'),

            // Dreams in current period
            excludeInternal(supabase.from('dreams')
                .select('created_at, user_id')
                .gte('created_at', start.toISOString())
                .lte('created_at', end.toISOString()), 'user_id'),

            // Users in current period
            excludeInternal(supabase.from('profiles')
                .select('id, created_at')
                .gte('created_at', start.toISOString())
                .lte('created_at', end.toISOString()), 'id'),

            // User retention buckets (all time)
            excludeInternal(supabase.from('dreams').select('user_id'), 'user_id'),

            // All users with their first dream date
            excludeInternal(supabase.from('profiles').select('id, created_at'), 'id'),

            // All dreams for first-time dreamer calculation
            excludeInternal(supabase.from('dreams')
                .select('user_id, created_at')
                .order('created_at', { ascending: true }), 'user_id'),
        ];

        // Add previous period queries if not "all time"
        if (prevStart && prevEnd) {
            queries.push(
                // Dreams in previous period
                excludeInternal(supabase.from('dreams')
                    .select('created_at, user_id')
                    .gte('created_at', prevStart.toISOString())
                    .lt('created_at', prevEnd.toISOString()), 'user_id'),

                // Users in previous period
                excludeInternal(supabase.from('profiles')
                    .select('*', { count: 'exact', head: true })
                    .gte('created_at', prevStart.toISOString())
                    .lt('created_at', prevEnd.toISOString()), 'id')
            );
        }

        const results = await Promise.all(queries);

        const [
            statsResult,
            totalUsersResult,
            totalDreamsResult,
            periodDreamsResult,
            periodUsersResult,
            retentionResult,
            allUsersResult,
            allDreamsForFirstTimeResult,
            prevPeriodDreamsResult,
            prevPeriodUsersResult
        ] = results;

        // Process results
        const stats = statsResult.data || {};
        const totalUsers = totalUsersResult.count || 0;
        const totalDreams = totalDreamsResult.count || 0;

        // Current period metrics
        const periodDreams = periodDreamsResult.data || [];
        const periodUsers = periodUsersResult.data || [];
        const dreamsInPeriod = periodDreams.length;
        const newUsersInPeriod = periodUsers.length;

        // Active users in period
        const activeUserIds = new Set(periodDreams.map(d => d.user_id));
        const activeUsersInPeriod = activeUserIds.size;

        // Previous period metrics
        const prevPeriodDreams = prevPeriodDreamsResult?.data || [];
        const prevDreamsCount = prevPeriodDreams.length;
        const prevNewUsers = prevPeriodUsersResult?.count || 0;
        const prevActiveUserIds = new Set(prevPeriodDreams.map(d => d.user_id));
        const prevActiveUsers = prevActiveUserIds.size;

        // Growth calculations
        const dreamsGrowth = prevDreamsCount > 0
            ? ((dreamsInPeriod - prevDreamsCount) / prevDreamsCount) * 100
            : (dreamsInPeriod > 0 ? 100 : 0);

        const usersGrowth = prevNewUsers > 0
            ? ((newUsersInPeriod - prevNewUsers) / prevNewUsers) * 100
            : (newUsersInPeriod > 0 ? 100 : 0);

        const activeGrowth = prevActiveUsers > 0
            ? ((activeUsersInPeriod - prevActiveUsers) / prevActiveUsers) * 100
            : (activeUsersInPeriod > 0 ? 100 : 0);

        // Average dreams per user
        const avgDreamsPerUser = totalUsers > 0 ? totalDreams / totalUsers : 0;

        // First-time dreamers calculation
        const allDreams = allDreamsForFirstTimeResult.data || [];
        const userFirstDream = {};
        allDreams.forEach(d => {
            if (!userFirstDream[d.user_id]) {
                userFirstDream[d.user_id] = d.created_at;
            }
        });

        // Count first-time dreamers in current period (keep the ids for drill-down)
        const firstTimeDreamerIds = [];
        Object.entries(userFirstDream).forEach(([userId, firstDreamDate]) => {
            const date = new Date(firstDreamDate);
            if (date >= start && date <= end) {
                firstTimeDreamerIds.push(userId);
            }
        });
        const firstTimeDreamers = firstTimeDreamerIds.length;

        // Returning users (users who had dreamed before this period and dreamed again in this period)
        const usersWhoDreamedBefore = new Set();
        allDreams.forEach(d => {
            const date = new Date(d.created_at);
            if (date < start) {
                usersWhoDreamedBefore.add(d.user_id);
            }
        });

        const returningUserIds = [];
        activeUserIds.forEach(userId => {
            if (usersWhoDreamedBefore.has(userId)) {
                returningUserIds.push(userId);
            }
        });
        const returningUsers = returningUserIds.length;

        // Conversion rate (users who signed up and recorded at least one dream)
        const allUsers = allUsersResult.data || [];
        const usersWithDreams = new Set(Object.keys(userFirstDream));
        const conversionRate = allUsers.length > 0
            ? (usersWithDreams.size / allUsers.length) * 100
            : 0;

        // Time series data
        const dreamsGrouped = groupByDate(periodDreams);
        const usersGrouped = groupByDate(periodUsers);
        const chartDays = days || Math.ceil((end - start) / (1000 * 60 * 60 * 24));

        // Choose aggregation based on time range
        let aggregation = 'day';
        if (chartDays > 180) {
            aggregation = 'month';
        } else if (chartDays > 60) {
            aggregation = 'week';
        }

        const dreamsTimeSeries = getTimeSeriesArray(dreamsGrouped, chartDays, aggregation);
        const usersTimeSeries = getTimeSeriesArray(usersGrouped, chartDays, aggregation);

        // Retention buckets
        const userDreamCounts = {};
        (retentionResult.data || []).forEach(d => {
            userDreamCounts[d.user_id] = (userDreamCounts[d.user_id] || 0) + 1;
        });

        const retention = {
            '1 dream': 0,
            '2-5 dreams': 0,
            '6-10 dreams': 0,
            '10+ dreams': 0
        };

        Object.values(userDreamCounts).forEach(count => {
            if (count === 1) retention['1 dream']++;
            else if (count <= 5) retention['2-5 dreams']++;
            else if (count <= 10) retention['6-10 dreams']++;
            else retention['10+ dreams']++;
        });

        // Email-level drill-down for the bucket cards (sorted, case-insensitive)
        const emailMap = await emailMapPromise;
        const toEmailList = ids => ids
            .map(id => emailFor(emailMap, id))
            .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

        // Response
        const dashboardData = {
            range,
            details: {
                firstTimeDreamers: toEmailList(firstTimeDreamerIds),
                returningUsers: toEmailList(returningUserIds),
                activeUsers: toEmailList([...activeUserIds]),
                newUsers: toEmailList(periodUsers.map(u => u.id))
            },
            overview: {
                totalDreams,
                totalUsers,
                avgDreamsPerUser: Math.round(avgDreamsPerUser * 100) / 100,
                dreamsInPeriod,
                newUsersInPeriod,
                activeUsersInPeriod,
                firstTimeDreamers,
                returningUsers,
                conversionRate: Math.round(conversionRate * 10) / 10,
                // Growth comparisons
                dreamsGrowth: Math.round(dreamsGrowth * 10) / 10,
                usersGrowth: Math.round(usersGrowth * 10) / 10,
                activeGrowth: Math.round(activeGrowth * 10) / 10,
                // Previous period values for comparison
                prevDreamsCount,
                prevNewUsers,
                prevActiveUsers
            },
            timeSeries: {
                dreams: dreamsTimeSeries,
                users: usersTimeSeries,
                aggregation: aggregation
            },
            retention,
            emotions: stats.emotions || {},
            tags: stats.tags || {},
            recording_methods: stats.recording_methods || {},
            day_of_week: stats.day_of_week || {}
        };

        res.json(dashboardData);
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// Recent Dreams Endpoint with Pagination
app.get('/api/recent-dreams', authMiddleware, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        await refreshExcludedIds();

        const { data: dreams, error, count } = await excludeInternal(
            supabase
                .from('dreams')
                .select('id, title, created_at, emotions', { count: 'exact' }),
            'user_id')
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        const recentDreams = (dreams || []).map(dream => ({
            id: dream.id,
            title: dream.title || 'Untitled Dream',
            created_at: dream.created_at,
            emotion: Array.isArray(dream.emotions) && dream.emotions.length > 0 ? dream.emotions[0] : null
        }));

        res.json({
            dreams: recentDreams,
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit),
                hasMore: offset + limit < count
            }
        });
    } catch (error) {
        console.error('Error fetching recent dreams:', error);
        res.status(500).json({ error: 'Failed to fetch recent dreams' });
    }
});

// Excluded accounts (display-layer exclusions) — for dashboard visibility
app.get('/api/excluded-accounts', authMiddleware, async (req, res) => {
    try {
        const emailMap = await getEmailMap();
        await refreshExcludedIds();
        const excludedIds = [...EXCLUDED_USER_ID_SET];

        const { data: profs } = await supabase
            .from('profiles')
            .select('id, username')
            .in('id', excludedIds);
        const usernameById = {};
        (profs || []).forEach(p => { usernameById[p.id] = p.username; });

        // Dream counts per excluded account, in parallel
        const counts = await Promise.all(
            excludedIds.map(id =>
                supabase.from('dreams').select('*', { count: 'exact', head: true }).eq('user_id', id)
            )
        );

        const accounts = excludedIds.map((id, i) => ({
            email: emailFor(emailMap, id),
            username: usernameById[id] || null,
            dreams: counts[i].count || 0
        })).sort((a, b) => b.dreams - a.dreams);

        res.json({
            count: accounts.length,
            totalExcludedDreams: accounts.reduce((sum, a) => sum + a.dreams, 0),
            accounts
        });
    } catch (error) {
        console.error('Error fetching excluded accounts:', error);
        res.status(500).json({ error: 'Failed to fetch excluded accounts' });
    }
});

// Launch re-engagement — of the accounts that existed BEFORE the send date, how
// many signed back in / created a dream since. `since` comes from ?since=YYYY-MM-DD
// or the REACTIVATION_SINCE env. Mirrors scripts/track-reactivation.ts (email repo).
app.get('/api/reactivation', authMiddleware, async (req, res) => {
    try {
        const since = req.query.since || process.env.REACTIVATION_SINCE || '';
        if (!since) return res.json({ configured: false });
        const sinceISO = new Date(`${since}T00:00:00Z`).toISOString();

        await refreshExcludedIds();

        // Pull all auth users (id, email, created_at, last_sign_in_at)
        const users = [];
        let page = 1;
        while (page <= 50) {
            const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
            if (error || !data || !data.users || data.users.length === 0) break;
            users.push(...data.users);
            if (data.users.length < 1000) break;
            page++;
        }

        // Cohort = non-internal accounts created before the send date (the people we emailed).
        const cohort = users.filter(u =>
            u.created_at && u.created_at < sinceISO &&
            !EXCLUDED_USER_ID_SET.has(u.id) && !isExcludedEmail(u.email)
        );
        const cohortIds = new Set(cohort.map(u => u.id));
        const signedIn = cohort.filter(u => u.last_sign_in_at && u.last_sign_in_at >= sinceISO).length;

        // Cohort members who created a dream since the send date (paginated).
        const dreamerIds = new Set();
        for (let from = 0; from < 200000; from += 1000) {
            const { data, error } = await excludeInternal(
                supabase.from('dreams').select('user_id, created_at').gte('created_at', sinceISO),
                'user_id'
            ).range(from, from + 999);
            if (error || !data || data.length === 0) break;
            data.forEach(d => { if (cohortIds.has(d.user_id)) dreamerIds.add(d.user_id); });
            if (data.length < 1000) break;
        }

        const pct = n => (cohort.length ? Math.round((n / cohort.length) * 1000) / 10 : 0);
        res.json({
            configured: true,
            since,
            cohortSize: cohort.length,
            signedIn,
            signedInPct: pct(signedIn),
            dreamers: dreamerIds.size,
            dreamersPct: pct(dreamerIds.size),
        });
    } catch (error) {
        console.error('Error fetching reactivation:', error);
        res.status(500).json({ error: 'Failed to fetch reactivation' });
    }
});

// Check Auth Status
app.get('/api/check-auth', (req, res) => {
    const authCookie = req.cookies.dashboard_auth;
    if (authCookie === process.env.DASHBOARD_PASSWORD) {
        res.json({ authenticated: true });
    } else {
        res.json({ authenticated: false });
    }
});

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
