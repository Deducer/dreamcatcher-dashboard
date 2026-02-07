// Store chart instances to destroy before re-creating
let charts = {};
let currentRange = '30d';
let dreamsPage = 1;
let dreamsHasMore = true;
let allDreams = [];

// Helper Functions
function timeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString();
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function getRangeLabel(range) {
    switch (range) {
        case '7d': return 'Last 7 days';
        case '30d': return 'Last 30 days';
        case '90d': return 'Last 90 days';
        case 'all': return 'All time';
        default: return 'Last 30 days';
    }
}

function getComparisonLabel(range) {
    switch (range) {
        case '7d': return 'vs previous 7 days';
        case '30d': return 'vs previous 30 days';
        case '90d': return 'vs previous 90 days';
        case 'all': return '';
        default: return 'vs previous period';
    }
}

function renderTrend(value, previousValue, suffix = '') {
    if (previousValue === 0 || previousValue === undefined) {
        return `<span class="trend trend-neutral">${value}${suffix}</span>`;
    }
    const change = ((value - previousValue) / previousValue) * 100;
    const isUp = change >= 0;
    const icon = isUp ? '&#9650;' : '&#9660;';
    const trendClass = isUp ? 'trend-up' : 'trend-down';
    return `<span class="trend ${trendClass}">${icon} ${Math.abs(change).toFixed(1)}% vs ${previousValue}${suffix}</span>`;
}

// Auth Functions
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
    initTimeFilter();
    loadData();
    loadRecentDreams(true);
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

// Time Filter
function initTimeFilter() {
    const buttons = document.querySelectorAll('.filter-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentRange = btn.dataset.range;
            updatePeriodIndicator();
            loadData();
        });
    });

    // Initialize load more button
    document.getElementById('load-more-btn').addEventListener('click', () => {
        loadRecentDreams(false);
    });
}

function updatePeriodIndicator() {
    document.getElementById('period-label').textContent = getRangeLabel(currentRange);
    const comparison = getComparisonLabel(currentRange);
    document.getElementById('period-comparison').textContent = comparison;
    document.getElementById('period-comparison').style.display = comparison ? 'inline' : 'none';
}

// Data Loading
async function loadData() {
    try {
        const response = await fetch(`/api/stats?range=${currentRange}`);
        const data = await response.json();

        updateOverviewMetrics(data.overview);
        renderGrowthChart(data.timeSeries.dreams);
        renderAcquisitionChart(data.timeSeries.users);
        renderRetentionChart(data.retention);
        renderEmotionChart(data.emotions);
        renderTagsChart(data.tags);
        renderMethodsChart(data.recording_methods);
        renderDowChart(data.day_of_week);

    } catch (e) {
        console.error("Failed to load data", e);
    }
}

async function loadRecentDreams(reset = false) {
    if (reset) {
        dreamsPage = 1;
        allDreams = [];
        document.getElementById('recent-dreams-list').innerHTML = '<div class="loading">Loading recent dreams</div>';
    }

    try {
        const response = await fetch(`/api/recent-dreams?page=${dreamsPage}&limit=10`);
        const data = await response.json();

        allDreams = reset ? data.dreams : [...allDreams, ...data.dreams];
        dreamsHasMore = data.pagination.hasMore;
        dreamsPage++;

        renderRecentDreams(allDreams);

        // Update count and load more button
        document.getElementById('dream-count').textContent = `${data.pagination.total} total`;
        const loadMoreBtn = document.getElementById('load-more-btn');
        loadMoreBtn.style.display = dreamsHasMore ? 'block' : 'none';
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = 'Load More';

    } catch (e) {
        console.error("Failed to load recent dreams", e);
    }
}

function updateOverviewMetrics(overview) {
    // All-time metrics
    document.getElementById('total-dreams').textContent = formatNumber(overview.totalDreams);
    document.getElementById('total-users').textContent = formatNumber(overview.totalUsers);
    document.getElementById('avg-dreams').textContent = overview.avgDreamsPerUser.toFixed(1);
    document.getElementById('conversion-rate').textContent = overview.conversionRate + '%';

    // Period metrics with trends
    document.getElementById('dreams-period').textContent = formatNumber(overview.dreamsInPeriod);
    document.getElementById('dreams-period-change').innerHTML = renderTrend(
        overview.dreamsInPeriod,
        overview.prevDreamsCount
    );

    document.getElementById('new-users').textContent = formatNumber(overview.newUsersInPeriod);
    document.getElementById('new-users-change').innerHTML = renderTrend(
        overview.newUsersInPeriod,
        overview.prevNewUsers
    );

    document.getElementById('active-users').textContent = formatNumber(overview.activeUsersInPeriod);
    document.getElementById('active-users-change').innerHTML = renderTrend(
        overview.activeUsersInPeriod,
        overview.prevActiveUsers
    );

    document.getElementById('first-time-dreamers').textContent = formatNumber(overview.firstTimeDreamers);
    document.getElementById('returning-users').textContent = formatNumber(overview.returningUsers);
}

