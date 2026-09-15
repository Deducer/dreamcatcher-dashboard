const crypto = require('node:crypto');
const zlib = require('node:zlib');
const fs = require('node:fs/promises');
const { parse } = require('csv-parse/sync');
const DAY = 86400000;
const enc = x => Buffer.from(JSON.stringify(x)).toString('base64url');
function appleRows(text, appId) {
    return parse(text, { columns: true, delimiter: '\t', bom: true, skip_empty_lines: true }).filter(r => String(r['App Apple Identifier']) === String(appId)).map(r => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(r.Date) || !/^\d+$/.test(r.Counts)) throw Error('Invalid Apple report');
        return { date: r.Date, type: r['Download Type'], count: Number(r.Counts), source: r['Source Type'] || 'Unknown' };
    });
}
function summarizeApple(instances, window) {
    // A later processing instance replaces the entire earlier day, not just
    // matching dimensional rows. Otherwise corrected reports double count.
    const days = new Map();
    for (const instance of [...instances].sort((a,b) => a.processed.localeCompare(b.processed))) {
        const grouped = new Map();
        for (const row of instance.rows) {
            if (row.date < window.start.slice(0,10) || row.date >= window.end.slice(0,10)) continue;
            if (!grouped.has(row.date)) grouped.set(row.date, []);
            grouped.get(row.date).push(row);
        }
        for (const [date, rows] of grouped) days.set(date, rows);
    }
    const daily = [...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,rows]) => ({date,firstTime:rows.filter(r=>r.type==='First-time download').reduce((n,r)=>n+r.count,0),redownloads:rows.filter(r=>r.type==='Redownload').reduce((n,r)=>n+r.count,0)}));
    const sourceCounts = {};
    for (const rows of days.values()) for (const r of rows) if(r.type==='First-time download') sourceCounts[r.source]=(sourceCounts[r.source]||0)+r.count;
    return { firstTime: daily.length ? daily.reduce((n,r)=>n+r.firstTime,0) : null, redownloads:daily.length?daily.reduce((n,r)=>n+r.redownloads,0):null, daily, sources:Object.entries(sourceCounts).map(([source,count])=>({source,count})), reportedDays:daily.length, partial:daily.length<window.days, through:daily.at(-1)?.date || null };
}
function createStoreService({env=process.env,fetchImpl=fetch,now=Date.now}={}) {
    let cached, pending;
    const play = require('./play-downloads').createPlayService({env,fetchImpl,now});
    const file = (env.REPORTING_DATA_DIR || '/app/data') + '/apple-downloads.json';
    const get = async (url, token) => { const r=await fetchImpl(url,{headers:token?{Authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Report HTTP '+r.status);return r; };
    async function collectApple() {
        const input=enc({alg:'ES256',kid:env.ASC_KEY_ID,typ:'JWT'})+'.'+enc({iss:env.ASC_ISSUER_ID,exp:Math.floor(now()/1000)+600,aud:'appstoreconnect-v1'});
        const token=input+'.'+crypto.sign('sha256',Buffer.from(input),{key:Buffer.from(env.ASC_KEY_BASE64,'base64'),dsaEncoding:'ieee-p1363'}).toString('base64url');
        const base='https://api.appstoreconnect.apple.com/v1';
        async function list(path) {let url=base+path,rows=[];for(let page=0;url&&page<30;page++){if(!url.startsWith(base+'/'))throw Error('Invalid pagination');const d=await(await get(url,token)).json();rows.push(...d.data);url=d.links?.next;}if(url)throw Error('Report pagination incomplete');return rows;}
        const reports=await list('/analyticsReportRequests/'+encodeURIComponent(env.ASC_ANALYTICS_REQUEST_ID)+'/reports?filter[category]=COMMERCE&limit=200');
        const report=reports.find(r=>r.attributes.name==='App Downloads Standard');if(!report)throw Error('Download report missing');
        const instances=await list('/analyticsReports/'+report.id+'/instances?filter[granularity]=DAILY&limit=200');
        const previous=new Map((cached?.instances||[]).map(i=>[i.id,i]));
        const results=[];let cursor=0;
        await Promise.all(Array.from({length:4},async()=>{while(cursor<instances.length){const i=instances[cursor++];if(previous.has(i.id)){results.push(previous.get(i.id));continue;}const segments=await list('/analyticsReportInstances/'+i.id+'/segments?limit=200');let rows=[];for(const s of segments){const url=new URL(s.attributes.url);if(url.protocol!=='https:')throw Error('Invalid report URL');const r=await get(url.href);let bytes=Buffer.from(await r.arrayBuffer());if(bytes[0]===31&&bytes[1]===139)bytes=zlib.gunzipSync(bytes);rows.push(...appleRows(bytes.toString(),env.ASC_APP_ID));}results.push({id:i.id,processed:i.attributes.processingDate,rows});}}));
        // Retain historical instances after Apple's download URL retention ends.
        for(const [id,i] of previous) if(!results.some(r=>r.id===id))results.push(i);
        const result={at:now(),instances:results};await fs.mkdir(require('node:path').dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(result),{mode:0o600});await fs.rename(file+'.tmp',file);cached=result;return result;
    }
    return async window => {
        if(window.partialDay)return {apple:{status:'completed_days_only',data:null},android:{status:'completed_days_only',data:null}};
        const androidResult = play(window);
        let apple;
        try {
            if(!cached)try{cached=JSON.parse(await fs.readFile(file,'utf8'));}catch{}
            if(!cached||now()-cached.at>6*3600000){if(!pending)pending=collectApple().finally(()=>{pending=null;});await pending;}
            apple={status:'connected',data:summarizeApple(cached.instances,window),checkedAt:new Date(cached.at).toISOString(),definition:'First-time App Store downloads. Redownloads are separate. Missing report days are not zero.'};
        }catch{apple={status:'access_unavailable',data:null,action:'Agent: check App Store Connect report access and collection.'};}
        return {start:window.start,end:window.end,apple,android:await androidResult};
    };
}
module.exports={createStoreService,appleRows,summarizeApple};
