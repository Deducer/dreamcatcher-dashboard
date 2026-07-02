// Store chart instances to destroy before re-creating
let charts = {};
let currentRange = '30d';
let dreamsPage = 1;
let dreamsHasMore = true;
let allDreams = [];

// Email-level drill-down state
let statsDetails = { firstTimeDreamers: [], returningUsers: [], activeUsers: [], newUsers: [] };
let excludedAccountsCache = null;
let detailViewsInitialized = false;

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

function formatDate(dateString, aggregation = 'day') {
    const date = new Date(dateString);
    if (aggregation === 'month') {
        return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    } else if (aggregation === 'week') {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
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
    initDetailViews();
    loadData();
    loadRecentDreams(true);
    loadExcludedChip();
    initReactivation();
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

        const aggregation = data.timeSeries.aggregation || 'day';

        statsDetails = data.details || { firstTimeDreamers: [], returningUsers: [], activeUsers: [], newUsers: [] };
        updateOverviewMetrics(data.overview);
        renderGrowthChart(data.timeSeries.dreams, aggregation);
        renderAcquisitionChart(data.timeSeries.users, aggregation);
        renderRetentionChart(data.retention);
        renderEmotionChart(data.emotions);
        renderTagsChart(data.tags);
        renderMethodsChart(data.recording_methods);
        renderDowChart(data.day_of_week);

    } catch (e) {
        console.error("Failed to load data", e);
    }
    loadModeration();
}

// Moderation queue — open content reports + AI-flagged dreams, with actions.
async function loadModeration() {
    const section = document.getElementById('moderation-section');
    if (!section) return;
    try {
        const res = await fetch('/api/moderation');
        const data = await res.json();
        const reports = data.reports || [];
        const flagged = data.flaggedDreams || [];
        const total = reports.length + flagged.length;
        document.getElementById('moderation-count').textContent = total;
        section.style.display = total ? '' : 'none';
        if (!total) return;

        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
        const dreamBlock = (d) => d ? `
            <div class="moderation-dream">
                <strong>${esc(d.title || 'Untitled dream')}</strong>
                <span class="moderation-meta">visibility: ${esc(d.visibility)} · status: ${esc(d.moderation_status)}</span>
                <p>${esc(d.content)}</p>
            </div>` : '';

        const rows = [];
        for (const r of reports) {
            rows.push(`
            <div class="moderation-row" data-kind="report" data-id="${esc(r.id)}">
                <div class="moderation-body">
                    <span class="moderation-meta">REPORT · ${esc(r.created_at?.slice(0, 16).replace('T', ' '))} ·
                        by ${esc(r.reporterEmail)}${r.reportedUserEmail ? ` · against ${esc(r.reportedUserEmail)}` : ''}</span>
                    <p><em>${esc(r.reason)}</em></p>
                    ${dreamBlock(r.dream)}
                </div>
                <div class="moderation-actions">
                    ${r.dream && r.dream.moderation_status !== 'blocked'
                        ? `<button data-action="block-dream" data-dream-id="${esc(r.dream.id)}">Block dream</button>` : ''}
                    <button data-action="actioned">Mark actioned</button>
                    <button data-action="dismissed">Dismiss</button>
                </div>
            </div>`);
        }
        for (const d of flagged) {
            rows.push(`
            <div class="moderation-row" data-kind="dream" data-id="${esc(d.id)}">
                <div class="moderation-body">
                    <span class="moderation-meta">AI-FLAGGED · ${esc(d.created_at?.slice(0, 16).replace('T', ' '))} ·
                        by ${esc(d.ownerEmail)}</span>
                    ${dreamBlock(d)}
                </div>
                <div class="moderation-actions">
                    <button data-action="approved">Approve</button>
                    <button data-action="blocked">Block</button>
                </div>
            </div>`);
        }
        const list = document.getElementById('moderation-list');
        list.innerHTML = rows.join('');
        list.querySelectorAll('button[data-action]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const row = btn.closest('.moderation-row');
                const action = btn.dataset.action;
                btn.disabled = true;
                try {
                    if (action === 'block-dream') {
                        await fetch('/api/moderation/action', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ kind: 'dream', id: btn.dataset.dreamId, action: 'blocked' }),
                        });
                        // Blocking the dream resolves the report too.
                        await fetch('/api/moderation/action', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ kind: 'report', id: row.dataset.id, action: 'actioned' }),
                        });
                    } else {
                        await fetch('/api/moderation/action', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ kind: row.dataset.kind, id: row.dataset.id, action }),
                        });
                    }
                } finally {
                    loadModeration();
                }
            });
        });
    } catch (e) {
        console.error('Failed to load moderation queue', e);
    }
}

// Launch re-engagement panel — reactivation of the pre-launch cohort.
function initReactivation() {
    const input = document.getElementById('reactivation-since');
    if (!input) return;
    const saved = localStorage.getItem('reactivationSince');
    if (saved) input.value = saved;
    input.addEventListener('change', () => {
        localStorage.setItem('reactivationSince', input.value);
        loadReactivation();
    });
    loadReactivation();
}