// Chart Rendering Functions
function renderGrowthChart(timeSeries) {
    if (charts.growth) charts.growth.destroy();

    const ctx = document.getElementById('growthChart').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(139, 92, 246, 0.3)');
    gradient.addColorStop(1, 'rgba(139, 92, 246, 0)');

    charts.growth = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeSeries.map(d => formatDate(d.date)),
            datasets: [{
                label: 'Dreams',
                data: timeSeries.map(d => d.count),
                borderColor: '#8b5cf6',
                backgroundColor: gradient,
                fill: true,
                tension: 0.4,
                pointRadius: timeSeries.length > 60 ? 0 : 2,
                pointHoverRadius: 6,
                pointHoverBackgroundColor: '#8b5cf6',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1a1a1a',
                    titleColor: '#f5f5f5',
                    bodyColor: '#a3a3a3',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: '#737373',
                        maxTicksLimit: timeSeries.length > 60 ? 6 : 10,
                        maxRotation: 0
                    }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#737373' },
                    beginAtZero: true
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            }
        }
    });
}

function renderAcquisitionChart(timeSeries) {
    if (charts.acquisition) charts.acquisition.destroy();

    const ctx = document.getElementById('acquisitionChart').getContext('2d');

    charts.acquisition = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: timeSeries.map(d => formatDate(d.date)),
            datasets: [{
                label: 'New Users',
                data: timeSeries.map(d => d.count),
                backgroundColor: '#06b6d4',
                borderRadius: 4,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1a1a1a',
                    titleColor: '#f5f5f5',
                    bodyColor: '#a3a3a3',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: '#737373',
                        maxTicksLimit: timeSeries.length > 60 ? 6 : 10,
                        maxRotation: 0
                    }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#737373', stepSize: 1 },
                    beginAtZero: true
                }
            }
        }
    });
}

function renderRetentionChart(retention) {
    if (charts.retention) charts.retention.destroy();

    const ctx = document.getElementById('retentionChart').getContext('2d');
    const labels = Object.keys(retention);
    const data = Object.values(retention);
    const total = data.reduce((a, b) => a + b, 0);

    charts.retention = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Users',
                data: data,
                backgroundColor: ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b'],
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1a1a1a',
                    titleColor: '#f5f5f5',
                    bodyColor: '#a3a3a3',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: function(context) {
                            const percent = total > 0 ? ((context.raw / total) * 100).toFixed(1) : 0;
                            return `${context.raw} users (${percent}%)`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#737373' },
                    beginAtZero: true
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#a3a3a3' }
                }
            }
        }
    });
}

function renderRecentDreams(dreams) {
    const container = document.getElementById('recent-dreams-list');

    if (!dreams || dreams.length === 0) {
        container.innerHTML = '<div class="loading">No recent dreams</div>';
        return;
    }

    container.innerHTML = dreams.map(dream => `
        <div class="dream-item">
            <div class="dream-avatar">
                ${dream.user.avatar_url
                    ? `<img src="${escapeHtml(dream.user.avatar_url)}" alt="">`
                    : getInitials(dream.user.display_name)
                }
            </div>
            <div class="dream-content">
                <div class="dream-title">${escapeHtml(dream.title)}</div>
                <div class="dream-meta">
                    ${dream.emotion ? `<span class="dream-emotion">${escapeHtml(dream.emotion)}</span>` : ''}
                    <span>${timeAgo(dream.created_at)}</span>
                    <span>${escapeHtml(dream.user.display_name)}</span>
                </div>
            </div>
        </div>
    `).join('');
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
                backgroundColor: ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899'],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#a3a3a3',
                        padding: 16,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: '#1a1a1a',
                    titleColor: '#f5f5f5',
                    bodyColor: '#a3a3a3',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12
                }
            }
        }
    });
}

function renderTagsChart(tags) {
    if (charts.tags) charts.tags.destroy();

    const sortedTags = Object.entries(tags || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

    const ctx = document.getElementById('tagsChart').getContext('2d');

    charts.tags = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedTags.map(t => t[0]),
            datasets: [{
                label: 'Count',
                data: sortedTags.map(t => t[1]),
                backgroundColor: '#06b6d4',
                borderRadius: 4,
                borderSkipped: false
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1a1a1a',
                    titleColor: '#f5f5f5',
                    bodyColor: '#a3a3a3',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12
                }
            },
            scales: {
                y: {
                    grid: { display: false },
                    ticks: { color: '#a3a3a3' }
                },
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#737373' },
                    beginAtZero: true
                }
            }
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
                backgroundColor: ['#8b5cf6', '#06b6d4', '#10b981'],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#a3a3a3',
                        padding: 16,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: '#1a1a1a',
                    titleColor: '#f5f5f5',
                    bodyColor: '#a3a3a3',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12
                }
            }
        }
    });
}

function renderDowChart(dow) {
    if (charts.dow) charts.dow.destroy();

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const data = days.map((_, i) => dow[i] || 0);

    const ctx = document.getElementById('dowChart').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 250);
    gradient.addColorStop(0, 'rgba(16, 185, 129, 0.3)');
    gradient.addColorStop(1, 'rgba(16, 185, 129, 0)');

    charts.dow = new Chart(ctx, {
        type: 'line',
        data: {
            labels: days,
            datasets: [{
                label: 'Dreams',
                data: data,
                borderColor: '#10b981',
                backgroundColor: gradient,
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointBackgroundColor: '#10b981',
                pointBorderColor: '#0a0a0a',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1a1a1a',
                    titleColor: '#f5f5f5',
                    bodyColor: '#a3a3a3',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12
                }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#737373' },
                    beginAtZero: true
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#a3a3a3' }
                }
            }
        }
    });
}

// Initialize
checkAuth();
