let marketingRequest = 0;
let marketingData = null;
let productInitialized = false;
const growthEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const growthNumber = value => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 1 }) : '—';
const growthPercent = metric => metric?.percent == null ? '—' : `${metric.percent.toFixed(1)}%`;
const growthSample = metric => metric.eligible ? `${metric.count} / ${metric.eligible} eligible people${metric.eligible < 30 ? ' · small sample' : ''}` : 'No mature cohort yet';

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
        if (!productInitialized) {
            productInitialized = true;
            loadRecentDreams(true);
            loadExcludedChip();
            initReactivation();
        }
    }
}

async function loadMarketing() {
    const request = ++marketingRequest;
    const status = document.getElementById('marketing-status');
    const content = document.getElementById('marketing-content');
    status.textContent = 'Loading growth metrics…';
    content.hidden = true;
    let coreData = null;
    try {
        const url = `/api/marketing?range=${encodeURIComponent(currentRange)}`;
        const coreResponse = await fetch(`${url}&core=1`, { signal: AbortSignal.timeout(15000) });
        if (request !== marketingRequest) return;
        if (coreResponse.status === 401) { showLogin(); return; }
        if (!coreResponse.ok) throw new Error('Unavailable');
        coreData = await coreResponse.json();
        if (request !== marketingRequest) return;
        marketingData = coreData;
        renderMarketing(coreData);
        content.hidden = false;
        status.textContent = 'Product metrics loaded. Checking acquisition, billing, website and email sources…';
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (request !== marketingRequest) return;
        if (response.status === 401) { showLogin(); return; }
        if (!response.ok) throw new Error('Unavailable');
        const data = await response.json();
        if (request !== marketingRequest) return;
        marketingData = data;
        renderMarketing(data);
        const connected = Object.values(data.sources).filter(s => s.status === 'connected').length;
        status.textContent = `${data.days} complete UTC days · ${data.start.slice(0,10)} to ${data.end.slice(0,10)} (end exclusive) · Checked ${new Date(data.generatedAt).toLocaleString()} · ${data.excludedAccounts} internal accounts excluded from product cohorts · ${connected}/${Object.keys(data.sources).length} additional sources available`;
        content.hidden = false;
    } catch {
        if (request !== marketingRequest) return;
        if (coreData) {
            for (const source of Object.values(coreData.sources)) source.status = 'unavailable';
            marketingData = coreData;
            renderMarketing(coreData);
            content.hidden = false;
            status.textContent = 'Product metrics are available. Additional sources could not be loaded; use Refresh to retry.';
        } else status.textContent = 'Growth metrics could not be loaded. Use Refresh to retry. No data is being shown as zero.';
    }
}

function growthCard(label, value, detail, comparison) {
    return `<article class="metric-card"><h3 class="metric-label">${growthEscape(label)}</h3><div class="metric-value">${growthEscape(value)}</div><p class="growth-detail">${growthEscape(detail)}</p>${comparison ? `<p class="growth-comparison">${growthEscape(comparison)}</p>` : ''}</article>`;
}