async function loadReactivation() {
    const input = document.getElementById('reactivation-since');
    const hint = document.getElementById('reactivation-hint');
    const since = input ? input.value : '';
    const setVals = (cohort, signedIn, dreamers, siPct, drPct) => {
        document.getElementById('reactivation-cohort').textContent = cohort;
        document.getElementById('reactivation-signedin').textContent = signedIn;
        document.getElementById('reactivation-dreamers').textContent = dreamers;
        document.getElementById('reactivation-signedin-pct').textContent = siPct;
        document.getElementById('reactivation-dreamers-pct').textContent = drPct;
    };
    try {
        const res = await fetch('/api/reactivation' + (since ? `?since=${since}` : ''));
        const d = await res.json();
        if (!d.configured) {
            setVals('-', '-', '-', 'of cohort', 'of cohort');
            if (hint) hint.textContent = 'Pick your launch (send) date above to see how many pre-launch accounts have come back.';
            return;
        }
        if (input && !input.value) input.value = d.since;
        setVals(
            formatNumber(d.cohortSize),
            formatNumber(d.signedIn),
            formatNumber(d.dreamers),
            d.signedInPct + '% of cohort',
            d.dreamersPct + '% of cohort'
        );
        if (hint) hint.textContent = `Of ${formatNumber(d.cohortSize)} accounts that existed before ${d.since}, ${formatNumber(d.signedIn)} signed back in and ${formatNumber(d.dreamers)} logged a dream since.`;
    } catch (e) {
        console.error('Failed to load reactivation', e);
        if (hint) hint.textContent = 'Could not load re-engagement data.';
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

// ============================================================
// Email-level drill-down (bucket cards + excluded accounts)
// ============================================================

function initDetailViews() {
    if (detailViewsInitialized) return;
    detailViewsInitialized = true;

    document.getElementById('card-first-time').addEventListener('click', () => {
        openDetailModal(
            'First-Time Dreamers',
            `${getRangeLabel(currentRange)} — users whose first-ever dream falls in this period`,
            emailRows(statsDetails.firstTimeDreamers),
            statsDetails.firstTimeDreamers.length
        );
    });

    document.getElementById('card-returning').addEventListener('click', () => {
        openDetailModal(
            'Returning Users',
            `${getRangeLabel(currentRange)} — dreamed before this period and came back`,
            emailRows(statsDetails.returningUsers),
            statsDetails.returningUsers.length
        );
    });

    document.getElementById('card-new').addEventListener('click', () => {
        openDetailModal(
            'New Users',
            `${getRangeLabel(currentRange)} — accounts created in this period`,
            emailRows(statsDetails.newUsers),
            (statsDetails.newUsers || []).length
        );
    });

    document.getElementById('card-active').addEventListener('click', () => {
        openDetailModal(
            'Active Users',
            `${getRangeLabel(currentRange)} — logged at least one dream in this period`,
            emailRows(statsDetails.activeUsers),
            (statsDetails.activeUsers || []).length
        );
    });

    document.getElementById('excluded-chip').addEventListener('click', showExcludedAccounts);

    // Close interactions
    document.getElementById('detail-modal-close').addEventListener('click', closeDetailModal);
    document.getElementById('detail-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'detail-overlay') closeDetailModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDetailModal();
    });
}

function emailRows(emails) {
    if (!emails || emails.length === 0) {
        return '<div class="detail-empty">No accounts in this bucket for the selected period.</div>';
    }
    return emails.map(email => `
        <div class="email-row">
            <span class="email-addr">${escapeHtml(email)}</span>
        </div>
    `).join('');
}

function openDetailModal(title, subtitle, bodyHtml, count) {
    const titleEl = document.getElementById('detail-modal-title');
    titleEl.textContent = count !== undefined ? `${title} (${count})` : title;
    document.getElementById('detail-modal-subtitle').textContent = subtitle || '';
    document.getElementById('detail-modal-body').innerHTML = bodyHtml;
    document.getElementById('detail-overlay').style.display = 'flex';
}

function closeDetailModal() {
    document.getElementById('detail-overlay').style.display = 'none';
}

async function loadExcludedChip() {
    try {
        if (!excludedAccountsCache) {
            const res = await fetch('/api/excluded-accounts');
            excludedAccountsCache = await res.json();
        }
        document.getElementById('excluded-chip-count').textContent = excludedAccountsCache.count;
    } catch (e) {
        console.error('Failed to load excluded accounts', e);
    }
}

async function showExcludedAccounts() {
    try {
        if (!excludedAccountsCache) {
            const res = await fetch('/api/excluded-accounts');
            excludedAccountsCache = await res.json();
        }
        const { accounts, totalExcludedDreams } = excludedAccountsCache;
        const rows = accounts.map(a => `
            <div class="email-row">
                <span class="email-addr">${escapeHtml(a.email)}</span>
                <span class="email-meta">${a.username ? escapeHtml(a.username) + ' · ' : ''}${a.dreams} dream${a.dreams === 1 ? '' : 's'}</span>
            </div>
        `).join('');
        openDetailModal(
            'Excluded Accounts',
            `Filtered from every metric (display-only) — ${totalExcludedDreams} dreams hidden`,
            rows,
            accounts.length
        );
    } catch (e) {
        console.error('Failed to show excluded accounts', e);
    }
}

// Chart Rendering Functions
function renderGrowthChart(timeSeries, aggregation = 'day') {
    if (charts.growth) charts.growth.destroy();

    const ctx = document.getElementById('growthChart').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(139, 92, 246, 0.3)');
    gradient.addColorStop(1, 'rgba(139, 92, 246, 0)');

    const labelSuffix = aggregation === 'month' ? ' (monthly)' : aggregation === 'week' ? ' (weekly)' : '';

    charts.growth = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeSeries.map(d => formatDate(d.date, aggregation)),
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

function renderAcquisitionChart(timeSeries, aggregation = 'day') {
    if (charts.acquisition) charts.acquisition.destroy();

    const ctx = document.getElementById('acquisitionChart').getContext('2d');

    charts.acquisition = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: timeSeries.map(d => formatDate(d.date, aggregation)),
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
            <div class="dream-content" style="flex: 1;">
                <div class="dream-title">${escapeHtml(dream.title)}</div>
                <div class="dream-meta">
                    ${dream.emotion ? `<span class="dream-emotion">${escapeHtml(dream.emotion)}</span>` : ''}
                    <span>${timeAgo(dream.created_at)}</span>
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
