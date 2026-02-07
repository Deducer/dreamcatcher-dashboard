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

// Debug: Check if env vars are loaded
console.log('SUPABASE_URL set:', !!supabaseUrl, supabaseUrl ? `(${supabaseUrl.substring(0, 20)}...)` : '');
console.log('SUPABASE_SERVICE_KEY set:', !!supabaseKey, supabaseKey ? `(${supabaseKey.length} chars)` : '');

const supabase = createClient(supabaseUrl, supabaseKey);

// Helper functions
function getStartOfWeek(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function groupByDate(items, dateField = 'created_at') {
    const grouped = {};
    items.forEach(item => {
        const date = new Date(item[dateField]).toISOString().split('T')[0];
        grouped[date] = (grouped[date] || 0) + 1;
    });
    return grouped;
}

function getLast30DaysArray(groupedData) {
    const result = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        result.push({ date: dateStr, count: groupedData[dateStr] || 0 });
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
        res.cookie('dashboard_auth', password, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }); // 1 day
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

// Data Endpoints (Protected)
app.get('/api/stats', authMiddleware, async (req, res) => {
    try {
        const now = new Date();
        const weekStart = getStartOfWeek();
        const lastWeekStart = new Date(weekStart);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // Fetch all data in parallel for performance
        const [
            statsResult,
            totalUsersResult,
            totalDreamsResult,
            activeUsersResult,
            dreamsThisWeekResult,
            dreamsLastWeekResult,
            newUsersThisWeekResult,
            dreams30DaysResult,
            users30DaysResult,
            recentDreamsResult,
            retentionResult
        ] = await Promise.all([
            // Existing RPC for emotions, tags, etc.
            supabase.rpc('get_dream_statistics'),

            // Total users
            supabase.from('profiles').select('*', { count: 'exact', head: true }),

            // Total dreams
            supabase.from('dreams').select('*', { count: 'exact', head: true }),

            // Active users (last 7 days)
            supabase.from('dreams')
                .select('user_id')
                .gte('created_at', sevenDaysAgo.toISOString()),

            // Dreams this week
            supabase.from('dreams')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', weekStart.toISOString()),

            // Dreams last week
            supabase.from('dreams')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', lastWeekStart.toISOString())
                .lt('created_at', weekStart.toISOString()),

            // New users this week
            supabase.from('profiles')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', weekStart.toISOString()),

            // Dreams last 30 days (for time series)
            supabase.from('dreams')
                .select('created_at')
                .gte('created_at', thirtyDaysAgo.toISOString()),

            // Users last 30 days (for time series)
            supabase.from('profiles')
                .select('created_at')
                .gte('created_at', thirtyDaysAgo.toISOString()),

            // Recent dreams with user info
            supabase.from('dreams')
                .select(`
                    id,
                    title,
                    created_at,
                    emotions,
                    profiles:user_id (
                        display_name,
                        avatar_url
                    )
                `)
                .order('created_at', { ascending: false })
                .limit(10),

            // User retention buckets - count dreams per user
            supabase.from('dreams')
                .select('user_id')
        ]);

        // Process results
        const stats = statsResult.data || {};
        const totalUsers = totalUsersResult.count || 0;
        const totalDreams = totalDreamsResult.count || 0;

        // Active users - count unique user_ids
        const activeUserIds = new Set((activeUsersResult.data || []).map(d => d.user_id));
        const activeUsers7Days = activeUserIds.size;

        const dreamsThisWeek = dreamsThisWeekResult.count || 0;
        const dreamsLastWeek = dreamsLastWeekResult.count || 0;
        const newUsersThisWeek = newUsersThisWeekResult.count || 0;

        // Calculate weekly growth percentage
        const weeklyGrowthPercent = dreamsLastWeek > 0
            ? ((dreamsThisWeek - dreamsLastWeek) / dreamsLastWeek) * 100
            : 0;

        // Average dreams per user
        const avgDreamsPerUser = totalUsers > 0 ? totalDreams / totalUsers : 0;

        // Time series data
        const dreamsGrouped = groupByDate(dreams30DaysResult.data || []);
        const usersGrouped = groupByDate(users30DaysResult.data || []);
        const dreams30Days = getLast30DaysArray(dreamsGrouped);
        const users30Days = getLast30DaysArray(usersGrouped);

        // Process recent dreams
        const recentDreams = (recentDreamsResult.data || []).map(dream => ({
            id: dream.id,
            title: dream.title || 'Untitled Dream',
            created_at: dream.created_at,
            emotion: Array.isArray(dream.emotions) && dream.emotions.length > 0 ? dream.emotions[0] : null,
            user: dream.profiles ? {
                display_name: dream.profiles.display_name || 'Anonymous',
                avatar_url: dream.profiles.avatar_url
            } : { display_name: 'Anonymous', avatar_url: null }
        }));

        // Calculate retention buckets
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

        // Combine all data
        const dashboardData = {
            overview: {
                totalDreams,
                totalUsers,
                avgDreamsPerUser: Math.round(avgDreamsPerUser * 100) / 100,
                activeUsers7Days,
                dreamsThisWeek,
                dreamsLastWeek,
                weeklyGrowthPercent: Math.round(weeklyGrowthPercent * 10) / 10,
                newUsersThisWeek
            },
            timeSeries: {
                dreams30Days,
                users30Days
            },
            recentDreams,
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
