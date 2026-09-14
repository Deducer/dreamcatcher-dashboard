const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppsFlyerService, parseReport } = require('../src/appsflyer');

const header = 'Date,Agency/PMD (af_prt),Media Source (pid),Campaign (c),Installs,rc_trial_started_event (Event counter)';
const csv = header + '\r\n2026-09-13,None,Organic,None,4,N/A\r\n2026-09-14,None,qa_validation,"QA, ""second""",1,1\r\n';
const env = { APPSFLYER_API_TOKEN: 'server-token-do-not-return' };
const window = { days: 1, start: '2026-09-13T00:00:00.000Z', end: '2026-09-14T00:00:00.000Z' };
const now = () => Date.parse('2026-09-15T12:00:00Z');
const ok = text => new Response(text, { headers: { 'Content-Type':'text/csv' } });

test('date-grouped cohort parsing supports CSV escaping and preserves unknown events', () => {
    const rows = parseReport('\ufeff' + csv, '2026-09-13', '2026-09-15');
    assert.equal(rows[0].campaign, null);
    assert.equal(rows[0].installs, 4);
    assert.equal(rows[0].events.rc_trial_started_event, null);
    assert.equal(rows[1].campaign, 'QA, "second"');
    assert.equal(rows[1].events.rc_trial_started_event, 1);
    assert.equal(rows[1].events.rc_initial_purchase_event, null);
});

test('rejects malformed reports, duplicated headers, invalid counts and out-of-window dates', () => {
    for (const data of [
        '<html>Login required</html>',
        header + ',Installs\n2026-09-13,None,Organic,None,1,1,1',
        header + '\n2026-09-13,None,Organic,None,-2,1',
        header + '\n2026-09-13,None,Organic,None,1.5,1',
        header + '\n2026-09-16,None,Organic,None,1,1',
        header + '\n2026-02-31,None,Organic,None,1,1',
    ]) assert.throws(() => parseReport(data, '2026-09-13', '2026-09-15'));
    assert.throws(() => parseReport(header + ('\n2026-09-13,None,Organic,None,1,1').repeat(10001), '2026-09-13', '2026-09-15'));
});

test('fetches one UTC snapshot per app and filters dates locally without exhausting quota', async () => {
    const calls = [];
    const service = createAppsFlyerService({ env, now, request: async (url, options) => {
        calls.push(url);
        const u = new URL(url);
        assert.equal(u.searchParams.get('from'), '2026-09-13');
        assert.equal(u.searchParams.get('to'), '2026-09-15');
        assert.equal(u.searchParams.has('timezone'), false);
        assert.equal(options.headers.Authorization, 'Bearer ' + env.APPSFLYER_API_TOKEN);
        return ok(csv);
    } });
    const [one, duplicate] = await Promise.all([service(window), service(window)]);
    assert.equal(calls.length, 2);
    assert.equal(one.platforms[0].installs, 4);
    assert.equal(duplicate.deviceValidation, 'pending');
    assert.equal(one.platforms[0].events.rc_trial_started_event, null);
    const two = await service({ ...window, start:'2026-09-14T00:00:00.000Z', end:'2026-09-15T00:00:00.000Z' });
    assert.equal(calls.length, 2);
    assert.equal(two.platforms[0].installs, 1);
    assert.equal(two.platforms[0].events.rc_trial_started_event, 1);
    assert.equal(one.reportBasis, 'install_date_cohort');
    assert.ok(!JSON.stringify(two).includes(env.APPSFLYER_API_TOKEN));
});

test('empty and pre-coverage reports are unknown rather than zero', async () => {
    let calls = 0;
    const service = createAppsFlyerService({ env, now, request:async()=>{calls++;return ok(header+'\n');} });
    const prior = await service({ days:1,start:'2026-09-12T00:00:00Z',end:'2026-09-13T00:00:00Z' });
    assert.equal(calls, 0);
    assert.equal(prior.platforms[0].status, 'not_collected');
    const empty = await service(window);
    assert.equal(empty.platforms[0].status, 'connected');
    assert.equal(empty.platforms[0].installs, null);
    assert.deepEqual(empty.platforms[0].rows, []);
});

test('trial expiry pauses calls, even if a snapshot exists; missing credentials never call upstream', async () => {
    let time = now(), calls = 0;
    const request = async()=>{calls++;return ok(csv);};
    const service = createAppsFlyerService({ env, now:()=>time, request });
    await service(window);
    assert.equal(calls, 2);
    time=Date.parse('2026-10-12T00:00:00Z');
    const paused = await service(window);
    assert.equal(calls, 2);
    assert.equal(paused.platforms[0].status, 'paused');
    const missing = await createAppsFlyerService({env:{},now,request})(window);
    assert.equal(calls, 2);
    assert.equal(missing.platforms[0].status, 'not_connected');
});

test('platform failures stay independent; quota failures use a safe backoff without echoing provider text', async () => {
    let calls=0, time=now();
    const service = createAppsFlyerService({env,now:()=>time,request:async url=>{
        calls++;
        return url.includes('/id676') ? new Response('Limit reached '+env.APPSFLYER_API_TOKEN,{status:403}) : ok(csv);
    }});
    const result=await service(window);
    assert.equal(result.platforms[0].status,'rate_limited');
    assert.equal(result.platforms[1].status,'connected');
    assert.ok(!JSON.stringify(result).includes(env.APPSFLYER_API_TOKEN));
    await service(window);assert.equal(calls,2);
    time+=15*60000+1;await service(window);assert.equal(calls,3);
});

test('follows only allowlisted HTTPS report redirects, never forwarding a token to arbitrary hosts', async () => {
    for(const target of ['https://evil.example/report','http://hq.appsflyer.com/report','https://hq.appsflyer.com.evil.example/report','https://user:pass@hq.appsflyer.com/report']) {
        const calls=[];
        const result=await createAppsFlyerService({env,now,request:async(url)=>{calls.push(url);return new Response(null,{status:302,headers:{location:target}});}})(window);
        assert.equal(calls.length,2);
        assert.ok(calls.every(url=>url.startsWith('https://hq1.appsflyer.com/')));
        assert.ok(result.platforms.every(p=>p.status==='unavailable'));
    }
    const result=await createAppsFlyerService({env,now,request:async(url)=>url.startsWith('https://hq1.')?new Response(null,{status:302,headers:{location:'https://hq.appsflyer.com/report'}}):ok(csv)})(window);
    assert.equal(result.platforms[0].status,'connected');
});

test('oversized and non-CSV responses are rejected before any partial result is displayed', async () => {
    for(const request of [async()=>new Response('<html>error</html>',{headers:{'Content-Type':'text/html'}}),async()=>new Response('body',{headers:{'Content-Type':'text/csv','Content-Length':String(5*1024*1024)}})]) {
        const result=await createAppsFlyerService({env,now,request})(window);
        assert.equal(result.platforms[0].status,'unavailable');
        assert.equal(result.platforms[0].installs,null);
    }
});
