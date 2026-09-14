# DreamCatcher marketing dashboard

The default Marketing tab answers: how are people discovering DreamCatcher,
which sources bring traffic, and what exposure and campaign measurements are
still missing? Product usage remains in the Product tab. App and billing outcomes
are collapsed under **What happens after acquisition** as a traffic-quality check.

## Acquisition operating view

Review 30 days by default, with 7- and 90-day ranges. Counts use complete UTC
days through yesterday. Unavailable provider retention windows stay unavailable.

1. **Website visitors and page views:** production website totals, with the
   previous equal-length period shown alongside. Visitors are not app installs.
2. **Referrers:** raw referring hosts, visitors, page views and share of total
   views. Visitors can overlap across rows. Direct / unknown includes absent
   referrers, not proven organic traffic. Provider `Others` is the remaining
   groups after the report limit. ChatGPT and social referrals are unclassified,
   because a referrer alone cannot establish paid versus organic acquisition.
3. **Daily page views and most viewed pages:** exact daily values are expandable.
   Page paths describe all views, not first-entry landing pages.
4. **Channel exposure:** distinguish recorded website referrals from social
   views/reach, search impressions and ad clicks/spend. The latter feeds are not
   connected. Instagram and TikTok publishing connections in Postiz do not imply
   analytics availability; the installed version does not expose that API.
5. **Campaign tags:** show campaign/source breakdowns if the provider allows them.
   On September 13, 2026, Vercel returned HTTP 402 for `utmCampaign` and `utmSource`:
   Web Analytics Plus or Enterprise is required. This release purchases no upgrade.
6. **Outcomes:** registrations, trial starts, paid subscription starts, reported
   acquisition sources and selected retention metrics. They are separate cohorts,
   not a joined website-to-install-to-payment funnel. RevenueCat paid starts can
   include resubscriptions and product changes, so they are not new paying customers.

Show counts with rates, preserve unknowns, and avoid declaring winners from small
samples. The UI marks fewer than 30 eligible people as a small sample; this is a
display caution, not a significance test or a minimum experiment size.

## Data ownership and scope

| Data | Source | Important boundary |
|---|---|---|
| Signups, saved-dream activation, habit, retention | Supabase profiles + dreams | Existing internal-account exclusion rules; all pages loaded; no dream content returned |
| Source quality | PostHog person properties joined to known accounts | Self-reported answer and Android install source shown separately; unknown never becomes organic; latest properties are not immutable first-touch attribution |
| Paywall friction | PostHog production events for known signed-in accounts | Step reach, not ordered conversion; anonymous onboarding and old event names are not mixed in |
| Subscription overview | RevenueCat overview API | Provider-wide scope; not filtered by the dashboard’s account exclusion list; lifetime proceeds are never used as MRR |
| Trials and paid starts | RevenueCat Charts API | Discover supported options; filter App Store + Play Store; use cohort totals, not average daily percentages |
| Web totals, referrers, daily views, page paths, campaign tags | Vercel Analytics | Verify echoed UTC window; visitors overlap across groups; visits cannot be joined directly to store installs |
| Email delivery events | Supabase email_events | Distinct message IDs per event type in period, not sent-cohort rates; history starts Aug 26, 2026; internal email rules applied |

Optional sources fail independently. Unconfigured sources show “Not connected”;
failed requests show “Unavailable for this period.” A failed Supabase read or account
exclusion refresh fails the core view rather than publishing partial totals.
Both endpoints are authenticated. `/api/acquisition` loads independently of
`/api/marketing`, so a slow Supabase, PostHog or billing request cannot hide traffic.
Each acquisition report has an eight-second deadline and its own availability
status. Healthy responses cache for five minutes; provider failures reduce that
response's cache lifetime to 15 seconds. Browser requests time out after 15 seconds.
The acquisition API returns only normalized dimensions and aggregate counts.

Vercel count queries use an exclusive midnight upper bound. Aggregate queries
round their inclusive upper bound up to the next hour, so they receive the final
millisecond of yesterday. Both responses must echo the exact expected UTC range;
an extra hour is rejected rather than silently mixed into complete-day reports.

## Next measurements to connect

These are visible in the dashboard’s measurement plan; they are not fabricated
as zero-valued tiles:

- **Content/creative:** reach, video hold/completion, saves/shares, outbound clicks,
  creative ID, campaign ID, and time/cash cost. Judge content by downstream
  activation and payment as well as engagement.
- **Store acquisition:** impressions, product-page views, first-time downloads,
  source, platform and store conversion. Apple campaign links provide aggregated
  attribution subject to Apple's windows and privacy thresholds, not a guaranteed
  person-level website-to-install join.
- **Economics:** paid media and creative spend, cost per activated account,
  customer acquisition cost, 30/60/90-day cohort net revenue and payback. Include
  store fees, refunds and variable AI costs when calculating contribution margin.
  Do not extrapolate lifetime value from a handful of subscribers.
- **Paid retention:** first-time payers joined to acquisition evidence, renewals,
  churn, refunds and plan-specific subscription retention. Separate grandfathered
  and comped users from paying cohorts.
- **Lifecycle impact:** activation, reactivation and paid conversion after messages;
  a holdout where practical. An email open is not evidence of product value.
- **Experiments:** hypothesis, owner, change, primary metric, guardrail, observation
  window and decision date on the HQ board. Review one bottleneck at a time.

