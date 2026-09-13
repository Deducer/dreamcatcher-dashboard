const DAY = 86400000;
const REPORTS = ['totals','previous','referrers','daily','pages','campaigns','taggedSources','events','storeClicks'];
const count = value => { if ((typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) || !Number.isSafeInteger(Number(value)) || Number(value) < 0) throw Error('Invalid count'); return Number(value); };
const rows = value => { if (!Array.isArray(value)) throw Error('Invalid rows'); return value; };
const label = value => { if (typeof value !== 'string') throw Error('Invalid label'); return value; };
const totals = data => ({visitors:count(data.visitors),pageviews:count(data.pageviews)});
function createUmamiService({env=process.env,request=fetch,now=Date.now}={}) {
    let token, tokenUntil=0, loginPromise;
    const cache=new Map();
    const origin=env.UMAMI_URL, site=env.UMAMI_WEBSITE_ID;
    const collectionStart=env.UMAMI_COLLECTION_START || '2026-09-13T19:32:01.000Z';
    async function login() {
        if(token && now()<tokenUntil) return token;
        if(!loginPromise) loginPromise=(async()=>{
            const r=await request(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:env.UMAMI_USERNAME,password:env.UMAMI_PASSWORD}),signal:AbortSignal.timeout(8000)});
            if(!r.ok) throw Error('Login failed'); const a=await r.json(); if(typeof a.token!=='string') throw Error('Invalid login');
            token=a.token;tokenUntil=now()+30*60000;return token;
        })().finally(()=>{loginPromise=null});
        return loginPromise;
    }
    async function api(path,body,retry=true) {
        const auth=await login();
        const r=await request(origin+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(8000)});
        if(r.status===401 && retry) { if(token===auth) {token=null;tokenUntil=0;} return api(path,body,false); }
        if(!r.ok) throw Error('Report unavailable');return r.json();
    }
    function params(window,extra={}) {return new URLSearchParams({startAt:Date.parse(window.start),endAt:Date.parse(window.end)-1,...extra});}
    const path=(route,window,extra)=>`/api/websites/${site}/${route}?${params(window,extra)}`;
    const safe=async fn=>{try{return {status:'connected',data:await fn(),fetchedAt:new Date(now()).toISOString()};}catch{return {status:'unavailable',data:null};}};
    async function breakdown(window,type) {
        let result=[];
        for(let offset=0;offset<10000;offset+=500) {
            const data=rows(await api(path('metrics/expanded',window,{type,limit:500,offset})));
            result.push(...data.map(r=>({value:label(r.name),visitors:count(r.visitors),pageviews:count(r.pageviews)})));
            if(data.length<500) return result;
        }
        throw Error('Incomplete breakdown');
    }
    async function daily(window) {
        const result=[];
        for(let start=Date.parse(window.start);start<Date.parse(window.end);start=next) {
            var next=Math.min(Date.parse(new Date(start).toISOString().slice(0,10))+90*DAY,Date.parse(window.end));
            const chunk={start:new Date(start).toISOString(),end:new Date(next).toISOString()};
            const data=await api(path('pageviews',chunk,{unit:'day',timezone:'UTC'}));
            const normalizeDate=x=>{const value=label(x).replace(' ','T');const day=new Date(value.endsWith('Z')?value:value+'Z').toISOString().slice(0,10);if(day<chunk.start.slice(0,10)||Date.parse(day)>=Date.parse(chunk.end)) throw Error('Invalid day');return day;};
            const visitors=new Map(rows(data.sessions).map(r=>[normalizeDate(r.x),count(r.y)]));
            const views=new Map(rows(data.pageviews).map(r=>[normalizeDate(r.x),count(r.y)]));
            for(let day=Date.parse(chunk.start.slice(0,10));day<Date.parse(chunk.end);day+=DAY) {
                const value=new Date(day).toISOString().slice(0,10);
                result.push({value,visitors:visitors.get(value)||0,pageviews:views.get(value)||0});
            }
        }
        return result;
    }
    return async window=>{
        const configured=origin && site && env.UMAMI_USERNAME && env.UMAMI_PASSWORD;
        const coveredStart=new Date(Math.max(Date.parse(window.start),Date.parse(collectionStart))).toISOString();
        const base={...window,provider:'umami',collectionStart,coverageStart:coveredStart,coverageEnd:window.end,partialCoverage:coveredStart!==window.start,generatedAt:new Date(now()).toISOString()};
        if(!configured || Date.parse(coveredStart)>=Date.parse(window.end)) return {...base,sources:Object.fromEntries(REPORTS.map(key=>[key,{status:configured?'not_collected':'not_connected',data:null}]))};
        const covered={...window,start:coveredStart};const key=window.start+':'+window.end;
        const cached=cache.get(key);if(cached && now()-cached.at<cached.ttl) return cached.promise;
        const entry={at:now(),ttl:60000};
        entry.promise=(async()=>{
            const previousEnd=Date.parse(window.start),previousStart=previousEnd-window.days*DAY;
            const previousWindow={start:new Date(previousStart).toISOString(),end:window.start};
            const utmPromise=safe(()=>api('/api/reports/utm',{websiteId:site,type:'utm',filters:{},parameters:{startDate:covered.start,endDate:new Date(Date.parse(covered.end)-1).toISOString()}}));
            const [current,previous,referrers,trend,pages,utm,events,storeClicks]=await Promise.all([
                safe(async()=>totals(await api(path('stats',covered)))),
                previousStart>=Date.parse(collectionStart) && !base.partialCoverage && !window.partialDay ? safe(async()=>totals(await api(path('stats',previousWindow)))) : {status:'not_comparable',data:null},
                safe(()=>breakdown(covered,'referrer')),safe(()=>daily(covered)),safe(()=>breakdown(covered,'path')),utmPromise,
                safe(async()=>rows(await api(path('metrics',covered,{type:'event',limit:100}))).map(r=>({value:label(r.x),count:count(r.y)}))),
                safe(async()=>rows(await api(path('event-data/values',covered,{eventName:'App Download Click',propertyName:'store'}))).map(r=>({value:label(r.value),count:count(r.total)}))),
            ]);
            if(current.status==='connected' && referrers.status==='connected') {
                const direct=current.data.pageviews-referrers.data.reduce((sum,r)=>sum+r.pageviews,0);
                if(direct<0) {referrers.status='unavailable';referrers.data=null;}
                else if(direct>0) referrers.data.unshift({value:'',visitors:null,pageviews:direct});
            }
            const tagReport=key=>{
                if(utm.status!=='connected') return {status:utm.status,data:null};
                try{return {...utm,data:rows(utm.data[key]).map(r=>({value:label(r.utm),visitors:null,pageviews:count(r.views)})),limit:50};}catch{return {status:'unavailable',data:null};}
            };
            const sources={totals:current,previous,referrers,daily:trend,pages,campaigns:tagReport('utm_campaign'),taggedSources:tagReport('utm_source'),events,storeClicks};
            if(Object.values(sources).some(s=>s.status==='unavailable'))entry.ttl=10000;
            return {...base,sources};
        })();
        if(cache.size>20)cache.clear();cache.set(key,entry);return entry.promise;
    };
}
module.exports={createUmamiService};
