let marketingRequest = 0;
let marketingData = null;
let acquisitionData = null;
let productInitialized = false;
const growthEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const growthNumber = value => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 1 }) : '—';
const growthPercent = metric => metric?.percent == null ? '—' : `${metric.percent.toFixed(1)}%`;
const growthSample = metric => metric?.eligible ? `${metric.count} / ${metric.eligible} eligible people${metric.eligible < 30 ? ' · small sample' : ''}` : 'No mature cohort yet';
const sourceStatus = status => ({ connected: 'Connected', not_connected: 'Not connected', unavailable: 'Unavailable for this period', loading: 'Loading…', plan_required: 'Plan upgrade required' })[status] || 'Not connected';

function switchDashboardView(view) {
    const marketing = view === 'marketing';
    document.getElementById('marketing-view').hidden = !marketing;
    document.getElementById('product-view').hidden = marketing;
    document.getElementById('marketing-tab').setAttribute('aria-selected', String(marketing));
    document.getElementById('product-tab').setAttribute('aria-selected', String(!marketing));
    document.querySelector('[data-range="all"]').hidden = marketing;
    if (marketing) {
        if (currentRange === 'all') {
            currentRange = '30d';
            document.querySelectorAll('.filter-btn').forEach(button => button.classList.toggle('active', button.dataset.range === currentRange));
        }
        loadMarketing();
    } else {
        marketingRequest++;
        updatePeriodIndicator();
        loadData();
        if (!productInitialized) { productInitialized = true; loadRecentDreams(true); loadExcludedChip(); initReactivation(); }
    }
}

async function loadMarketing() {
    const request = ++marketingRequest;
    const range = currentRange;
    acquisitionData = null;
    marketingData = null;
    const content = document.getElementById('marketing-content');
    content.hidden = false;
    content.innerHTML = '<div id="acquisition-content"></div><details class="chart-card growth-section" id="acquisition-outcomes"><summary>What happens after acquisition</summary><p class="growth-detail">Registrations, trials and subscriptions help judge traffic quality. These totals are not a matched website-to-app funnel.</p><div id="growth-quality-content"><p class="growth-detail">Loading app and billing outcomes…</p></div></details>';
    document.getElementById('marketing-status').textContent = 'Loading acquisition sources…';
    renderAcquisition();
    const get = async path => {
        const response = await fetch(`${path}?range=${encodeURIComponent(range)}`, { signal: AbortSignal.timeout(15000) });
        if (response.status === 401) { if (request === marketingRequest) showLogin(); throw Error('Auth'); }
        if (!response.ok) throw Error('Unavailable');
        return response.json();
    };
    // Traffic does not depend on Supabase, billing or PostHog finishing.
    await Promise.allSettled([
        (async () => {
            try {
                const data = await get('/api/acquisition');
                if (request !== marketingRequest) return;
                acquisitionData = data;
                renderAcquisition();
                const connected = Object.values(data.sources).filter(s => s.status === 'connected').length;
                document.getElementById('marketing-status').textContent = `${data.days} complete UTC days · ${data.start.slice(0,10)} through ${new Date(Date.parse(data.end)-1).toISOString().slice(0,10)} · Checked ${new Date(data.generatedAt).toLocaleString()} · ${connected}/${Object.keys(data.sources).length} website reports available`;
            } catch {
                if (request !== marketingRequest) return;
                acquisitionData = { sources: Object.fromEntries(['totals','previous','referrers','daily','pages','campaigns','taggedSources'].map(key => [key, {status:'unavailable',data:null}])) };
                renderAcquisition();
                document.getElementById('marketing-status').textContent = 'Website reports could not be loaded. Use Refresh to retry.';
            }
        })(),
        (async () => {
            try {
                const response = await fetch(`/api/marketing?range=${encodeURIComponent(range)}&core=1`, {signal:AbortSignal.timeout(15000)});
                if (response.status === 401) { if (request === marketingRequest) showLogin(); return; }
                if (!response.ok) throw Error('Core unavailable');
                const core = await response.json();
                if (request !== marketingRequest) return;
                marketingData = core;
                renderMarketing(core);
                const data = await get('/api/marketing');
                if (request !== marketingRequest) return;
                marketingData = data;
                renderMarketing(data);
            } catch {
                if (request !== marketingRequest) return;
                if (marketingData) {
                    for (const source of Object.values(marketingData.sources)) if(source.status === 'loading') source.status = 'unavailable';
                    renderMarketing(marketingData);
                } else document.getElementById('growth-quality-content').textContent = 'App outcomes are unavailable. Website reports above load independently.';
            }
        })(),
    ]);
}

