/* Presentation rules shared by the overview and its state tests. */
(function(root) {
    const availability = status => ({loading:'Loading…',connected:'Available',not_collected:'No coverage',not_connected:'Not connected',not_comparable:'No comparison',plan_required:'Access required',unavailable:'Unavailable',access_unavailable:'Access required',rate_limited:'Try again later',paused:'Access paused'})[status] || 'Unavailable';
    function overview({acquisition, marketing, mobile, today=false, metric='visitors', now=Date.now()}={}) {
        const sources=acquisition?.sources || {}, totals=sources.totals, stores=sources.storeClicks;
        const stale=!!acquisition?.generatedAt && now-Date.parse(acquisition.generatedAt)>24*3600000;
        const badge=stale?'Stale snapshot':acquisition?.partialDay?'Today so far':acquisition?.partialCoverage?'Partial coverage':'';
        const value=(source,number)=>source?.status==='connected' && Number.isFinite(number)?number:availability(source?.status==='connected'?'unavailable':source?.status || (acquisition?'unavailable':'loading'));
        const storeTotal=stores?.status==='connected' && Array.isArray(stores.data) && stores.data.every(r=>Number.isFinite(r.count))?stores.data.reduce((n,r)=>n+r.count,0):null;
        const cards=[
            {id:'exposure',label:'Exposure',value:'Not connected',definition:'Views and impressions across discovery channels.'},
            {id:'website',label:'Website visits',value:value(totals,totals?.data?.visitors),definition:'Unique website visitors in the covered period.',badge:totals?.status==='connected'?badge:''},
            {id:'stores',label:'Store clicks',value:value(stores,storeTotal),definition:'Website clicks to App Store or Google Play.',badge:stores?.status==='connected'?badge:''},
            {id:'installs',label:'App installs',value:'Pilot only',definition:'Production install reporting is not validated.'},
            {id:'subscriptions',label:'Subscriptions',value:today?'Completed days only':'Scope unverified',definition:'Paid starts, including returning subscriptions.'}
        ];
        let comparison=null;
        if(!today && !stale && !acquisition?.partialCoverage && !acquisition?.partialDay && totals?.status==='connected' && sources.previous?.status==='connected') {
            const key=metric==='pageviews'?'pageviews':'visitors';
            const current=totals.data?.[key], previous=sources.previous.data?.[key];
            if(Number.isFinite(current) && Number.isFinite(previous)) comparison={current,previous,percent:previous>0?(current-previous)/previous*100:null};
        }
        const gaps=[];
        if(Object.entries(sources).some(([key,s])=>key!=='previous' && ['unavailable','access_unavailable','rate_limited','plan_required'].includes(s.status))) gaps.push({title:'A website report needs attention',detail:'Check report access, then refresh.',target:'website-setup'});
        if(mobile?.activity?.platforms?.some(p=>p.reports?.some(r=>['unavailable','access_unavailable','rate_limited','paused'].includes(r.status)))) gaps.push({title:'Mobile report access is incomplete',detail:'Review AppsFlyer access and trial limits.',target:'mobile-attribution-content'});
        if(Object.values(marketing?.sources || {}).some(s=>['unavailable','access_unavailable','rate_limited','paused'].includes(s.status))) gaps.push({title:'An app outcome report is unavailable',detail:'Check billing and app reporting access.',target:'outcome-source-status'});
        if(stale) gaps.push({title:'Website snapshot is out of date',detail:'Refresh and check the connection.',target:'website-setup'});
        gaps.push({title:'Exposure reporting is not connected',detail:'Choose the next social, search or ad source.',target:'web-measurement-plan'});
        gaps.push({title:'Confirm paid-start reporting scope',detail:'Verify production and sandbox separation.',target:'website-setup'});
        return {cards,comparison,badge,stale,gaps:gaps.slice(0,2),referrers:sources.referrers?.status==='connected'?(sources.referrers.data||[]).filter(r=>Number.isFinite(r.pageviews)).sort((a,b)=>b.pageviews-a.pageviews).slice(0,5):null,referrerStatus:availability(sources.referrers?.status || (acquisition?'unavailable':'loading'))};
    }
    const api={overview,availability};
    if(typeof module!=='undefined') module.exports=api; else root.AcquisitionModel=api;
})(globalThis);
