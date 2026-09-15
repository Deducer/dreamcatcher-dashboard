const test = require('node:test');
const assert = require('node:assert/strict');
const {parseActivity,summarize,rawReport,REPORTS,createMobileResultsService} = require('../src/mobile-results');
const from='2026-09-13T00:00:00.000Z', end='2026-09-16T00:00:00.000Z';
const header='AppsFlyer ID,Customer User ID,Event Time,Event Name,Media Source,Campaign,Event Revenue USD,App Version,Event Value,Is Primary Attribution';
const csv = header+'\ndevice,internal,2026-09-15 14:07:57,rc_initial_purchase_event,,,29.99,1.1.4,{},true\n';
const ok=text=>new Response(text,{headers:{'Content-Type':'text/csv'}});
const app={id:'ai.thedreamcatcher.app',label:'Android'};
function reports(rows) { return REPORTS.map(([name])=>({name,status:'connected',rows:name==='organic_in_app_events_report'?rows:[]})); }
test('uses event UTC time, preserves unknown campaign, never exposes private fields in summaries',()=>{
    const raw=parseActivity(csv,REPORTS[3],from,end);
    const result=summarize(app,reports(raw),{start:'2026-09-15T00:00:00.000Z',end},new Set(['internal']));
    assert.equal(result.qa.events,1); assert.equal(result.rows[0].source,'Organic'); assert.equal(result.rows[0].campaign,null);
    for(const field of ['device','customer','key','Event Value']) assert.equal(Object.hasOwn(result.rows[0],field),false);
    assert.equal(result.rows[0].valueUsd,29.99);
    assert.equal(summarize(app,reports(raw),{start:from,end:'2026-09-15T00:00:00.000Z'},new Set()).rowCount,0);
});
test('links known internal event devices to installs, deduplicates rows, and never assumes unmatched means production',()=>{
    const raw=parseActivity(csv,REPORTS[3],from,end); const install={...raw[0],kind:'install',customer:'',key:'install-key'};
    const list=reports([...raw,...raw]);list[0].rows=[install];
    const result=summarize(app,list,{start:from,end},new Set(['internal']));
    assert.equal(result.qa.events,1);assert.equal(result.qa.installs,1);
    const unmatched=summarize(app,reports(raw),{start:from,end},new Set());
    assert.equal(unmatched.rows[0].classification,'unclassified');
    assert.ok(!JSON.stringify(unmatched).includes('"production"'));
});
test('partial failures produce unknown counts, not a misleading zero or complete total',()=>{
    const list=reports(parseActivity(csv,REPORTS[3],from,end));list[2].status='access_unavailable';
    const r=summarize(app,list,{start:from,end},new Set(['internal']));
    assert.equal(r.status,'partial');assert.equal(r.qa.events,null);assert.equal(r.rowCount,1);assert.equal(r.qa.installs,0);
});
test('fails closed on malformed, truncated, invalid-date, out-of-window or invalid-value reports',()=>{
    for(const bad of ['<html>oops</html>',csv.replace('2026-09-15','2026-02-31'),csv.replace('2026-09-15','2026-09-17'),csv.replace('29.99','NaN'),header+'\n'+csv.split('\n')[1].repeat(10000)]) assert.throws(()=>parseActivity(bad,REPORTS[3],from,end));
    assert.throws(()=>parseActivity(header+'\n'+(csv.split('\n')[1]+'\n').repeat(10000),REPORTS[3],from,end));
    assert.equal(parseActivity(header+'\n',REPORTS[3],from,end).length,0);
});
test('signed raw-data redirect never receives bearer; hostile URLs never receive requests',async()=>{
    const calls=[];
    const result=await rawReport({app,report:REPORTS[3],from,end,token:'private-token',request:async(url,options)=>{calls.push({url,options});return calls.length===1?new Response(null,{status:302,headers:{location:'https://rawdata.appsflyer.com/report?signed=private'}}):ok(csv);}});
    assert.equal(result.status,'connected');assert.equal(calls[0].options.headers.Authorization,'Bearer private-token');assert.equal(calls[1].options.headers.Authorization,undefined);
    for(const target of ['https://evil.example/report','http://hq1.appsflyer.com/report','https://user:pass@rawdata.appsflyer.com/report']) {
        let count=0;await assert.rejects(()=>rawReport({app,report:REPORTS[0],from,end,token:'private-token',request:async()=>{count++;return new Response(null,{status:302,headers:{location:target}});}}));assert.equal(count,1);
    }
});
test('date filter reuses report cache; expiry stops provider calls; service never returns identities',async()=>{
    let time=Date.parse('2026-09-15T18:00:00Z'),calls=0;
    const service=createMobileResultsService({env:{APPSFLYER_API_TOKEN:'secret'},now:()=>time,getExcludedIds:async()=>new Set(['internal']),request:async()=>{calls++;return ok(csv);}});
    const w={start:from,end:new Date(time).toISOString()};
    const first=await service(w);assert.equal(calls,12);assert.equal(first.platforms.length,2);assert.ok(!JSON.stringify(first).includes('private-token'));
    await service({...w,start:'2026-09-15T00:00:00.000Z'});assert.equal(calls,12);
    time=Date.parse('2026-10-12T00:00:00Z');const paused=await service(w);assert.equal(calls,12);assert.equal(paused.platforms[0].status,'paused');
});
test('provider plan denial is explicit even on HTTP 400, without leaking provider response',async()=>{
    const r=await rawReport({app,report:REPORTS[4],from,end,token:'sensitive',request:async()=>new Response("Your current subscription package doesn't include raw data reports. sensitive",{status:400})});
    assert.equal(r.status,'access_unavailable');assert.ok(!JSON.stringify(r).includes('sensitive'));
});