function growthCard(label, value, detail, comparison) {
    return `<article class="metric-card"><h3 class="metric-label">${growthEscape(label)}</h3><div class="metric-value">${growthEscape(value)}</div><p class="growth-detail">${growthEscape(detail)}</p>${comparison ? `<p class="growth-comparison">${growthEscape(comparison)}</p>` : ''}</article>`;
}
function reportNotice(source, subject) {
    if (source.status === 'plan_required') return `<div class="acq-empty"><strong>Campaign tags need Vercel Web Analytics Plus</strong><p>Current plan does not expose this report. Referrers are available separately. No upgrade has been purchased.</p></div>`;
    return `<div class="acq-empty"><strong>${sourceStatus(source.status)}</strong><p>${source.status === 'loading' ? `Checking ${subject}…` : `${subject} is not available for this window. Try 7D or 30D, or Refresh. Missing data is not zero.`}</p></div>`;
}
function trafficTable(source, title, emptyLabel, total) {
    if (source.status !== 'connected') return reportNotice(source, title);
    if (!source.data.length) return '<p class="acq-empty">No recorded traffic in this period.</p>';
    return `<div class="growth-table-wrap"><table class="growth-table"><thead><tr><th scope="col">${growthEscape(title)}</th><th scope="col">Visitors</th><th scope="col">Page views</th><th scope="col">Share of views</th></tr></thead><tbody>${source.data.map(row => {
        const share = Number.isFinite(total) && total > 0 ? row.pageviews / total * 100 : null;
        return `<tr><th scope="row" class="acq-source">${growthEscape(row.value || emptyLabel)}</th><td>${growthNumber(row.visitors)}</td><td>${growthNumber(row.pageviews)}</td><td>${share == null ? '—' : `${share.toFixed(1)}%<span class="acq-share"><span style="width:${Math.min(100,share)}%"></span></span>`}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}