## Configuration and deployment

Keep existing Supabase/password variables. Add server-only values from Doppler
`dreamcatcher/prd`: `POSTHOG_PERSONAL_API_KEY`, `REVENUECAT_SECRET_API_KEY`,
`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`. Optional project-ID overrides
are in `.env.example`; their defaults match the established DreamCatcher projects.
No Supabase migration, tracking event changes, or new database is required.

Run `npm test` for cohort boundaries, pagination, attribution, exact website
report windows, independent provider failures and unavailable sources. Run JavaScript syntax checks and authenticated HTTP checks for 7/30/90
days, missing auth, invalid range, and the existing Product endpoint.

Production is `https://dreamverse.projectwin.cloud`, per the July 5 cutover;
the old Dissonance URL in older notes is not the deployment target. Production
deployment and credential configuration require Ian’s explicit go. Verify the
current Coolify app/source before deploying, then verify the live authenticated
Marketing view. A local preview is not a production release.

## Reference material

- [Vercel Web Analytics API](https://vercel.com/docs/analytics/web-analytics-api)

- [RevenueCat chart definitions](https://www.revenuecat.com/docs/dashboard-and-metrics/charts)
- [RevenueCat Charts and Metrics API](https://www.revenuecat.com/docs/api-v2/charts-and-metrics)
- [Apple campaign links](https://developer.apple.com/help/app-store-connect-analytics/acquisition/campaign-links)
- [RevenueCat 2026 subscription-app benchmarks](https://www.revenuecat.com/state-of-subscription-apps)

Benchmarks provide context by category/platform/business model; they are not
DreamCatcher targets. Local source references: `src/marketing.js`,
`src/marketing-metrics.js`, and the mobile app’s `docs/dev/attribution.md`.

## Custom dates and traffic charts

Marketing has calendar presets and inclusive custom From/Through date inputs, limited to 1–366 complete UTC
calendar days ending by yesterday. Both `/api/acquisition` and `/api/marketing`
accept `start=YYYY-MM-DD&end=YYYY-MM-DD`; both inputs are required. Invalid dates,
reversed windows, future/today end dates and windows over 366 days return HTTP 400.
The server translates the inclusive end to the following UTC midnight for all
cohort calculations. Equal-duration windows on different dates have separate caches.

Presets include Yesterday, Last 7/30/90 days, This/Last week, This/Last month, Year to date and Last year. Weeks start Monday; incomplete current periods are disabled. Selecting a preset clears the custom selection. Date
changes apply to website reports and selected-period app/billing outcomes. Current
RevenueCat overview values remain explicitly current, not historical snapshots.
The separate Product tab retains its existing preset filters.

Traffic charts switch between daily page views and daily visitors, and bar or
line rendering in a full-width Chart.js chart with labeled axes and a large exact-value tooltip. Page rankings sit below the chart. Daily reports use non-overlapping 90-day requests to respect Vercel's 100-row limit; any failed chunk makes the full daily report unavailable. Daily visitors must not be summed into a unique period audience.
Exact tables display the calendar date only (`2026-09-01`), with UTC in the heading.
Source retention still limits available history; a date picker cannot recover
unavailable data. The live measurement plan now links every acquisition gap to
specific setup work rather than merely naming an unavailable feature.

## Umami primary reporting — September 13, 2026

`GET /api/acquisition` defaults to Umami; `provider=vercel` selects separate earlier reports. `live=1` selects today through now in UTC; complete-day presets and custom ranges retain the existing exclusive-end API contract. App/subscription cohorts remain complete-day only. Provider adapters convert the exclusive end to Umami's inclusive endAt by subtracting one millisecond.

The server authenticates with UMAMI_URL, UMAMI_WEBSITE_ID, UMAMI_USERNAME, UMAMI_PASSWORD and UMAMI_COLLECTION_START from runtime secrets. Tokens refresh after 30 minutes or once after a 401. Independent reports fail separately. Results cache for 60 seconds, failures for 10 seconds; no secret is returned to clients.

Reports: stats, expanded path/referrer metrics (paginated), daily pageviews/visitors (UTC chunks up to 90 days), UTM campaign/source reports (top 50, pageviews only), events, and App Download Click store values. Missing unique-visitor counts remain null. Direct pageviews are the remainder after complete referrer pagination; daily visitors are not summed into period reach. Event counts include repeats and do not establish installs.

Reporting starts September 13, 2026 at 19:32:01 UTC, the first verified accepted QA visit. Dates before coverage return not_collected. Partial periods cannot receive a misleading previous-period comparison. Vercel history is retained as a separate provider and remains subject to its retention policy.

## AppsFlyer attribution pilot — September 13, 2026

Mobile aggregate reporting now loads independently at `/api/mobile-attribution`,
using the same date controls. Rows are install-date cohorts, not all activity in
the selected dates. The pilot shows platform status, reported installs, source,
campaign and available RevenueCat event counters; device validation is still
pending. Missing data is unknown, not zero. See the [pilot setup and device test](appsflyer-pilot.md).

Runtime-only `APPSFLYER_API_TOKEN` comes from Doppler `dreamcatcher/prd`.
`APPSFLYER_API_ACCESS_UNTIL=2026-10-12` pauses refresh when the verified API trial
ends. No ongoing paid plan is enabled. The mobile SDK key is not used by this API.
