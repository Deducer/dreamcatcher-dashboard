const {test}=require('node:test');const assert=require('node:assert/strict');
const {createChannelService,instagramMetrics}=require('../src/channels');
const {appleRows,summarizeApple}=require('../src/store-downloads');
const {playRows}=require('../src/play-downloads');
const {overview}=require('../public/acquisition-model');
const now=Date.parse('2026-09-15T12:00:00Z'),window={start:'2026-09-08T00:00:00.000Z',end:'2026-09-15T00:00:00.000Z',days:7};
const connection={provider:'instagram-standalone',accountId:'123',token:'private-token',expiresAt:'2026-11-01',syncedAt:new Date(now).toISOString()};
test('Instagram preserves missing metrics, caches exact periods, and strips credentials',async()=>{
 let calls=0;const service=createChannelService({now:()=>now,readFile:async()=>JSON.stringify(connection),fetchImpl:async(url,options)=>{calls++;assert.ok(new URL(url).searchParams.get('since')); assert.equal(options.headers.Authorization,'Bearer private-token');return {ok:true,json:async()=>({data:[{name:'views',total_value:{value:0}},{name:'reach',total_value:{value:2}}]})};}});
 const value=await service(window);assert.equal(value.instagram.data.views,0);assert.equal(value.instagram.data.website_clicks,null);assert.equal(value.instagram.partial,true);assert.ok(!JSON.stringify(value).includes('private-token'));await service(window);assert.equal(calls,1);await service({...window,start:'2026-09-09T00:00:00.000Z'});assert.equal(calls,2);
});
test('stale Postiz sync fails closed without exposing upstream errors',async()=>{
 let fetched=false;const service=createChannelService({now:()=>now,readFile:async()=>JSON.stringify({...connection,syncedAt:'2026-09-14'}),fetchImpl:async()=>{fetched=true;throw Error('secret');}});assert.equal((await service(window)).instagram.status,'access_unavailable');assert.equal(fetched,false);
});
test('invalid or absent Instagram counts are unknown, not zero',()=>assert.deepEqual(instagramMetrics({data:[{name:'views',total_value:{value:'1'}}]}),{views:null,reach:null,profile_views:null,website_clicks:null}));
test('Apple revisions replace each complete day and missing days stay unknown',()=>{
 const report=summarizeApple([{processed:'2026-09-10',rows:[{date:'2026-09-09',type:'First-time download',count:5,source:'search'},{date:'2026-09-15',type:'First-time download',count:20}]},{processed:'2026-09-11',rows:[{date:'2026-09-09',type:'First-time download',count:2,source:'search'}]}],window);
 assert.equal(report.firstTime,2);assert.equal(report.daily.length,1);assert.equal(report.partial,true);assert.equal(summarizeApple([],window).firstTime,null);
});
test('Apple parser limits app scope and rejects malformed counts',()=>{
 const header='Date\tApp Apple Identifier\tDownload Type\tCounts\n';assert.equal(appleRows(header+'2026-09-10\t123\tFirst-time download\t2\n2026-09-10\t999\tFirst-time download\t500\n','123').length,1);assert.throws(()=>appleRows(header+'2026-09-10\t123\tFirst-time download\t\n','123'));
});
test('Play reads UTF-16 reports with BOM and does not mix apps',()=>{
 const content='\ufeffDate,Package Name,Country,Daily User Installs\r\n2026-09-09,ai.thedreamcatcher.app,US,3\r\n2026-09-09,other.app,US,99\r\n';assert.deepEqual(playRows(Buffer.from(content,'utf16le'),'ai.thedreamcatcher.app'),[{date:'2026-09-09',userInstalls:3}]);assert.throws(()=>playRows(Buffer.from(content.replace(',3',','),'utf16le'),'ai.thedreamcatcher.app'));
});
test('only verified production billing enters paid-start card, never on Today',()=>{
 const marketing={sources:{billingCohorts:{status:'connected',data:{scope:'production',scopeVerified:true,paid:{total:0}}}}};assert.equal(overview({marketing}).cards[4].value,0);assert.equal(overview({marketing,today:true}).cards[4].value,'Completed days only');marketing.sources.billingCohorts.data.scope='sandbox';assert.equal(overview({marketing}).cards[4].value,'Scope unverified');
});
test('store totals are independent of AppsFlyer QA, with explicit iOS coverage',()=>{
 const m=overview({stores:{apple:{status:'connected',data:{firstTime:3,partial:true}}},mobile:{platforms:[{installs:999}]}});assert.equal(m.cards[3].value,3);assert.match(m.cards[3].definition,/iOS/);assert.match(m.cards[3].badge,/reported days/);
});
