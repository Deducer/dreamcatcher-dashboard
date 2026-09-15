let marketingRequest = 0;
let marketingData = null;
let acquisitionData = null;
let mobileAttributionData = null;
let productInitialized = false;
let customAcquisitionRange = null;
let trafficMetric = 'pageviews';
let trafficStyle = 'bars';
let trafficChart = null;
let acquisitionPreset = 'today';
let acquisitionProvider = 'umami';
function changeAcquisitionSource(value) {
    acquisitionProvider=value; customAcquisitionRange=null; acquisitionPreset=value==='umami'?'today':'30d';
    document.getElementById('acquisition-date-form').hidden=true; loadMarketing();
}

function selectedAcquisitionDates() {
    return customAcquisitionRange || presetDates(acquisitionPreset) || presetDates('30d');
}
function changeAcquisitionPreset(value) {
    const form = document.getElementById('acquisition-date-form');
    document.getElementById('acq-date-error').hidden = true;
    form.hidden = value !== 'custom';
    if (value === 'custom') { document.getElementById('acq-start').focus(); return; }
    const dates = presetDates(value);
    if (!dates) {
        const error = document.getElementById('acq-date-error');
        error.textContent = 'This period has no complete UTC days yet. Choose another period.'; error.hidden = false;
        document.getElementById('acq-preset').value = acquisitionPreset; return;
    }
    acquisitionPreset = value; customAcquisitionRange = null; loadMarketing();
}
function cancelAcquisitionDates() {
    document.getElementById('acquisition-date-form').hidden = true;
    document.getElementById('acq-preset').value = acquisitionPreset;
    document.getElementById('acq-date-error').hidden = true;
}
function destroyTrafficChart() { if (trafficChart) { trafficChart.destroy(); trafficChart = null; } }
function applyAcquisitionDates(event) {
    event.preventDefault();
    const start = document.getElementById('acq-start').value, end = document.getElementById('acq-end').value;
    const days = (Date.parse(end)-Date.parse(start))/86400000+1;
    const error = document.getElementById('acq-date-error');
    const today = new Date().toISOString().slice(0,10);
    if (!start || !end || !Number.isInteger(days) || days < 1 || days > 366 || end >= today) {
        error.textContent = 'Choose 1 to 366 days, ending no later than yesterday (UTC).'; error.hidden = false; return;
    }
    acquisitionPreset = 'custom';
    document.getElementById('acquisition-date-form').hidden = true;
    customAcquisitionRange = {start,end};
    loadMarketing();
}
const growthEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const growthNumber = value => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 1 }) : '—';
const growthPercent = metric => metric?.percent == null ? '—' : `${metric.percent.toFixed(1)}%`;
const growthSample = metric => metric?.eligible ? `${metric.count} / ${metric.eligible} eligible people${metric.eligible < 30 ? ' · small sample' : ''}` : 'No mature cohort yet';
const sourceStatus = status => ({ connected: 'Connected', not_connected: 'Not connected', unavailable: 'Unavailable for this period', loading: 'Loading…', plan_required: 'Plan upgrade required', not_collected: 'Before Umami collection began', not_comparable: 'No comparable full period' })[status] || 'Not connected';

function switchDashboardView(view) {
    const marketing = view === 'marketing';
    document.querySelector('.time-filter').hidden = marketing;
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
        document.querySelectorAll('.filter-btn').forEach(button => button.classList.toggle('active', button.dataset.range === currentRange));
        marketingRequest++;
        updatePeriodIndicator();
        loadData();
        if (!productInitialized) { productInitialized = true; loadRecentDreams(true); loadExcludedChip(); initReactivation(); }
    }
}

