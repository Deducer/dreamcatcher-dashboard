# DreamCatcher marketing dashboard

The Marketing tab answers: where do new people come from, do they save a first
dream, do they return, and does that value become subscription revenue?

## Weekly operating view

Review 30 days by default, with 7- and 90-day comparisons. Counts use complete
UTC days through yesterday so product, website and billing activity use comparable
windows. RevenueCat overview values retain their own current/28-day scope.

1. **Weekly habit builders:** known external accounts saving dreams on at least
   two distinct UTC days in the last seven complete days. This is a proposed
   leading indicator, not a validated predictor of payment. Check its relationship
   to later paid retention before treating the threshold as a target.
2. **Acquisition:** new Supabase profiles, with a comparison to the previous
   equal-length period. This is signups, not downloads or RevenueCat SDK users.
3. **Activation:** a saved dream in `[signup, signup + 48h)`, among signups with
   a complete 48-hour observation window. The previous period is evaluated at its
   own end. First interpretation seen before signup is a separate value moment;
   do not assume it was saved or successfully claimed.
4. **Retention:** a saved dream in days `[7,14)` or `[28,35)` after signup, among
   accounts old enough to observe the entire window. Weekly rows show denominators
   and pending accounts. Same-day repeat submissions do not establish a habit.
5. **Payment:** RevenueCat overview MRR, active subscriptions and trials; separate
   trial-start cohorts and paid subscription starts from its Charts API. Trial
   conversion is withheld while any trial in the selected cohort remains pending.
   Paid subscription starts include resubscriptions and product changes, so the
   label intentionally does not say “new customers.” Revenue is not cash payout,
   profit, or lifetime value.

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
| Web visitors/page views | Vercel Analytics | Verify echoed UTC window; visits cannot be joined directly to store installs |
| Email delivery events | Supabase email_events | Distinct message IDs per event type in period, not sent-cohort rates; history starts Aug 26, 2026; internal email rules applied |

Optional sources fail independently. Unconfigured sources show “Not connected”;
failed requests show “Unavailable for this period.” A failed Supabase read or account
exclusion refresh fails the core view rather than publishing partial totals.
The endpoint is authenticated and cached in memory for five minutes per range;
the UI shows when the data was fetched. Refresh can reuse that cache.

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

Run `npm test` for cohort boundaries, pagination, attribution and unavailable
sources. Run JavaScript syntax checks and authenticated HTTP checks for 7/30/90
days, missing auth, invalid range, and the existing Product endpoint.

Production is `https://dreamverse.projectwin.cloud`, per the July 5 cutover;
the old Dissonance URL in older notes is not the deployment target. Production
deployment and credential configuration require Ian’s explicit go. Verify the
current Coolify app/source before deploying, then verify the live authenticated
Marketing view. A local preview is not a production release.

## Reference material

- [RevenueCat chart definitions](https://www.revenuecat.com/docs/dashboard-and-metrics/charts)
- [RevenueCat Charts and Metrics API](https://www.revenuecat.com/docs/api-v2/charts-and-metrics)
- [Apple campaign links](https://developer.apple.com/help/app-store-connect-analytics/acquisition/campaign-links)
- [RevenueCat 2026 subscription-app benchmarks](https://www.revenuecat.com/state-of-subscription-apps)

Benchmarks provide context by category/platform/business model; they are not
DreamCatcher targets. Local source references: `src/marketing.js`,
`src/marketing-metrics.js`, and the mobile app’s `docs/dev/attribution.md`.