function renderMarketing(data) {
    const c = data.current, p = data.prior;
    const rc = data.sources.revenuecat;
    const rcMetrics = Object.fromEntries((rc.data?.metrics || []).map(m => [m.id, m]));
    const dollars = value => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: rc.data?.currency || 'USD', maximumFractionDigits: 2 }).format(value) : '—';
    const billDetail = rc.status === 'connected' ? 'RevenueCat project overview' : sourceStatus(rc.status);
    const ph = data.sources.posthog;
    const eventLabels = { 'paywall viewed': 'Viewed paywall', 'paywall purchase started': 'Started checkout', 'paywall purchase succeeded': 'Purchase reported by app', 'paywall purchase cancelled': 'Cancelled checkout', 'paywall purchase failed': 'Checkout error' };
    const email = data.sources.email;
    const billing = data.sources.billingCohorts;
    const counts = email.data?.counts || {};
    document.getElementById('marketing-content').innerHTML = `
        <div class="metrics-grid growth-kpis">
            ${growthCard('Weekly habit builders', growthNumber(data.weeklyHabit.current), 'Recorded dreams on 2+ distinct days in the last 7 complete UTC days', `${data.weeklyHabit.prior} in the previous 7 days`)}
            ${growthCard('New accounts', growthNumber(c.signups), 'Real signups in the selected period', `${p.signups} in the previous period`)}
            ${growthCard('First dream within 48h', growthPercent(c.activation), growthSample(c.activation), `${growthPercent(p.activation)} in the previous period · ${c.activation.pending} still maturing`)}
            ${growthCard('Week 2 dream retention', growthPercent(c.week2), growthSample(c.week2), `${growthPercent(p.week2)} in the previous period · ${c.week2.pending} still maturing`)}
        </div>
        <div class="growth-columns">
            <section class="chart-card"><h2 class="chart-title">Subscription business</h2>
                <div class="growth-billing">
                    <div><span>Monthly recurring revenue</span><strong>${dollars(rcMetrics.mrr?.value)}</strong></div>
                    <div><span>Active subscriptions</span><strong>${growthNumber(rcMetrics.active_subscriptions?.value)}</strong></div>
                    <div><span>Active trials</span><strong>${growthNumber(rcMetrics.active_trials?.value)}</strong></div>
                    <div><span>Revenue · last 28 days</span><strong>${dollars(rcMetrics.revenue?.value)}</strong></div>
                </div><p class="growth-detail">${growthEscape(billDetail)}. These values use the provider’s own time windows and account scope, independently of the date filter. Revenue is not store payout or profit.</p>
                <a href="https://app.revenuecat.com/" target="_blank" rel="noopener">Review billing and trial cohorts ↗</a>
            </section>
            <section class="chart-card"><h2 class="chart-title">Where to focus this week</h2>
                <ol class="growth-priorities">
                    <li><strong>Get a first useful dream.</strong><span>${c.activation.eligible ? `${c.activation.eligible - c.activation.count} of ${c.activation.eligible} mature signups did not save a dream within 48 hours.` : 'Wait for signup cohorts to mature before judging activation.'}</span></li>
                    <li><strong>Build a repeat habit.</strong><span>${c.week2.eligible ? `${c.week2.count} of ${c.week2.eligible} eligible signups recorded a dream in days 7–13.` : 'Week 2 retention needs 14 days of observation.'}</span></li>
                    <li><strong>Attribute the next customer.</strong><span>Compare source quality below; give every campaign a tagged link. Keep unknown sources visible.</span></li>
                </ol>
            </section>
        </div>
        <section class="chart-card growth-section"><h2 class="chart-title">Trials → paid subscriptions</h2>
            ${billing.status === 'connected' ? `<div class="growth-billing growth-billing-cohorts"><div><span>Trial starts</span><strong>${growthNumber(billing.data.trials.started)}</strong></div><div><span>Converted from these trials</span><strong>${growthNumber(billing.data.trials.converted)}</strong></div><div><span>Trial → paid</span><strong>${billing.data.trials.percent == null ? '—' : `${billing.data.trials.percent.toFixed(1)}%`}</strong></div><div><span>Paid subscription starts</span><strong>${growthNumber(billing.data.paid.total)}</strong></div></div>
            <p class="growth-detail">${billing.data.trials.pending} trials pending · ${billing.data.trials.expired} expired without paying. ${billing.data.trials.started < 30 ? 'Small sample: avoid declaring a winner.' : ''} Trial conversion stays blank until this cohort resolves. Paid starts include conversions, resubscriptions and product changes; they are not unique first-time payers.</p>` : `<p>${sourceStatus(billing.status)}</p>`}
            <p class="growth-detail">RevenueCat · App Store and Play Store only · selected complete UTC days. Billing uses the provider’s account scope, not the product account-exclusion list.</p>
        </section>
        <section class="chart-card growth-section"><div class="growth-section-heading"><div><h2 class="chart-title">Acquisition quality</h2><p class="growth-detail">New-account cohorts → first saved dream → return in week 2.</p></div><label>Source evidence <select id="growth-attribution"><option value="reported">Self-reported source</option><option value="observed">Android install source</option></select></label></div>
            <div id="growth-channel-table"></div>
            <p class="growth-detail">${ph.status === 'connected' ? 'Source properties are joined to known signed-in accounts. Android referrers and self-reported answers remain separate; neither proves incremental marketing impact.' : `Attribution ${sourceStatus(ph.status).toLowerCase()}. Unknown does not mean organic.`} Cost per acquired customer and revenue by channel require campaign spend plus a verified billing join.</p>
        </section>
        <section class="chart-card growth-section"><h2 class="chart-title">Cohort retention</h2><p class="growth-detail">Grouped by signup week, Monday UTC. Week 2 = a dream in days 7–13; week 5 = days 28–34. Only fully observed users enter each denominator.</p>
            <div class="growth-table-wrap"><table class="growth-table"><thead><tr><th scope="col">Signup week</th><th scope="col">New accounts</th><th scope="col">First dream / 48h</th><th scope="col">Week 2</th><th scope="col">Week 5</th></tr></thead><tbody>${data.weekly.map(w => `<tr><th scope="row">${growthEscape(w.week)}${w.partial ? '<small>Partial week</small>' : ''}</th><td>${w.signups}</td>${[w.activation, w.week2, w.week5].map(m => `<td>${growthPercent(m)}<small>${m.count}/${m.eligible} eligible${m.pending ? ` · ${m.pending} pending` : ''}</small></td>`).join('')}</tr>`).join('')}</tbody></table></div>
        </section>
        <div class="growth-columns">
            <section class="chart-card"><h2 class="chart-title">Paywall friction</h2><p class="growth-detail">Unique signed-in accounts reaching each step. These are not sequential conversion rates, and app purchase events do not prove a paid trial conversion.</p>
                ${ph.status === 'connected' ? `<dl class="growth-reach">${Object.entries(eventLabels).map(([event, label]) => `<div><dt>${label}</dt><dd>${growthNumber(ph.data.events[event] || 0)}</dd></div>`).join('')}</dl>` : `<p>${sourceStatus(ph.status)}</p>`}
            </section>
            <section class="chart-card"><h2 class="chart-title">Website &amp; lifecycle</h2><dl class="growth-reach"><div><dt>Website visitors</dt><dd>${growthNumber(data.sources.web.data?.visitors)}</dd></div><div><dt>Website page views</dt><dd>${growthNumber(data.sources.web.data?.pageviews)}</dd></div>${[['email.sent','Emails sent'],['email.delivered','Delivery events'],['email.bounced','Bounced'],['email.complained','Complaints']].map(([key,label]) => `<div><dt>${label}</dt><dd>${email.status === 'connected' ? growthNumber(counts[key] || 0) : '—'}</dd></div>`).join('')}</dl>
                <p class="growth-detail">Web: ${sourceStatus(data.sources.web.status)}. Email: ${sourceStatus(email.status)}${email.data?.partial ? ' · partial history' : ''}. Email counts are distinct messages per event type in the period; they are not a delivery-rate funnel. Permanent email history begins Aug 26, 2026.</p>
            </section>
        </div>
        <details class="chart-card growth-section"><summary>Measurement plan &amp; definitions</summary>
            <div class="growth-table-wrap"><table class="growth-table"><thead><tr><th>Growth question</th><th>Track</th><th>Next measurement needed</th></tr></thead><tbody>
                <tr><th>Which content earns attention?</th><td>Reach, video hold/completion, saves, shares, outbound clicks by creative</td><td>Connect social-platform results and campaign IDs; judge winners on downstream activation.</td></tr>
                <tr><th>Does interest become an install?</th><td>Store impressions, product-page views, first-time downloads, store conversion</td><td>Connect App Store Connect and Play acquisition reports; segment by platform and source.</td></tr>
                <tr><th>Does someone get value?</th><td>First interpretation seen; first saved dream within 48h</td><td>Verify anonymous-to-account identity continuity. A pre-signup interpretation is a separate step.</td></tr>
                <tr><th>Does trial value become paid value?</th><td>Trial starts, resolved trial-to-paid, paid starts; next: renewals and refunds</td><td>Trial cohorts are connected above. Add payer-to-channel joins and renewal/refund history.</td></tr>
                <tr><th>Can we grow profitably?</th><td>Cost per activated account; customer acquisition cost; 30/60/90-day net revenue; payback</td><td>Connect spend and billing history. Include platform fees, refunds, AI costs and paid creative costs.</td></tr>
                <tr><th>Do lifecycle messages help?</th><td>Activation, paid conversion and reactivation after a message</td><td>Use a holdout where practical; delivery or an open is not product value.</td></tr>
                <tr><th>What should we try next?</th><td>One hypothesis, change, owner, success metric and decision date</td><td>Track experiments on the HQ board; compare mature cohorts and show sample sizes.</td></tr>
            </tbody></table></div>
            <p class="growth-detail">The recommended leading indicator is weekly habit builders, alongside paid growth. The 2-day habit threshold is a starting hypothesis to validate against longer retention. No universal conversion target is imposed; compare your own mature cohorts before using category benchmarks.</p>
            <p><a href="https://www.revenuecat.com/docs/dashboard-and-metrics/charts" target="_blank" rel="noopener">Billing metric definitions ↗</a> · <a href="https://developer.apple.com/help/app-store-connect-analytics/acquisition/campaign-links" target="_blank" rel="noopener">Apple campaign attribution ↗</a></p>
        </details>`;
    document.getElementById('growth-attribution').addEventListener('change', renderGrowthChannels);
    renderGrowthChannels();
}

