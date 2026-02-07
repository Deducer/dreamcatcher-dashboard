// Store chart instances to destroy before re-creating
let charts = {};

async function checkAuth() {
    try {
        const response = await fetch('/api/check-auth');
        const data = await response.json();
        if (data.authenticated) {
            showDashboard();
        } else {
            showLogin();
        }
    } catch (e) {
        showLogin();
    }
}

function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('dashboard-screen').style.display = 'none';
}

function showDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard-screen').style.display = 'block';
    loadData();
}

async function login() {
    const password = document.getElementById('password-input').value;
    const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });
    
    const data = await response.json();
    if (data.success) {
        showDashboard();
    } else {
        document.getElementById('login-error').style.display = 'block';
    }
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    location.reload();
}

async function loadData() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        
        // Update Stats
        document.getElementById('total-dreams').innerText = data.overview.totalDreams || 0;
        document.getElementById('total-users').innerText = data.overview.totalUsers || 0;
        
        // Render Charts
        renderEmotionChart(data.emotions);
        renderTagsChart(data.tags);
        renderMethodsChart(data.recording_methods);
        renderDowChart(data.day_of_week);
        
    } catch (e) {
        console.error("Failed to load data", e);
    }
}

function renderEmotionChart(emotions) {
    if (charts.emotion) charts.emotion.destroy();
    const ctx = document.getElementById('emotionChart').getContext('2d');
    charts.emotion = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(emotions || {}),
            datasets: [{
                data: Object.values(emotions || {}),
                backgroundColor: [
                    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'
                ]
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'right', labels: { color: '#fff' } }
            }
        }
    });
}

function renderTagsChart(tags) {
    if (charts.tags) charts.tags.destroy();
    // Sort and take top 10
    const sortedTags = Object.entries(tags || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const ctx = document.getElementById('tagsChart').getContext('2d');
    charts.tags = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedTags.map(t => t[0]),
            datasets: [{
                label: 'Frequency',
                data: sortedTags.map(t => t[1]),
                backgroundColor: '#36A2EB'
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { ticks: { color: '#fff' }, grid: { color: '#444' } },
                x: { ticks: { color: '#fff' }, grid: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function renderMethodsChart(methods) {
    if (charts.methods) charts.methods.destroy();
    const ctx = document.getElementById('methodsChart').getContext('2d');
    charts.methods = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: Object.keys(methods || {}),
            datasets: [{
                data: Object.values(methods || {}),
                backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56']
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { labels: { color: '#fff' } } }
        }
    });
}

function renderDowChart(dow) {
    if (charts.dow) charts.dow.destroy();
    // Map day numbers (0-6) to names
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const data = days.map((_, i) => dow[i] || 0);

    const ctx = document.getElementById('dowChart').getContext('2d');
    charts.dow = new Chart(ctx, {
        type: 'line',
        data: {
            labels: days,
            datasets: [{
                label: 'Dreams Recorded',
                data: data,
                borderColor: '#4BC0C0',
                tension: 0.1,
                fill: true,
                backgroundColor: 'rgba(75, 192, 192, 0.2)'
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { ticks: { color: '#fff' }, grid: { color: '#444' } },
                x: { ticks: { color: '#fff' }, grid: { color: '#444' } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

// Init
checkAuth();
