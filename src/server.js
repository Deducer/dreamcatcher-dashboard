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
        // Fetch data from Supabase
        // Usage of existing RPC function
        const { data: stats, error: statsError } = await supabase.rpc('get_dream_statistics');
        
        if (statsError) throw statsError;

        // Fetch additional data not covered by RPC if needed
        const { count: totalUsers, error: usersError } = await supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true });

        if (usersError) throw usersError;

        const { count: totalDreams, error: dreamsError } = await supabase
            .from('dreams')
            .select('*', { count: 'exact', head: true });
            
        if (dreamsError) throw dreamsError;

        // Combine data
        const dashboardData = {
            ...stats,
            overview: {
                totalUsers,
                totalDreams
            }
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