function sourceStatus(status) {
    return ({ connected: 'Connected', not_connected: 'Not connected', unavailable: 'Unavailable for this period', loading: 'Loading…' })[status] || 'Unknown';
}

function renderGrowthChannels() {
    if (marketingData.sources.posthog.status === 'loading') {
        document.getElementById('growth-channel-table').textContent = 'Loading acquisition sources…';
        return;
    }
    const mode = document.getElementById('growth-attribution').value;
    const rows = marketingData.channels[mode];
    const known = rows.filter(row => row.source !== 'Unknown').reduce((sum, row) => sum + row.signups, 0);
    const labels = { store_search: 'Store search', friend: 'Friend / family', social_video: 'TikTok / Instagram', search_article: 'Search / article', community: 'Community / forum', podcast_youtube: 'Podcast / YouTube', other: 'Other' };
    document.getElementById('growth-channel-table').innerHTML = `<p class="growth-detail">Source coverage: ${known} / ${marketingData.current.signups} new accounts. ${mode === 'observed' ? 'Android evidence only; iOS and unlinked accounts remain unknown.' : 'Based on answers supplied during onboarding.'}</p><div class="growth-table-wrap"><table class="growth-table"><thead><tr><th scope="col">Source</th><th scope="col">New accounts</th><th scope="col">First dream / 48h</th><th scope="col">Week 2 return</th></tr></thead><tbody>${rows.length ? rows.map(row => `<tr><th scope="row">${growthEscape(labels[row.source] || row.source)}</th><td>${row.signups}</td><td>${growthPercent(row.activation)}<small>${growthSample(row.activation)}</small></td><td>${growthPercent(row.week2)}<small>${growthSample(row.week2)}</small></td></tr>`).join('') : '<tr><td colspan="4">No new accounts in this period.</td></tr>'}</tbody></table></div>`;
}
