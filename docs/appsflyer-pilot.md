# AppsFlyer reporting and device validation

Status as of September 13, 2026 (Denver): **reporting connected; device, purchase
and paid attribution validation pending**. Mobile SDK builds are iOS 1.1.4 (54)
in TestFlight and Android 1.1.4 (35) in Play Internal Testing. Public releases do
not yet contain this SDK. Implementation: [mobile PR 105](https://github.com/Project-Win-Inc/dream-catcher-ios/pull/105).

## Dashboard connection

`GET /api/mobile-attribution` is password-authenticated and independent of website
and product queries. The same complete-day or Today UTC controls apply, but
AppsFlyer rows describe **install-date cohorts**: lifecycle events can happen after
the selected install dates. They are not all subscription activity within a period.

The server calls the aggregate `partners_by_date_report/v5` for each app, using
Doppler `dreamcatcher/prd/APPSFLYER_API_TOKEN` as a runtime-only secret. App IDs:
`id6762375451` and `ai.thedreamcatcher.app`. SDK dev keys are not reporting tokens.

Only date, agency, media source, campaign, install counts and the ten default
RevenueCat lifecycle event counters are returned. No device IDs, customer IDs,
dream content, provider errors, tokens, spend or revenue are exposed. Missing
values remain unknown, including empty reports. Provider Organic is displayed
only when actually reported. These records do not establish new customers.

Coverage starts September 13, 2026. One UTC report snapshot per app is reused
across date selections: ten minutes for reports spanning at most two days, then
four hours. Failed calls back off for 15 minutes; requests time out after eight
seconds. Redirect hosts, CSV schema, dates, counts, size and row limits are checked.
This is an in-process cache; deployments/restarts clear it. One runtime replica
is intended; multiple replicas would need a shared quota/cache.

Live API probes returned header-only iOS data and four Android Organic installs
for September 13. Origin remains unverified: store checks, test devices or
reinstalls can produce records. No RevenueCat subscription event was reported.

API access was verified under the premium trial ending October 12, 2026.
`APPSFLYER_API_ACCESS_UNTIL=2026-10-12` pauses requests at that UTC midnight.
Do not extend it without confirming continued access/cost. No paid upgrade or
ongoing free reporting entitlement is implied. An expired/unavailable API must
stay visibly unavailable; do not replace it with zeros. Evaluate available manual
exports or another provider before agreeing to ongoing fees.

## September 14 device test

1. Ian updates his **existing Android installation** through Play Internal
   Testing to **1.1.4 (35)**, opens it and signs in with an existing test account.
   Keep the installation and accounts; do not uninstall or purchase yet.
2. Record platform, build, account used and approximate UTC open/login time.
   Agent checks that customer's actual AppsFlyer ID in RevenueCat and confirms
   SDK receipt. Account changes are not new install attribution.
3. Only after that check, prepare a controlled store-mediated attribution test.
   Preserve synced user data and confirm device registration/reset requirements
   before any reinstall. The normal AppsFlyer live-test wizard expects advertising
   identifiers; this pilot disables collection and Android AD_ID permission.
   Use a provider-supported alternative matching method, not a fabricated ID or
   a changed privacy declaration. A sideload or SDK event alone is not proof.
4. Confirm the tester and store sandbox before a subscription test. Check the
   actual RevenueCat delivery and matching AppsFlyer receipt; verify one event,
   correct platform/environment and no duplicate revenue. If the store does not
   clearly show a test purchase, stop before payment. Repeat on iOS 1.1.4 (54).
5. Record pass/fail and provider timestamps in the mobile PR and HQ MMP card.
   Only verified evidence should change the dashboard's pilot labels.

Prepared QA-only link templates below follow the provider's single-platform
format. **Do not click until step 3 is ready**; creation here is not an attribution
test, link validation, device registration or campaign activation. They use an
owned QA source, not OpenAI's partner link or a billable ad:

- Android: `https://app.appsflyer.com/ai.thedreamcatcher.app?pid=qa_validation&c=dc_attribution_20260914`
- iOS: `https://app.appsflyer.com/id6762375451?pid=qa_validation&c=dc_attribution_20260914`

## ChatGPT Ads setup after validation

Each platform's AppsFlyer partner configuration needs the Ads Manager
**Pixel ID and Conversions API key**, not an ad-management API key. Save credentials
in Doppler. Keep partner activation and postbacks off during this sandbox pilot:
RevenueCat currently targets the same AppsFlyer app records for sandbox and
production, so test-event isolation must be resolved before enabling live delivery.

Proposed mappings to verify in the actual account: `rc_trial_started_event` to
`trial_started`; first paid subscription or trial conversion to
`subscription_created`. Do not map both initial purchase and trial conversion
blindly: confirm RevenueCat lifecycle semantics so one first payment is sent once.
Renewals are not newly acquired subscribers. Registration needs its own verified
event; it is not established by installing the SDK.

Use the partner-generated `openai_int` link for ChatGPT campaigns. Put OpenAI
macros in Ads Manager's Tracking parameters, not the Destination URL. If routing
through the website, verify that incoming `oppref` survives the store hop as
AppsFlyer's `clickid`; Umami UTM collection alone does not implement this join.
The full journey and actual partner receipt must pass before conversion bidding.

AppsFlyer's ChatGPT integration does **not** provide a cost API. Spend, impressions
and clicks need a separate Ads Manager reporting feed or verified export; keep
these missing until connected. No campaign, paid click, live postback or upgrade
was activated as part of the reporting adapter.

## Sources

- [Aggregate Pull API and install-date semantics](https://support.appsflyer.com/hc/en-us/articles/207034346-Pull-API-aggregate-data)
- [Partners-by-date endpoint](https://dev.appsflyer.com/hc/reference/get_app-id-partners-by-date-report-v5-1)
- [Report quotas](https://support.appsflyer.com/hc/en-us/articles/207034366-Report-generation-quotas-rate-limitations)
- [SDK device tests](https://support.appsflyer.com/hc/en-us/articles/360001559405-Testing-the-SDK-integration-for-marketers)
- [Attribution link structure](https://support.appsflyer.com/hc/en-us/articles/207447163-About-link-structure-and-parameters)
- [AppsFlyer ChatGPT integration and event mapping](https://support.appsflyer.com/hc/en-us/articles/48439655791249-ChatGPT-Ads-OpenAI-integration-setup)
- [OpenAI mobile measurement partner setup](https://help.openai.com/en/articles/20001372-set-up-mobile-measurement-partner-integrations)
