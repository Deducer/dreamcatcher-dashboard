const crypto=require('node:crypto');
const {parse}=require('csv-parse/sync');
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function playRows(bytes, packageName) {
    const text=bytes[0]===255&&bytes[1]===254?bytes.toString('utf16le'):bytes.toString('utf8');
    const rows=parse(text,{columns:true,bom:true,skip_empty_lines:true});
    return rows.filter(r=>r['Package Name']===packageName).map(r=>{
        const count=r['Daily User Installs'];
        if(!/^\d{4}-\d{2}-\d{2}$/.test(r.Date)||!/^\d+$/.test(count))throw Error('Invalid Play statistics');
        return {date:r.Date,userInstalls:Number(count)};
    });
}
function createPlayService({env=process.env,fetchImpl=fetch,now=Date.now}={}) {
    const cache=new Map();
    return async window=>{
        const key=window.start+':'+window.end,hit=cache.get(key);
        if(hit&&now()-hit.at<(hit.value.status==='connected'?6*3600000:60000))return hit.value;
        let value;
        try {
            const bucket=env.GOOGLE_PLAY_REPORT_BUCKET;
            if(!/^pubsite_prod_\d+$/.test(bucket||''))throw Error('Bucket missing');
            const service=JSON.parse(Buffer.from(env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_BASE64,'base64'));
            const seconds=Math.floor(now()/1000),input=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:service.client_email,scope:'https://www.googleapis.com/auth/devstorage.read_only',aud:'https://oauth2.googleapis.com/token',iat:seconds,exp:seconds+3600});
            const assertion=input+'.'+crypto.sign('RSA-SHA256',Buffer.from(input),service.private_key).toString('base64url');
            const auth=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(10000)});
            const token=(await auth.json()).access_token;if(!auth.ok||!token)throw Error('OAuth failed');
            const packageName='ai.thedreamcatcher.app', rows=[];let missingMonths=0;
            for(let date=new Date(window.start.slice(0,7)+'-01');date<Date.parse(window.end);date.setUTCMonth(date.getUTCMonth()+1)) {
                const month=date.toISOString().slice(0,7).replace('-','');
                // One dimension only: adding other dimension files duplicates totals.
                const object=`stats/installs/installs_${packageName}_${month}_country.csv`;
                const r=await fetchImpl(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}?alt=media`,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
                if(r.status===404){missingMonths++;continue;}if(!r.ok)throw Error('Report access denied');
                rows.push(...playRows(Buffer.from(await r.arrayBuffer()),packageName));
            }
            const grouped=new Map();for(const r of rows)if(r.date>=window.start.slice(0,10)&&r.date<window.end.slice(0,10))grouped.set(r.date,(grouped.get(r.date)||0)+r.userInstalls);
            const daily=[...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([date,userInstalls])=>({date,userInstalls}));
            value={status:'connected',data:{userInstalls:daily.length?daily.reduce((n,r)=>n+r.userInstalls,0):null,daily,reportedDays:daily.length,through:daily.at(-1)?.date||null,partial:!!missingMonths||daily.length<window.days},checkedAt:new Date(now()).toISOString(),definition:'Google Play daily user installs, by store reporting date. Includes available tracks; internal-test separation is not verified. Not added to iOS or AppsFlyer totals.'};
        } catch {value={status:'access_unavailable',data:null,action:'Google still denies report access. Ian confirmed the account-level permission was saved Sep 15. Agent: recheck after permission propagation; Google says changes can take up to 48 hours.'};}
        cache.set(key,{at:now(),value});if(cache.size>100)cache.delete(cache.keys().next().value);return value;
    };
}
module.exports={createPlayService,playRows};