function renderAcquisition() {
    const waiting = {status:'loading',data:null};
    const sources = acquisitionData?.sources || {};
    const totals = sources.totals || waiting, previous = sources.previous || waiting;
    const referrers = sources.referrers || waiting, daily = sources.daily || waiting, pages = sources.pages || waiting;
    const campaigns = sources.campaigns || waiting, tags = sources.taggedSources || waiting;
    const total = totals.data?.pageviews;
    const direct = referrers.data?.find(r=>r.value === '')?.pageviews;
    const names = referrers.data?.filter(r=>r.value && r.value.toLowerCase() !== 'others').length;
    const comparison = metric => previous.status === 'connected' ? `${growthNumber(previous.data[metric])} in the previous period` : `Previous period: ${sourceStatus(previous.status).toLowerCase()}`;
    const channelViews = pattern => {
        if (referrers.status !== 'connected') return '—';
        const rows = referrers.data.filter(r=>pattern.test(r.value));
        return rows.length ? growthNumber(rows.reduce((n,r)=>n+r.pageviews,0)) : 'Not in reported rows';
    };
    const max = Math.max(1,...(daily.data || []).map(r=>r.pageviews));
    const channels = [
        ['Instagram','Unclassified referral',channelViews(/(^|\.)instagram\.com$/i),'Views, reach, saves and shares not connected','https://social.projectwin.cloud'],
        ['TikTok','Unclassified referral',channelViews(/(^|\.)tiktok\.com$/i),'Views, reach and watch time not connected','https://social.projectwin.cloud'],
        ['ChatGPT referrals','Unclassified referral',channelViews(/(^|\.)(chatgpt\.com|chat\.openai\.com)$/i),'A referrer alone does not establish paid or organic','https://thedreamcatcher.ai'],
        ['ChatGPT Ads','Paid','—','Ad impressions, clicks and spend not connected','https://ads.openai.com'],
        ['Instagram / Facebook Ads','Paid','—','Ad account reporting not connected','https://business.facebook.com'],
        ['Search visibility','Organic','—','Search impressions and queries not connected','https://search.google.com/search-console'],
    ];
    document.getElementById('acquisition-content').innerHTML = `
        <div class="metrics-grid acq-kpis">
            ${growthCard('Website visitors',growthNumber(totals.data?.visitors),'thedreamcatcher.ai · production website',comparison('visitors'))}
            ${growthCard('Website page views',growthNumber(total),'Recorded website exposure, including repeat views',comparison('pageviews'))}
            ${growthCard('Named referrers',growthNumber(names),'Distinct referrer hosts in the reported rows',referrers.status === 'connected' ? `${growthNumber(direct)} views have no reported referrer` : sourceStatus(referrers.status))}
        </div>
        <section class="chart-card growth-section"><div class="growth-section-heading"><div><p class="acq-eyebrow">01 / WEBSITE DISCOVERY</p><h2 class="chart-title">Where traffic comes from</h2></div><span class="acq-badge">${sourceStatus(referrers.status)}</span></div>
            <p class="growth-detail">Referrer websites recorded on page views. Direct / unknown can include bookmarks, untagged links, private shares and sources hidden by the browser.</p>
            ${trafficTable(referrers,'Referrer','Direct / unknown',total)}
            <p class="growth-detail">Visitors can appear under more than one referrer, so rows must not be summed into unique reach. “Others” is the provider’s remaining groups. Referral visits are not social impressions or ad clicks.</p>
        </section>
        <div class="growth-columns"><section class="chart-card"><p class="acq-eyebrow">TRAFFIC OVER TIME</p><h2 class="chart-title">Daily page views</h2>
            ${daily.status === 'connected' ? `<div class="acq-trend" role="img" aria-label="Daily page views; exact values are available in the table below">${daily.data.map(r=>`<div class="acq-day" title="${growthEscape(r.value.slice(0,10))}: ${r.pageviews} views, ${r.visitors} visitors"><span style="height:${r.pageviews/max*100}%"></span></div>`).join('')}</div><div class="acq-trend-labels"><span>${growthEscape(daily.data[0]?.value.slice(0,10) || '')}</span><span>${growthEscape(daily.data.at(-1)?.value.slice(0,10) || '')}</span></div><details class="acq-daily-values"><summary>View daily values</summary>${trafficTable(daily,'UTC day','',total)}</details>` : reportNotice(daily,'Daily traffic')}
        </section><section class="chart-card"><p class="acq-eyebrow">CONTENT DISCOVERY</p><h2 class="chart-title">Most viewed website pages</h2>
            <p class="growth-detail">All page views by URL path, not first-entry landing pages.</p>${trafficTable(pages,'Page','/',total)}
        </section></div>
        <section class="chart-card growth-section"><p class="acq-eyebrow">02 / CHANNEL EXPOSURE</p><h2 class="chart-title">Social, search &amp; paid distribution</h2>
            <p class="growth-detail">Website referrals are live where recorded. Platform exposure and spend require their own reporting connections; they are not inferred from visits.</p>
            <div class="growth-table-wrap"><table class="growth-table"><thead><tr><th>Channel</th><th>Referred page views</th><th>Exposure / spend coverage</th><th>Source</th></tr></thead><tbody>${channels.map(([name,type,views,status,url])=>`<tr><th scope="row">${name}<small>${type}</small></th><td>${views}</td><td>${status}</td><td><a href="${url}" target="_blank" rel="noopener noreferrer">Open source</a></td></tr>`).join('')}</tbody></table></div>
            <p class="growth-detail">Instagram and TikTok publishing connections exist in Postiz. Their analytics are not exposed by the installed version. No combined social reach is reported.</p>
        </section>
        <section class="chart-card growth-section"><p class="acq-eyebrow">03 / CAMPAIGN PERFORMANCE</p><h2 class="chart-title">Which campaigns bring people here?</h2>
            <p class="growth-detail">Tagged website traffic will appear here when available. Installs, spend and revenue by campaign remain unconnected.</p>
            ${trafficTable(campaigns,'Campaign tag','No campaign tag',total)}
            ${tags.status === 'connected' ? `<details class="acq-daily-values"><summary>View tagged sources</summary>${trafficTable(tags,'Source tag','No source tag',total)}</details>` : ''}
        </section>
        <section class="chart-card growth-section acq-next"><h2 class="chart-title">Next connections</h2><div class="acq-steps">
            <div><strong>Social exposure</strong><p>Connect Instagram and TikTok views, reach and engagement by post. Add creator placements as identifiable campaigns.</p></div>
            <div><strong>Install attribution</strong><p>Evaluate AppsFlyer pricing and data access. Verify tracked links through both stores before treating installs as attributed.</p></div>
            <div><strong>Paid performance</strong><p>Connect ad impressions, clicks and spend. Match first paid subscriptions to campaigns before calculating acquisition cost.</p></div>
        </div><p class="growth-detail">No AppsFlyer SDK or ad campaigns have been added. Product outcomes are available below as a quality check.</p></section>`;
}

