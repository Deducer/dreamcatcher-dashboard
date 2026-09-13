const test=require('node:test');const assert=require('node:assert/strict');const {createUmamiService}=require('../src/umami');
const env={UMAMI_URL:'https://analytics.example',UMAMI_WEBSITE_ID:'site',UMAMI_USERNAME:'reader',UMAMI_PASSWORD:'never-return',UMAMI_COLLECTION_START:'2026-09-13T19:32:01.000Z'};
const window={days:1,start:'2026-09-13T00:00:00.000Z',end:'2026-09-13T20:00:00.000Z',partialDay:true};
function fixture({fail='',authFailure=false}={}) {
    const calls=[];let loginCount=0, expired=false;
    const request=async (url,options)=>{
        const u=new URL(url);calls.push({url:u,options});
        const ok=data=>({ok:true,status:200,json:async()=>data});
        if(u.pathname==='/api/auth/login'){loginCount++;return ok({token:'token-'+loginCount});}
        if(authFailure&&!expired){expired=true;return {ok:false,status:401};}
        if(fail&&u.pathname.endsWith(fail))throw Error('private upstream failure');
        assert.ok(options.headers.Authorization.startsWith('Bearer token-'));
        if(u.pathname==='/api/reports/utm'){const body=JSON.parse(options.body);assert.equal(body.parameters.endDate,'2026-09-13T19:59:59.999Z');return ok({utm_campaign:[{utm:'launch',views:'2'}],utm_source:[{utm:'instagram',views:2}]});}
        assert.equal(u.searchParams.get('endAt'),String(Date.parse(window.end)-1));
        assert.equal(u.searchParams.get('startAt'),String(Date.parse(env.UMAMI_COLLECTION_START)));
        if(u.pathname.endsWith('/stats'))return ok({visitors:1,pageviews:2});
        if(u.pathname.endsWith('/pageviews'))return ok({pageviews:[{x:'2026-09-13 00:00:00',y:2}],sessions:[{x:'2026-09-13 00:00:00',y:1}]});
        if(u.pathname.endsWith('/metrics/expanded'))return ok(u.searchParams.get('type')==='referrer'?[]:[{name:'/',visitors:1,pageviews:'2'}]);
        if(u.pathname.endsWith('/metrics'))return ok([{x:'App Download Click',y:1}]);
        if(u.pathname.endsWith('/values'))return ok([{value:'ios',total:'1'}]);
        throw Error('Unexpected endpoint');
    };return {request,calls,get loginCount(){return loginCount}};
}
test('Umami clips to real coverage, excludes inclusive upper millisecond, preserves unknown visitors and reports actions separately',async()=>{
    const f=fixture();const service=createUmamiService({env,request:f.request,now:()=>Date.parse(window.end)});const result=await service(window);
    assert.equal(f.loginCount,1);assert.equal(result.partialCoverage,true);assert.equal(result.sources.previous.status,'not_comparable');
    assert.deepEqual(result.sources.totals.data,{visitors:1,pageviews:2});
    assert.deepEqual(result.sources.campaigns.data,[{value:'launch',visitors:null,pageviews:2}]);
    assert.deepEqual(result.sources.referrers.data,[{value:'',visitors:null,pageviews:2}]);
    assert.deepEqual(result.sources.daily.data,[{value:'2026-09-13',visitors:1,pageviews:2}]);
    assert.deepEqual(result.sources.storeClicks.data,[{value:'ios',count:1}]);
    assert.ok(!JSON.stringify(result).includes('never-return'));await service(window);assert.equal(f.loginCount,1);
});
test('dates before installation are unknown, not zero, and make no provider calls',async()=>{
    const result=await createUmamiService({env,request:()=>{throw Error('Must not call')}})({...window,start:'2026-09-01T00:00:00Z',end:'2026-09-02T00:00:00Z'});
    assert.ok(Object.values(result.sources).every(s=>s.status==='not_collected'&&s.data===null));
});
test('failed optional source does not hide traffic and expired authentication is refreshed once',async()=>{
    const f=fixture({fail:'/values',authFailure:true});const result=await createUmamiService({env,request:f.request})(window);
    assert.equal(result.sources.storeClicks.status,'unavailable');assert.equal(result.sources.totals.status,'connected');assert.equal(f.loginCount,2);
    assert.ok(!JSON.stringify(result).includes('private upstream'));
});
test('daily queries preserve UTC boundaries over long windows including a partial first day',async()=>{
    const start='2025-01-01T15:00:00.000Z',end='2026-01-02T00:00:00.000Z';const chunks=[];
    const request=async(url,options)=>{const u=new URL(url);const ok=data=>({ok:true,status:200,json:async()=>data});
        if(u.pathname.endsWith('/login'))return ok({token:'test'});
        if(u.pathname.endsWith('/pageviews')){chunks.push([Number(u.searchParams.get('startAt')),Number(u.searchParams.get('endAt'))]);return ok({pageviews:[],sessions:[]});}
        if(u.pathname.endsWith('/stats'))return ok({visitors:0,pageviews:0});
        if(u.pathname.endsWith('/utm'))return ok({utm_campaign:[],utm_source:[]});return ok([]);
    };
    const result=await createUmamiService({env:{...env,UMAMI_COLLECTION_START:start},request})({days:366,start,end});
    assert.equal(result.sources.daily.data.length,366);assert.equal(new Set(result.sources.daily.data.map(d=>d.value)).size,366);
    assert.equal(chunks[0][0],Date.parse(start));assert.equal(chunks.at(-1)[1],Date.parse(end)-1);
    for(let i=1;i<chunks.length;i++){assert.equal(chunks[i][0],chunks[i-1][1]+1);assert.equal(chunks[i][0]%86400000,0);}
});
