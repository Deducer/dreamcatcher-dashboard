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
        res.cookie('dashboard_auth', password, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
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

        // For "all" range, find the earliest data point first
        let earliestDate = null;
        if (range === 'all') {
            const [earliestProfile, earliestDream] = await Promise.all([
                supabase.from('profiles').select('created_at').order('created_at', { ascending: true }).limit(1),
                supabase.from('dreams').select('created_at').order('created_at', { ascending: true }).limit(1)
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

        // Fetch all data in parallel
        const queries = [
            // Existing RPC for emotions, tags, etc.
            supabase.rpc('get_dream_statistics'),

            // Total users (all time)
            supabase.from('profiles').select('*', { count: 'exact', head: true }),

            // Total dreams (all time)
            supabase.from('dreams').select('*', { count: 'exact', head: true }),

            // Dreams in current period
            supabase.from('dreams')
                .select('created_at, user_id')
                .gte('created_at', start.toISOString())
                .lte('created_at', end.toISOString()),

            // Users in current period
            supabase.from('profiles')
                .select('id, created_at')
                .gte('created_at', start.toISOString())
                .lte('created_at', end.toISOString()),

            // User retention buckets (all time)
            supabase.from('dreams').select('user_id'),

            // All users with their first dream date
            supabase.from('profiles').select('id, created_at'),

            // All dreams for first-time dreamer calculation
            supabase.from('dreams')
                .select('user_id, created_at')
                .order('created_at', { ascending: true }),
        ];

        // Add previous period queries if not "all time"
        if (prevStart && prevEnd) {
            queries.push(
                // Dreams in previous period
                supabase.from('dreams')
                    .select('created_at, user_id')
                    .gte('created_at', prevStart.toISOString())
                    .lt('created_at', prevEnd.toISOString()),

                // Users in previous period
                supabase.from('profiles')
                    .select('*', { count: 'exact', head: true })
                    .gte('created_at', prevStart.toISOString())
                    .lt('created_at', prevEnd.toISOString())
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

        // Count first-time dreamers in current period
        let firstTimeDreamers = 0;
        Object.values(userFirstDream).forEach(firstDreamDate => {
            const date = new Date(firstDreamDate);
            if (date >= start && date <= end) {
                firstTimeDreamers++;
            }
        });

        // Returning users (users who had dreamed before this period and dreamed again in this period)
        const usersWhoDreamedBefore = new Set();
        allDreams.forEach(d => {
            const date = new Date(d.created_at);
            if (date < start) {
                usersWhoDreamedBefore.add(d.user_id);
            }
        });

        let returningUsers = 0;
        activeUserIds.forEach(userId => {
            if (usersWhoDreamedBefore.has(userId)) {
                returningUsers++;
            }
        });

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

        // Response
        const dashboardData = {
            range,
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

        const { data: dreams, error, count } = await supabase
            .from('dreams')
            .select('id, title, created_at, emotions', { count: 'exact' })
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
