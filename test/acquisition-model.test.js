const {test}=require('node:test');
const assert=require('node:assert/strict');
const {overview}=require('../public/acquisition-model');
const {presetDates}=require('../public/date-presets');
const now=Date.parse('2026-09-15T21:00:00Z');
const connected=data=>({status:'connected',data});
function data(extra={}) { return {provider:'umami',generatedAt:new Date(now).toISOString(),sources:{totals:connected({visitors:20,pageviews:40}),storeClicks:connected([{value:'ios',count:2},{value:'android',count:3}]),previous:connected({visitors:10,pageviews:20}),referrers:connected([{value:'google.com',pageviews:8},{value:'',pageviews:12}])},...extra}; }
test('default period is seven completed UTC days even near local midnight',()=>assert.deepEqual(presetDates('7d',now),{start:'2026-09-08',end:'2026-09-14'}));
test('measured values and comparable period, not joined funnel rates',()=>{
 const m=overview({acquisition:data(),now});assert.equal(m.cards[1].value,20);assert.equal(m.cards[2].value,5);assert.equal(m.comparison.percent,100);assert.equal(m.referrers[0].value,'');assert.equal(m.cards.some(c=>'conversion' in c),false);
});
test('empty connected source is zero, loading and unavailable are not',()=>{
 assert.equal(overview({acquisition:data({sources:{totals:connected({visitors:0}),storeClicks:connected([])}}),now}).cards[2].value,0);
 assert.equal(overview({now}).cards[1].value,'Loading…');
 assert.equal(overview({acquisition:{sources:{totals:{status:'unavailable'}}},now}).cards[1].value,'Unavailable');
 assert.equal(overview({acquisition:{sources:{totals:{status:'not_collected'}}},now}).cards[1].value,'No coverage');
});
test('partial, stale and today do not compare against full periods',()=>{
 for(const extra of [{partialCoverage:true},{partialDay:true},{generatedAt:'2026-09-12T00:00:00Z'}]) assert.equal(overview({acquisition:data(extra),now}).comparison,null);
 assert.equal(overview({acquisition:data({partialCoverage:true}),now}).cards[1].badge,'Partial coverage');
 assert.equal(overview({acquisition:data({generatedAt:'2026-09-12T00:00:00Z'}),now}).cards[1].badge,'Stale snapshot');
 assert.equal(overview({acquisition:data(),today:true,now}).cards[4].value,'Completed days only');
});
test('QA and unclassified totals never enter business cards; unverified billing never promoted',()=>{
 const m=overview({acquisition:data(),mobile:{platforms:[{installs:200}],activity:{platforms:[{qa:{installs:100},unclassified:{installs:100}}]}},marketing:{sources:{billingCohorts:connected({paid:{total:999}})}},now});
 assert.equal(m.cards[3].value,'Pilot only');assert.equal(m.cards[4].value,'Scope unverified');assert.equal(m.cards[0].value,'Not connected');
});
test('access failures precede missing connections, no more than two attention items',()=>{
 const m=overview({acquisition:{sources:{totals:{status:'unavailable'}}},mobile:{activity:{platforms:[{reports:[{status:'access_unavailable'}]}]}},now});
 assert.equal(m.gaps.length,2);assert.equal(m.gaps[0].target,'website-setup');assert.equal(m.gaps[1].target,'mobile-attribution-content');
});
test('zero previous period has a count but no invented percentage',()=>{ const d=data();d.sources.previous.data.visitors=0;assert.equal(overview({acquisition:d,now}).comparison.percent,null); });
test('malformed connected counts stay unavailable and page-view comparisons use page views',()=>{
 const d=data();d.sources.totals.data.visitors=null;d.sources.storeClicks.data=[{count:null}];
 const m=overview({acquisition:d,now});assert.equal(m.cards[1].value,'Unavailable');assert.equal(m.cards[2].value,'Unavailable');assert.equal(m.comparison,null);
 assert.deepEqual(overview({acquisition:d,metric:'pageviews',now}).comparison,{current:40,previous:20,percent:100});
});
