let marketingSubview='overview';
function applyMarketingView() {
    for(const view of ['overview','reports','setup']) {
        const panel=document.getElementById(`marketing-${view}`);
        if(panel) panel.hidden=view!==marketingSubview;
        const button=document.querySelector(`[data-marketing-view="${view}"]`);
        if(button) { if(view===marketingSubview) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); }
    }
    document.getElementById('marketing-status').hidden=marketingSubview==='overview';
}
function setMarketingView(view, target) {
    marketingSubview=view;
    if(view==='overview' && acquisitionProvider!=='umami') { acquisitionProvider='umami'; loadMarketing(); return; }
    applyMarketingView();
    renderTrafficTrend();
    if(target) { const el=document.getElementById(target); if(el) { el.scrollIntoView({block:'start',behavior:'smooth'}); el.setAttribute('tabindex','-1'); el.focus({preventScroll:true}); } }
}
function openStage(id) {
    setMarketingView('reports',({exposure:'report-exposure',website:'report-website',stores:'report-stores',installs:'report-installs',subscriptions:'acquisition-outcomes'})[id]);
}
function organizeReports() {
    const root=document.getElementById('acquisition-content');
    if(!root) return;
    const setup=document.getElementById('website-setup');
    const plan=root.querySelector('#web-measurement-plan');
    if(plan) {
        setup.replaceChildren();
        const coverage=root.querySelector('.acq-coverage'); if(coverage) setup.append(coverage);
        const status=document.createElement('p'); status.className='growth-detail';
        status.textContent=acquisitionData?.generatedAt?`Website snapshot checked ${new Date(acquisitionData.generatedAt).toLocaleString()}. Refresh checks the existing source cache.`:'Website snapshot is loading.';
        setup.append(status);
        const sourceList=document.createElement('dl');sourceList.className='source-status-list';
        for(const [key,source] of Object.entries(acquisitionData?.sources || {})) { const item=document.createElement('div'); const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=({totals:'Website totals',previous:'Previous period',referrers:'Referring sources',daily:'Daily traffic',pages:'Website pages',campaigns:'Campaigns',taggedSources:'Tagged sources',events:'Website events',storeClicks:'Store clicks'})[key]||key;dd.textContent=AcquisitionModel.availability(source.status);item.append(dt,dd);sourceList.append(item); }
        setup.append(sourceList,plan);
    }
    root.querySelector('.acq-kpis')?.remove();
    for(const section of root.querySelectorAll('section')) {
        const title=section.querySelector('h2')?.textContent || '';
        if(title==='Where traffic comes from') section.id='report-website';
        if(title==='Store clicks and website events') section.id='report-stores';
        if(title==='Social, search & paid distribution') { setup.append(section); }
    }
    let outcomes=document.getElementById('outcome-source-status');
    if(!outcomes) { outcomes=document.createElement('section'); outcomes.id='outcome-source-status'; setup.append(outcomes); }
    outcomes.innerHTML='<h3>App outcome reporting</h3><p class="growth-detail">Paid starts require verified production billing scope. Internal purchase and restore evidence stays in QA.</p>';
    const status=document.createElement('p'); status.className='growth-detail'; status.textContent=Object.entries(marketingData?.sources || {}).map(([key,source])=>`${({billingCohorts:'Subscription cohorts',revenuecat:'RevenueCat overview',posthog:'App source reporting'})[key] || key}: ${AcquisitionModel.availability(source.status)}`).join(' · ') || (acquisitionPreset==='today'?'App outcome reports require completed days.':'App outcome reports are loading or unavailable.'); outcomes.append(status);
    // Detailed tables stay available, but do not dominate a report on entry.
    for(const table of document.querySelectorAll('#marketing-reports .growth-table-wrap, #marketing-setup .growth-table-wrap')) {
        table.setAttribute('tabindex','0'); table.setAttribute('role','region'); table.setAttribute('aria-label','Scrollable report table');
        if(table.closest('details')) continue;
        const details=document.createElement('details'), summary=document.createElement('summary');
        details.className='report-table-details'; summary.textContent='View '+(table.querySelector('th')?.textContent.toLowerCase() || 'report')+' details';
        table.before(details); details.append(summary,table);
    }
}
function renderOverview() {
    const target=document.getElementById('marketing-overview'); if(!target) return;
    const dailyOpen=target.querySelector('.overview-info')?.open;
    const focused=target.contains(document.activeElement)?document.activeElement.id:null;
    const model=AcquisitionModel.overview({acquisition:acquisitionData,marketing:marketingData || (marketingOutcomesUnavailable?{sources:{outcomes:{status:'unavailable'}}}:null),mobile:mobileAttributionData,channels:channelData,stores:storeData,today:acquisitionPreset==='today',metric:trafficMetric});
    const e=growthEscape, n=growthNumber;
    const comparison=model.comparison?`${n(model.comparison.previous)} ${trafficMetric==='pageviews'?'page views':'visitors'} in the previous period${model.comparison.percent===null?'':` · ${model.comparison.percent>=0?'+':''}${model.comparison.percent.toFixed(1)}%`}`:'Comparison unavailable for this coverage';
    const max=Math.max(1,...(model.referrers||[]).map(r=>r.pageviews));
    const daily=acquisitionData?.sources?.daily;
    target.innerHTML=`<ol class="stage-grid" aria-label="Acquisition stages">${model.cards.map((card,i)=>`<li><button id="stage-${card.id}" class="stage-card" onclick="openStage('${card.id}')"><span class="stage-label"><span class="stage-number">${i+1}</span>${card.label}<span aria-hidden="true" class="stage-arrow">↗</span></span><strong class="stage-value ${typeof card.value==='number'?'':'stage-state'}">${typeof card.value==='number'?n(card.value):e(card.value)}</strong><span class="stage-definition">${e(card.definition)}</span>${card.badge?`<span class="compact-badge">${e(card.badge)}</span>`:''}</button></li>`).join('')}</ol>
    <section class="overview-chart"><div class="overview-section-header"><div><h2>Website traffic over time</h2><p id="overview-comparison" class="overview-caption">${e(comparison)}</p></div><div class="acq-chart-controls"><span>Visitors</span><label class="sr-only" for="overview-style">Chart style</label><select id="overview-style" onchange="trafficStyle=this.value;renderTrafficTrend()"><option value="bars" ${trafficStyle==='bars'?'selected':''}>Bars</option><option value="line" ${trafficStyle==='line'?'selected':''}>Line</option></select></div></div><div id="overview-traffic-trend"></div>
    <details class="overview-info"><summary>Daily values &amp; definition</summary><p>Umami website traffic. Visitors may repeat across days; daily visitor counts do not sum to unique visitors for the period.</p>${daily?.status==='connected'?trafficTable(daily,'UTC day','',acquisitionData?.sources?.totals?.data?.pageviews):'<p>No daily values available.</p>'}</details></section>
    <div class="overview-bottom"><section class="referrer-card"><div class="overview-section-header"><div><h2>Top referring sources</h2><p class="overview-caption">Website traffic · ranked by referred page views</p></div><button class="text-button" onclick="openStage('website')">All sources →</button></div>${model.referrers===null?`<p class="acq-empty">${e(model.referrerStatus)}</p>`:!model.referrers.length?'<p class="acq-empty">No recorded referrals for these dates.</p>':`<ol class="referrer-bars">${model.referrers.map(r=>`<li><div><span>${e(r.value||'Direct / unknown')}</span><strong>${n(r.pageviews)} <small>views</small></strong></div><span class="referrer-track"><span style="width:${100*r.pageviews/max}%"></span></span></li>`).join('')}</ol>`}</section>
    <section class="attention-card"><h2>Needs attention</h2><ul>${model.gaps.map(g=>`<li><button onclick="setMarketingView('setup','${g.target}')"><strong>${e(g.title)} <span aria-hidden="true">→</span></strong><span>${e(g.detail)}</span></button></li>`).join('')}</ul></section></div>`;
    if(marketingSubview==='overview') renderTrafficTrend();
    if(dailyOpen) target.querySelector('.overview-info').open=true;
    if(focused) document.getElementById(focused)?.focus({preventScroll:true});
}

function updateOverviewComparison() {
    const target=document.getElementById('overview-comparison'); if(!target) return;
    const comparison=AcquisitionModel.overview({acquisition:acquisitionData,today:acquisitionPreset==='today',metric:trafficMetric}).comparison;
    target.textContent=comparison?`${growthNumber(comparison.previous)} ${trafficMetric==='pageviews'?'page views':'visitors'} in the previous period${comparison.percent===null?'':` · ${comparison.percent>=0?'+':''}${comparison.percent.toFixed(1)}%`}`:'Comparison unavailable for this coverage';
}