async function loadMarketing() {
    const request = ++marketingRequest;
    const dates = selectedAcquisitionDates();
    const query = new URLSearchParams({...dates,provider:acquisitionProvider,...(acquisitionPreset==='today'?{live:'1'}:{})}).toString();
    const prettyDate = value => new Date(value+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
    document.getElementById('acq-range-label').textContent = `${prettyDate(dates.start)} – ${prettyDate(dates.end)}`;
    document.getElementById('acq-preset').value = acquisitionPreset;
    for (const option of document.querySelectorAll('#acq-preset option')) if (option.value !== 'custom') option.disabled = !presetDates(option.value) || (option.value==='today' && acquisitionProvider==='vercel');
    document.getElementById('acq-date-error').hidden = true;
    for (const key of ['start','end']) {
        const input = document.getElementById(`acq-${key}`);
        input.value = dates[key];
        input.max = new Date(Date.parse(new Date().toISOString().slice(0,10))-86400000).toISOString().slice(0,10);
    }
    document.querySelectorAll('.filter-btn').forEach(button => button.classList.toggle('active', !customAcquisitionRange && button.dataset.range === currentRange));
    acquisitionData = null;
    mobileAttributionData = null;
    marketingData = null;
    const content = document.getElementById('marketing-content');
    content.hidden = false;
    destroyTrafficChart();
    content.innerHTML = '<div id="acquisition-content"></div><div id="mobile-attribution-content"></div><details class="chart-card growth-section" id="acquisition-outcomes"><summary>What happens after acquisition</summary><p class="growth-detail">Registrations, trials and subscriptions help judge traffic quality. These totals are not a matched website-to-app funnel.</p><div id="growth-quality-content"><p class="growth-detail">Loading app and billing outcomes…</p></div></details>';
    document.getElementById('marketing-status').textContent = 'Loading acquisition sources…';
    renderAcquisition();
    renderMobileAttribution();
    const get = async path => {
        const response = await fetch(`${path}?${query}`, { signal: AbortSignal.timeout(15000) });
        if (response.status === 401) { if (request === marketingRequest) showLogin(); throw Error('Auth'); }
        if (!response.ok) throw Error('Unavailable');
        return response.json();
    };
    // Traffic does not depend on Supabase, billing or PostHog finishing.
    await Promise.allSettled([
        (async () => {
            try {
                const data = await get('/api/mobile-attribution');
                if (request !== marketingRequest) return;
                mobileAttributionData = data;
            } catch {
                if (request !== marketingRequest) return;
                mobileAttributionData = { platforms: ['iOS','Android'].map(label => ({ label, status:'unavailable' })) };
            }
            renderMobileAttribution();
        })(),
        (async () => {
            try {
                const data = await get('/api/acquisition');
                if (request !== marketingRequest) return;
                acquisitionData = data;
                renderAcquisition();
                const connected = Object.values(data.sources).filter(s => s.status === 'connected').length;
                document.getElementById('marketing-status').textContent = `${data.provider === 'umami' ? 'Umami' : 'Vercel history'} · ${data.partialDay ? 'Today so far (partial day)' : data.days+' complete UTC days'} · ${data.start.slice(0,10)} through ${new Date(Date.parse(data.end)-1).toISOString().slice(0,10)} · Checked ${new Date(data.generatedAt).toLocaleString()} · ${connected}/${Object.keys(data.sources).length} reports available`;
            } catch {
                if (request !== marketingRequest) return;
                acquisitionData = { sources: Object.fromEntries(['totals','previous','referrers','daily','pages','campaigns','taggedSources'].map(key => [key, {status:'unavailable',data:null}])) };
                renderAcquisition();
                document.getElementById('marketing-status').textContent = 'Website reports could not be loaded. Use Refresh to retry.';
            }
        })(),
        (async () => {
            try {
                if (acquisitionPreset==='today') { document.getElementById('growth-quality-content').textContent='App and subscription cohorts use complete days. Choose Yesterday or a longer completed period to review outcomes.'; return; }
                const response = await fetch(`/api/marketing?${query}&core=1`, {signal:AbortSignal.timeout(15000)});
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
    if (source.status === 'not_collected') return '<div class="acq-empty"><strong>No Umami coverage for these dates</strong><p>Collection began September 13, 2026. Choose Today to see new traffic, or Vercel · earlier history for previous records. Earlier days are unknown, not zero.</p></div>';

    if (source.status === 'plan_required') return `<div class="acq-empty"><strong>Campaign tags need Vercel Web Analytics Plus</strong><p>The historical Vercel plan does not expose campaign tags. Select Umami to see campaign tags and store-link clicks collected since September 13, 2026. <a href="#web-measurement-plan">See the measurement setup plan</a>.</p></div>`;
    return `<div class="acq-empty"><strong>${sourceStatus(source.status)}</strong><p>${source.status === 'loading' ? `Checking ${subject}…` : `${subject} is not available for this window. Try 7D or 30D, or Refresh. Missing data is not zero.`}</p></div>`;
}
function trafficTable(source, title, emptyLabel, total) {
    if (source.status !== 'connected') return reportNotice(source, title);
    if (!source.data.length) return '<p class="acq-empty">No recorded traffic in this period.</p>';
    return `<div class="growth-table-wrap"><table class="growth-table"><thead><tr><th scope="col">${growthEscape(title)}</th><th scope="col">Visitors</th><th scope="col">Page views</th><th scope="col">Share of views</th></tr></thead><tbody>${source.data.map(row => {
        const share = Number.isFinite(total) && total > 0 ? row.pageviews / total * 100 : null;
        return `<tr><th scope="row" class="acq-source">${growthEscape(title === 'UTC day' ? row.value.slice(0,10) : row.value || emptyLabel)}</th><td>${growthNumber(row.visitors)}</td><td>${growthNumber(row.pageviews)}</td><td>${share == null ? '—' : `${share.toFixed(1)}%<span class="acq-share"><span style="width:${Math.min(100,share)}%"></span></span>`}</td></tr>`;
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
    const channels = [
        ['Instagram','Unclassified referral',channelViews(/(^|\.)instagram\.com$/i),'Views, reach, saves and shares not connected','https://social.projectwin.cloud'],
        ['TikTok','Unclassified referral',channelViews(/(^|\.)tiktok\.com$/i),'Views, reach and watch time not connected','https://social.projectwin.cloud'],
        ['ChatGPT referrals','Unclassified referral',channelViews(/(^|\.)(chatgpt\.com|chat\.openai\.com)$/i),'A referrer alone does not establish paid or organic','https://thedreamcatcher.ai'],
        ['ChatGPT Ads','Paid','—','Ad impressions, clicks and spend not connected','https://ads.openai.com'],
        ['Instagram / Facebook Ads','Paid','—','Ad account reporting not connected','https://business.facebook.com'],
        ['Search visibility','Organic','—','Search impressions and queries not connected','https://search.google.com/search-console'],
    ];
    destroyTrafficChart();
    document.getElementById('acquisition-content').innerHTML = `
        ${acquisitionData?.provider==='umami'?`<p class="acq-coverage">Umami collection started September 13, 2026 at 19:32 UTC. ${acquisitionData.partialCoverage?'This selection includes time before collection; only the covered portion is reported. ':''}Vercel history is separate and is never added to these counts. Campaigns labeled analytics_setup are validation traffic.</p>`:acquisitionData?.provider==='vercel'?'<p class="acq-coverage">Earlier Vercel records, subject to provider retention. New website collection uses Umami. Visitor definitions and route coverage differ between collectors.</p>':''}
        <div class="metrics-grid acq-kpis">
            ${growthCard('Website visitors',growthNumber(totals.data?.visitors),'thedreamcatcher.ai · '+(acquisitionData?.provider==='umami'?'Umami':'Vercel'),comparison('visitors'))}
            ${growthCard('Website page views',growthNumber(total),'Recorded website exposure, including repeat views',comparison('pageviews'))}
            ${growthCard('Named referrers',growthNumber(names),'Distinct referrer hosts in the reported rows',referrers.status === 'connected' ? `${growthNumber(direct)} views have no reported referrer` : sourceStatus(referrers.status))}
        </div>
        <section class="chart-card growth-section"><div class="growth-section-heading"><div><p class="acq-eyebrow">01 / WEBSITE DISCOVERY</p><h2 class="chart-title">Where traffic comes from</h2></div><span class="acq-badge">${sourceStatus(referrers.status)}</span></div>
            <p class="growth-detail">Referrer websites recorded on page views. Direct / unknown can include bookmarks, untagged links, private shares and sources hidden by the browser.</p>
            ${trafficTable(referrers,'Referrer','Direct / unknown',total)}
            <p class="growth-detail">Visitors can appear under more than one referrer, so rows must not be summed into unique reach. A dash means visitor counts are not supplied for that row; page views remain available. “Others” is the provider’s remaining groups. Referral visits are not social impressions or ad clicks.</p>
        </section>
        <div class="acq-traffic-stack"><section class="chart-card acq-traffic-card"><p class="acq-eyebrow">TRAFFIC OVER TIME</p><h2 class="chart-title">Website traffic over time</h2>
            <div class="acq-chart-controls"><label>Metric <select id="traffic-metric" onchange="trafficMetric=this.value;renderTrafficTrend()"><option value="pageviews" ${trafficMetric==='pageviews'?'selected':''}>Page views</option><option value="visitors" ${trafficMetric==='visitors'?'selected':''}>Visitors per day</option></select></label><label>Chart <select id="traffic-style" onchange="trafficStyle=this.value;renderTrafficTrend()"><option value="bars" ${trafficStyle==='bars'?'selected':''}>Bars</option><option value="line" ${trafficStyle==='line'?'selected':''}>Line</option></select></label></div>
            <div id="acq-traffic-trend"></div>
            ${daily.status === 'connected' ? `<details class="acq-daily-values"><summary>View daily values</summary>${trafficTable(daily,'UTC day','',total)}</details>` : ''}
        </section><section class="chart-card"><p class="acq-eyebrow">CONTENT DISCOVERY</p><h2 class="chart-title">Most viewed website pages</h2>
            <p class="growth-detail">All page views by URL path, not first-entry landing pages.</p>${trafficTable(pages,'Page','/',total)}
        </section></div>
        <section class="chart-card growth-section"><p class="acq-eyebrow">02 / CHANNEL EXPOSURE</p><h2 class="chart-title">Social, search &amp; paid distribution</h2>
            <p class="growth-detail">Website referrals are live where recorded. Platform exposure and spend require their own reporting connections; they are not inferred from visits.</p>
            <div class="growth-table-wrap"><table class="growth-table"><thead><tr><th>Channel</th><th>Referred page views</th><th>Exposure / spend coverage</th><th>Source</th></tr></thead><tbody>${channels.map(([name,type,views,status,url])=>`<tr><th scope="row">${name}<small>${type}</small></th><td>${views}</td><td>${status}</td><td><a href="${url}" target="_blank" rel="noopener noreferrer">Open source</a></td></tr>`).join('')}</tbody></table></div>
            <p class="growth-detail">Instagram and TikTok publishing connections exist in Postiz. Their analytics are not exposed by the installed version. No combined social reach is reported.</p>
        </section>
        <section class="chart-card growth-section"><p class="acq-eyebrow">03 / CAMPAIGN PERFORMANCE</p><h2 class="chart-title">Which campaigns bring people here?</h2>
            <p class="growth-detail">Tagged website traffic will appear here when available. Mobile campaign records are in the mobile results section below. Ad spend and verified customer revenue by campaign remain unconnected.</p>
            ${trafficTable(campaigns,'Campaign tag','No campaign tag',total)}
            ${acquisitionData?.provider==='umami'?'<p class="growth-detail">Top 50 tags by page views. Umami does not return unique visitors for these tag summaries; they are shown as —.</p>':''}
            ${tags.status === 'connected' ? `<details class="acq-daily-values"><summary>View tagged sources</summary>${trafficTable(tags,'Source tag','No source tag',total)}</details>` : ''}
        </section>
        ${renderWebsiteEvents(sources)}
        <section class="chart-card growth-section acq-next" id="web-measurement-plan"><h2 class="chart-title">Measurement setup &amp; next connections</h2><div class="acq-steps">
            <div><strong>Web analytics setup</strong><p>Umami now supplies website visits, traffic sources, campaign tags and App Store / Google Play link clicks. Vercel collection has been removed from the website; earlier records remain a separate source. <a href="https://analytics.dissonance.cloud/websites/3a631133-dde5-406e-8bfb-8fa32b7a7afc" target="_blank" rel="noopener noreferrer">Open Umami</a>. The dashboard uses a dedicated account with read-only access to DreamCatcher.</p></div>
            <div><strong>Landing-page behavior</strong><p>Microsoft Clarity is installed for optional, consented 18+ landing-page heatmaps and recordings. Dream entry/results are masked; recording stops on dream-form interaction. <a href="https://clarity.microsoft.com/projects/view/yht2eghkun/dashboard" target="_blank" rel="noopener noreferrer">Open Clarity</a>. Reports require processing time and are not imported here.</p></div>
            <div><strong>Search discovery</strong><p>Connect Google Search Console for queries, impressions, clicks and search position. Website referrers alone cannot show how often we appear in search.</p></div>
            <div><strong>Social exposure</strong><p>Connect Instagram and TikTok views, reach and engagement by post. Add creator placements as identifiable campaigns.</p></div>
            <div><strong>Install attribution</strong><p>AppsFlyer is connected for the native test builds: iOS 1.1.4 (54) and Android 1.1.4 (35). See the pilot reports below. Device receipt, sandbox subscription delivery and restore checks have passed. Campaign attribution is still being validated.</p></div>
            <div><strong>Paid performance</strong><p>Connect ad impressions, clicks and spend. Match first paid subscriptions to campaigns before calculating acquisition cost.</p></div>
        </div><p class="growth-detail">Umami and Clarity collection began September 13, 2026; their reports are available in the linked tools, subject to consent and processing. This dashboard defaults to Umami; select Vercel for earlier history. AppsFlyer is in testing, with API access on trial. New tools cannot recreate missing history. Product outcomes are available below as a quality check.</p></section>`;
    renderTrafficTrend();
}

function renderMobileAttribution() {
    const data = mobileAttributionData;
    const activity = data?.activity;
    const statuses = {connected:'Connected',partial:'Some reports unavailable',unavailable:'Unavailable',rate_limited:'Provider rate limit',access_unavailable:'Plan / access unavailable',paused:'Trial access paused',not_connected:'Not connected',not_collected:'Outside report coverage'};
    const label = event => event.replace(/^rc_/, '').replace(/_event$/, '').replace(/_/g,' ');
    const utc = at => at ? new Date(at).toISOString().replace('T',' ').slice(0,19) : '—';
    const platformRows = activity?.platforms || [];
    const rows = platformRows.flatMap(p=>(p.rows||[]).map(r=>({...r,platform:p.label}))).sort((a,b)=>b.at.localeCompare(a.at));
    const tests = activity?.validation;
    const count = value => value == null ? '—' : growthNumber(value);
    document.getElementById('mobile-attribution-content').innerHTML = `<section class="chart-card growth-section">
        <div class="growth-section-heading"><div><p class="acq-eyebrow">05 / MOBILE RESULTS</p><h2 class="chart-title">Mobile acquisition & subscriptions</h2></div><span class="acq-badge">Internal build pilot</span></div>
        <p class="acq-coverage">AppsFlyer reports for iOS and Android. The SDK is in the internal test builds; public-store rollout is still pending. Test activity is visible here and excluded from business performance.</p>
        <p class="growth-detail">These tables use the selected <strong>activity dates in UTC</strong>. Install, reinstall and subscription events are separate. RevenueCat remains the billing authority.</p>
        ${!activity?'<p class="acq-empty">Mobile activity is not available yet. Use Refresh to retry.</p>':`<p class="growth-detail">Available report window: ${growthEscape(activity.coverageStart.slice(0,10))} through ${growthEscape(activity.coverageEnd.slice(0,10))}.${activity.partialCoverage?' Your selection includes dates outside this coverage.':''} Reports refresh at most every four hours to preserve the API quota; provider processing can add delay.</p>
        ${!activity.exclusionsAvailable?'<p class="acq-empty">Internal-account lookup unavailable. Unmatched rows remain unclassified.</p>':''}
        <div class="growth-table-wrap"><table class="growth-table"><thead><tr><th>App / report access</th><th>Record group</th><th>Installs</th><th>Reinstalls</th><th>In-app events</th></tr></thead><tbody>${platformRows.map(p=>['qa','unclassified'].map((group,i)=>`<tr>${i===0?`<th rowspan="2" scope="rowgroup">${growthEscape(p.label)}<small>${growthEscape(statuses[p.status]||p.status)}</small></th>`:''}<th scope="row">${group==='qa'?'QA / internal':'Unclassified'}</th><td>${count(p[group]?.installs)}</td><td>${count(p[group]?.reinstalls)}</td><td>${count(p[group]?.events)}</td></tr>`).join('')).join('')}</tbody></table></div>
        <p class="growth-detail">${growthEscape(activity.classificationNote)} A dash means a required report is unavailable; see report coverage below. Zero means no matching rows in the available report snapshot.</p>
        <h3>Reported mobile activity</h3>
        ${rows.length?`<div class="growth-table-wrap"><table class="growth-table"><thead><tr><th>UTC time / app</th><th>Event</th><th>Source / campaign</th><th>Record group</th><th>Reported value (USD)</th></tr></thead><tbody>${rows.slice(0,50).map(r=>`<tr><td>${growthEscape(utc(r.at))}<small>${growthEscape(r.platform)} · ${growthEscape(r.version||'Version not reported')}</small></td><td>${growthEscape(label(r.event))}<small>${growthEscape(r.kind)}</small></td><td>${growthEscape(r.source||'Not reported')}<small>${growthEscape(r.campaign||'Campaign not reported')}</small></td><td>${r.classification==='qa'?'QA / internal':'Unclassified'}</td><td>${r.valueUsd==null?'—':growthEscape(r.valueUsd.toFixed(2))}</td></tr>`).join('')}</tbody></table></div><p class="growth-detail">Showing ${Math.min(rows.length,50)} of ${platformRows.reduce((n,p)=>n+p.rowCount,0)} reported rows. Narrow the date range for details. Values can include simulated sandbox payments and renewals; they are not customer acquisition revenue.</p>`:'<p class="acq-empty">No activity rows in the available snapshots for these dates. This does not prove no activity occurred; check report access and refresh times below.</p>'}
        <details class="acq-daily-values"><summary>Report coverage and refresh times</summary><div class="growth-table-wrap"><table class="growth-table"><thead><tr><th>App / report</th><th>Status</th><th>Checked (UTC)</th><th>Next refresh eligible (UTC)</th></tr></thead><tbody>${platformRows.flatMap(p=>p.reports.map(r=>`<tr><td>${growthEscape(p.label)} · ${growthEscape(r.name.replace(/_/g,' '))}</td><td>${growthEscape(statuses[r.status]||r.status)}</td><td>${growthEscape(utc(r.checkedAt))}</td><td>${growthEscape(utc(r.refreshAfter))}</td></tr>`)).join('')}</tbody></table></div></details>
        <h3>Android campaign handoffs</h3><p class="growth-detail">Google Play referrers received by the app, supplied by PostHog. A handoff proves the link reached the app; campaign attribution and a paid conversion still need an AppsFlyer match.</p>
        ${activity.handoffs.status==='connected'?`<div class="growth-table-wrap"><table class="growth-table"><thead><tr><th>UTC time</th><th>Source</th><th>Campaign</th><th>AppsFlyer click ID</th></tr></thead><tbody>${activity.handoffs.rows.slice(0,50).map(r=>`<tr><td>${growthEscape(utc(r.at))}</td><td>${growthEscape(r.source||'Not reported')}</td><td>${growthEscape(r.campaign||'Not reported')}</td><td>${r.clickIdPresent?'Received':'Not reported'}</td></tr>`).join('')||'<tr><td colspan="4">No handoffs reported for these dates.</td></tr>'}</tbody></table></div><p class="growth-detail">Checked ${growthEscape(utc(activity.handoffs.checkedAt))} UTC · 15-minute cache · showing up to 50 handoffs.</p>`:`<p class="acq-empty">Handoff report: ${growthEscape(statuses[activity.handoffs.status]||'Unavailable')}</p>`}`}
        ${tests?`<h3>Device test results</h3><p class="growth-detail">Reviewed ${growthEscape(tests.reviewedAt)} · ${growthEscape(tests.source)}. Restore results are device checks, not purchase events.</p><div class="growth-table-wrap"><table class="growth-table"><thead><tr><th>App / test build</th><th>SDK receipt</th><th>Subscription delivery</th><th>Restore purchases</th><th>Campaign test</th></tr></thead><tbody>${tests.platforms.map(p=>`<tr><th>${growthEscape(p.label)}<small>${growthEscape(p.build)}</small></th><td>${growthEscape(p.device)}</td><td>${growthEscape(p.subscription)}</td><td>${growthEscape(p.restore)}</td><td>${growthEscape(p.campaign)}</td></tr>`).join('')}</tbody></table></div><p class="growth-detail">${growthEscape(tests.partner)} <a href="${growthEscape(tests.recordUrl)}" target="_blank" rel="noopener noreferrer">Evidence and remaining checks</a></p>`:''}
        <details class="acq-daily-values"><summary>Provider install-cohort totals (mixed QA and unclassified)</summary><p class="growth-detail">A separate aggregate report: selected dates refer to install dates, not event activity dates. Do not add these totals to the activity table or treat them as new customers.</p><div class="growth-table-wrap"><table class="growth-table"><thead><tr><th>App</th><th>Status</th><th>Reported installs</th><th>Checked (UTC)</th></tr></thead><tbody>${(data?.platforms||[]).map(p=>`<tr><th>${growthEscape(p.label)}</th><td>${growthEscape(statuses[p.status]||'Unavailable')}</td><td>${count(p.installs)}</td><td>${growthEscape(utc(p.checkedAt))}</td></tr>`).join('')}</tbody></table></div></details>
        <p class="growth-detail">API trial access ends October 12, 2026. Automatic AppsFlyer refresh pauses on ${growthEscape(data?.apiAccessUntil||'2026-10-12')} until continued access is confirmed. Missing data is never replaced with revenue estimates.</p>
        <a href="https://hq1.appsflyer.com/apps/myapps" target="_blank" rel="noopener noreferrer">Open AppsFlyer</a>
    </section>`;
}

function renderWebsiteEvents(sources) {
    if (acquisitionData?.provider !== 'umami') return '';
    const events=sources.events || {status:'loading'}, stores=sources.storeClicks || {status:'loading'};
    const render=(source,heading)=>source.status==='connected'?`<div class="growth-table-wrap"><table class="growth-table"><thead><tr><th>${heading}</th><th>Recorded actions</th></tr></thead><tbody>${source.data.map(row=>`<tr><th>${growthEscape(({ios:'App Store',android:'Google Play'})[row.value] || row.value)}</th><td>${growthNumber(row.count)}</td></tr>`).join('') || '<tr><td colspan="2">No recorded actions in this period.</td></tr>'}</tbody></table></div>`:reportNotice(source,heading);
    return `<section class="chart-card growth-section"><p class="acq-eyebrow">04 / WEBSITE ACTIONS</p><h2 class="chart-title">Store clicks and website events</h2><p class="growth-detail">These are recorded actions, including repeat clicks—not confirmed downloads, app trials or unique people. Trial Dream events refer to the free website demo.</p>${render(stores,'Store-link destination')}<details class="acq-daily-values"><summary>All tracked website events</summary>${render(events,'Event')}</details></section>`;
}

function renderTrafficTrend() {
    const target = document.getElementById('acq-traffic-trend');
    if (!target) return;
    destroyTrafficChart();
    const source = acquisitionData?.sources?.daily || {status:'loading'};
    if (source.status !== 'connected') { target.innerHTML = reportNotice(source,'Daily traffic'); return; }
    const rows = source.data;
    if (!rows.length) { target.textContent = 'No recorded traffic in this period.'; return; }
    const metric = trafficMetric === 'visitors' ? 'visitors' : 'pageviews';
    const label = metric === 'visitors' ? 'Daily visitors' : 'Page views';
    target.innerHTML = `<p class="growth-detail">Hover or tap the chart for exact values.</p><div class="acq-chart-canvas"><canvas id="traffic-chart" role="img" aria-label="${label} by UTC date. Exact values are available in the daily table below."></canvas></div>${metric==='visitors'?'<p class="growth-detail">Visitors can repeat across days. Daily counts do not add up to a unique audience for the entire period.</p>':''}`;
    if (typeof Chart === 'undefined') { target.innerHTML = '<p class="growth-detail">Chart library unavailable. Exact values remain available in the daily table below.</p>'; return; }
    const pretty = value => new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
    trafficChart = new Chart(document.getElementById('traffic-chart'), {
        type: trafficStyle === 'line' ? 'line' : 'bar',
        data: {labels:rows.map(r=>r.value.slice(0,10)),datasets:[{label,data:rows.map(r=>r[metric]),borderColor:'#b59aff',backgroundColor:trafficStyle==='line'?'rgba(181,154,255,.08)':'#9e7be9',hoverBackgroundColor:'#d4bfff',borderWidth:trafficStyle==='line'?2:0,borderRadius:3,maxBarThickness:56,pointRadius:rows.length>60?0:3,pointHoverRadius:5,tension:0,fill:trafficStyle==='line'}]},
        options: {
            responsive:true,maintainAspectRatio:false,animation:false,
            interaction:{mode:'index',intersect:false},
            plugins:{legend:{display:false},tooltip:{enabled:true,backgroundColor:'#f6f3ff',titleColor:'#211b30',bodyColor:'#211b30',padding:14,cornerRadius:8,displayColors:false,titleFont:{size:13},bodyFont:{size:15,weight:'bold'},callbacks:{
                title:items=>items.length?new Date(rows[items[0].dataIndex].value).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})+' · UTC':'',
                label:item=>`${label}: ${growthNumber(rows[item.dataIndex][metric])}`,
                afterLabel:item=>metric==='visitors'?`Page views: ${growthNumber(rows[item.dataIndex].pageviews)}`:`Visitors: ${growthNumber(rows[item.dataIndex].visitors)}`,
            }}},
            scales:{
                x:{title:{display:true,text:'Date (UTC)',color:'#bab5c5'},grid:{display:false},border:{color:'#55505f'},ticks:{color:'#aaa5b5',maxRotation:0,autoSkip:true,maxTicksLimit:window.innerWidth<700?4:12,callback:function(value){return pretty(this.getLabelForValue(value));}}},
                y:{beginAtZero:true,title:{display:true,text:label,color:'#bab5c5'},grid:{color:'rgba(255,255,255,.07)'},border:{color:'#55505f'},ticks:{color:'#aaa5b5',precision:0,maxTicksLimit:6}},
            },
        },
    });
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
        <div class="growth-columns"><section><h2 class="chart-title">Current subscription overview</h2><dl class="growth-reach"><div><dt>Monthly recurring revenue</dt><dd>${dollars(metrics.mrr)}</dd></div><div><dt>Active subscriptions</dt><dd>${growthNumber(metrics.active_subscriptions)}</dd></div><div><dt>Revenue · last 28 days</dt><dd>${dollars(metrics.revenue)}</dd></div><div><dt>Trial cohort conversions</dt><dd>${growthNumber(billing.data?.trials.converted)}</dd></div></dl><p class="growth-detail">Overview values are current and do not follow the date filter. Trial cohort conversions use the selected dates. RevenueCat’s own account scope applies. Revenue is not profit or store payout. ${sourceStatus(rc.status)}.</p></section>
        <section><h2 class="chart-title">Traffic quality check</h2><dl class="growth-reach"><div><dt>Week 2 dream retention</dt><dd>${growthPercent(c.week2)}</dd></div><div><dt>Week 5 dream retention</dt><dd>${growthPercent(c.week5)}</dd></div><div><dt>Weekly habit builders</dt><dd>${growthNumber(data.weeklyHabit.current)}</dd></div></dl><p class="growth-detail">Week 2: ${growthSample(c.week2)}. Week 5: ${growthSample(c.week5)}. Habit builders saved dreams on 2+ UTC days in the seven days ending with the selected range.</p></section></div>
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