function renderMarketing(data) {
    const c = data.current, billing = data.sources.billingCohorts, rc = data.sources.revenuecat;
    const metrics = Object.fromEntries((rc.data?.metrics || []).map(m=>[m.id,m.value]));
    const dollars = n => Number.isFinite(n) ? new Intl.NumberFormat('en-US',{style:'currency',currency:rc.data.currency || 'USD'}).format(n) : '—';
    document.getElementById('growth-quality-content').innerHTML = `
        <div class="metrics-grid growth-kpis">
            ${growthCard('New accounts',growthNumber(c.signups),'App registrations, not website-attributed signups',`${data.prior.signups} in the previous period`)}
            ${growthCard('Trial starts',growthNumber(billing.data?.trials.started),sourceStatus(billing.status))}
            ${growthCard('Paid subscription starts',growthNumber(billing.data?.paid.total),'Includes conversions, resubscriptions and product changes')}
            ${growthCard('First dream within 48h',growthPercent(c.activation),growthSample(c.activation),`${c.activation.pending} accounts still maturing`)}
        </div>
        <div class="growth-section-heading"><div><h2 class="chart-title">How new accounts say they found us</h2><p class="growth-detail">Self-reported answers and Android install evidence are separate from website referrers.</p></div><label>Evidence <select id="growth-attribution"><option value="reported">Self-reported source</option><option value="observed">Android install source</option></select></label></div>
        <div id="growth-channel-table"></div>
        <div class="growth-columns"><section><h2 class="chart-title">Subscription business</h2><dl class="growth-reach"><div><dt>Monthly recurring revenue</dt><dd>${dollars(metrics.mrr)}</dd></div><div><dt>Active subscriptions</dt><dd>${growthNumber(metrics.active_subscriptions)}</dd></div><div><dt>Revenue · last 28 days</dt><dd>${dollars(metrics.revenue)}</dd></div><div><dt>Trial cohort conversions</dt><dd>${growthNumber(billing.data?.trials.converted)}</dd></div></dl><p class="growth-detail">RevenueCat’s own account scope and overview windows. Revenue is not profit or store payout. ${sourceStatus(rc.status)}.</p></section>
        <section><h2 class="chart-title">Traffic quality check</h2><dl class="growth-reach"><div><dt>Week 2 dream retention</dt><dd>${growthPercent(c.week2)}</dd></div><div><dt>Week 5 dream retention</dt><dd>${growthPercent(c.week5)}</dd></div><div><dt>Weekly habit builders</dt><dd>${growthNumber(data.weeklyHabit.current)}</dd></div></dl><p class="growth-detail">Week 2: ${growthSample(c.week2)}. Week 5: ${growthSample(c.week5)}. Habit builders saved dreams on 2+ UTC days in the last seven complete days.</p></section></div>
        <p class="growth-detail">${data.excludedAccounts} internal accounts excluded from product cohorts. Source properties are the latest recorded values, not immutable first-touch attribution. Unknown is not proof of organic acquisition. Cost per acquired customer requires spend and a verified billing join.</p>`;
    document.getElementById('growth-attribution').addEventListener('change',renderGrowthChannels);
    renderGrowthChannels();
}
function renderGrowthChannels() {
    const target = document.getElementById('growth-channel-table');
    if (marketingData.sources.posthog.status !== 'connected') { target.innerHTML = `<p class="acq-empty">${sourceStatus(marketingData.sources.posthog.status)}. Source coverage cannot be assessed yet.</p>`; return; }
    const mode = document.getElementById('growth-attribution').value;
    const rows = marketingData.channels[mode];
    const known = rows.filter(row=>row.source !== 'Unknown').reduce((sum,row)=>sum+row.signups,0);
    const labels = {store_search:'Store search',friend:'Friend / family',social_video:'TikTok / Instagram',search_article:'Search / article',community:'Community / forum',podcast_youtube:'Podcast / YouTube',other:'Other'};
    target.innerHTML = `<p class="growth-detail">Source coverage: ${known} / ${marketingData.current.signups} new accounts. ${mode === 'observed' ? 'Android evidence only; iOS and unlinked accounts remain unknown.' : 'Answers supplied during onboarding.'}</p><div class="growth-table-wrap"><table class="growth-table"><thead><tr><th>Source</th><th>New accounts</th><th>First dream / 48h</th><th>Week 2 return</th></tr></thead><tbody>${rows.map(row=>`<tr><th scope="row">${growthEscape(labels[row.source] || row.source)}</th><td>${row.signups}</td><td>${growthPercent(row.activation)}<small>${growthSample(row.activation)}</small></td><td>${growthPercent(row.week2)}<small>${growthSample(row.week2)}</small></td></tr>`).join('') || '<tr><td colspan="4">No new accounts in this period.</td></tr>'}</tbody></table></div>`;
}
