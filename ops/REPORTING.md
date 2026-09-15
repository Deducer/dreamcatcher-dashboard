# Channel reporting operations

## Connections

- Instagram Insights uses DreamCatcher's existing `instagram-standalone` Postiz connection. The installed Postiz v2.10.1 public API has no analytics route. Its provider's computed percentages are not used: the dashboard queries Meta's actual period totals directly.
- `dreamcatcher-postiz-sync.timer` runs every 15 minutes on the same VPS, reads only integration `cmr8hyn8r0001o88xfk325mux`, and atomically writes a root-only runtime connection file. Postiz owns OAuth refresh. No publishing configuration changes. The dashboard refuses connection files over one hour old, disabled connections and expired tokens.
- The root-only `/var/lib/dreamcatcher-reporting` directory is a persistent Coolify bind mount at `/app/data`. It is outside Express's public directory. The private connection is never returned from an API or logged. Source scripts contain no credentials.
- App Store Connect uses existing Doppler `dreamcatcher/prd` credentials. Standard App Downloads reports are collected, app-ID filtered, and saved in the same private mount. The complete latest processing instance replaces earlier rows for each reporting date. All segments are read. Historical normalized reports remain after signed download URLs expire. Refresh: six hours on report requests.
- Google Play reads only the country dimension for `ai.thedreamcatcher.app`, one file per month, from the bucket supplied by Ian. Other dimensions must not be added to the total. Reads require global/account-level bulk-report permission. Positive cache: six hours; access failures: one minute. Store data is shown separately; internal-track scope is not verified.
- Email uses existing stored Resend webhook events, deduplicated by email ID per event type, excluding team recipients. Marketing domain `mail.thedreamcatcher.ai` had click tracking enabled when verified September 15. This is event activity, not send-cohort conversion. No emails sent or tracking toggles changed.
- RevenueCat Charts contain production transactions only, per https://www.revenuecat.com/docs/dashboard-and-metrics/charts . Existing App Store/Play store filters exclude Test Store. Only successful, validated chart responses carry `scopeVerified`; other responses fail closed. Paid starts include conversions, returning subscriptions and product changes, not unique new customers.

## Host setup

Install `sync-postiz-instagram.cjs` and `.sh` in `/opt/dreamcatcher-reporting`; shell executable mode 700. Install the service/timer in `/etc/systemd/system`, daemon-reload, start the service, then enable the timer. Coolify application `egi9kilaq0tmeqhvfj8plwvo` owns the persistent mount and runtime env variables in `.env.example`. Existing credentials are supplied from Doppler, never committed. Changing the Postiz service name or integration ID requires updating the sync script.

Check with `systemctl status dreamcatcher-postiz-sync.timer` and file `stat` only; do not print the connection file. If refresh fails, reconnect in Postiz, run the service, and refresh the dashboard after its 15-minute cache expires. To roll back, deploy the previous dashboard commit, disable this timer, and remove this application's reporting mount; do not alter Postiz.

## Remaining work

- Ian confirmed the account-level permission was saved September 15. Google still returns 403; its API docs allow up to 48 hours for permission propagation (https://developers.google.com/android-publisher/api-ref/rest/v3/users#DeveloperLevelPermission). Agent should recheck access; confirm the data schema against the actual report before treating that platform as validated.
- ChatGPT Ads: connected through Ian's Ads Manager connector (Project Win LLC, Admin access). The dashboard reads a private imported report; it cannot invoke Ian's connector itself. The Codex heartbeat `refresh-dreamcatcher-ads-reporting` imports at 08:00 America/Denver, with four-hour checks to recover reports older than 36 hours. It requires Ian’s Mac and connector access; no connector credentials are on the VPS.
- TikTok: user says app review is pending. Publishing connection presence does not prove approved analytics access. Validate after review.
- Search Console: planned channel, not active yet.
- AppsFlyer campaign-to-subscription attribution remains on its existing task. Store downloads and paid starts do not establish a causal funnel.
- Missing history and privacy-limited store days remain unknown. Counts from different platforms are never added into unique people or cross-stage conversion rates.

## ChatGPT Ads connector imports

Use the Ads Manager insights skill. Resolve Project Win LLC by account ID, fetch daily campaign insights with completed account-local days and include zero-impression rows. Use `time_range: {type: "relative_interval", unit: "day", start_ago: 90, end_ago: 0}`, `aggregation_level: "campaign"`, `time_granularity: "daily"`, and `includes: ["zero_impression_items"]`. Read all pages; never import a truncated report. Fetch the same period without time granularity and reconcile impressions, clicks, and spend against daily sums. Fetch campaign metadata to label status as of import. No campaign mutations are needed.

The envelope is `{version: 1, importedAt: ISO_TIMESTAMP, account: {id, name, currency, timezone}, campaigns: [{id, name, status}], report: {has_more: false, data: [...]}}`. `report.data` holds the connector's original daily rows, including `readable_time`, `start_time`, `end_time`, `campaign_id`, `impressions`, `clicks`, and `spend`. Currency is USD and spend is in dollars, unlike campaign budget fields in micros. Only the verified Project Win account is accepted. Store real reports outside Git and `public/`.

Validate and atomically import with `node ops/import-chatgpt-ads.cjs /absolute/private/path/chatgpt-ads.json < report.json`. Production path on host is `/var/lib/dreamcatcher-reporting/chatgpt-ads.json`; container path is `/app/data/chatgpt-ads.json`. Keep directory mode 700 and file mode 600. Deploy the validated report through a private SSH pipe; no connector credential is copied to the server. Dashboard Refresh reads the latest file even when Instagram results remain cached.

Daily results use provider reporting-date labels, not UTC rebucketing. Account timezone name was not returned; original period boundaries are retained privately. September's source days begin at 04:00 UTC. Missing campaign/day rows are not zeros. Only dates with all report campaigns represented contribute to totals. Partial ranges are labeled, Today shows completed-days-only, and imports older than 36 hours show Refresh needed. No conversions or attribution are inferred from clicks. The scheduled connector import retains the last good file on failed reconciliation or access and reports actionable failures. The same heartbeat rechecks Google bulk-report access through the 48-hour propagation window ending September 17 at 18:11 UTC. It does not change permissions, campaigns or spending.

AppsFlyer daily export-limit responses, including HTTP 400, are shown as quota limits rather than paid-access failures. In-process retries wait until 00:00 UTC. Other transient rate limits retain their existing backoff; process restarts clear the in-memory cache. Source: https://support.appsflyer.com/hc/en-us/articles/207034366-Report-generation-quotas-rate-limitations
