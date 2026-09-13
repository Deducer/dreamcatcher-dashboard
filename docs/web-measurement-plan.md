# DreamCatcher web measurement setup proposal

Reviewed September 13, 2026. Recommendation: select one primary web acquisition
collector, connect platform exposure separately, then evaluate AppsFlyer for the
store-to-paid-subscription link. This document proposes setup; it does not imply
that Umami, Clarity or AppsFlyer are connected.

## What is already present

- Vercel Web Analytics is mounted in the marketing site's `0/src/main.tsx` and
  returns real production visitors, page views, referring hosts and daily data.
- `0/src/lib/analytics.ts` already attempts named events for App Download Click
  (store/location), trial-dream actions, partner attribution and scroll depth.
  Instrumentation in source is not proof that the current plan accepts/reports it.
- No Umami or Clarity script was found in the marketing source. No corresponding
  secret names were found in the accessible DreamCatcher/Project Win configs.
- Vercel campaign-tag queries return HTTP 402. The current response does not
  provide the previous 30-day or 90-day periods. Keep unknowns visible.

## First: choose the web collector and finish measurement

**Preferred candidate: Umami**, if an existing maintained instance is available
and we can obtain reporting access. Its official documentation covers campaign
parameters and custom events. Confirm the instance version, website ownership,
API compatibility, retention/backups and maintenance cost before selecting it.
Self-hosted software does not mean hosting and operation have no cost.

Setup scope: add `thedreamcatcher.ai` as a site, install the collector on approved
public marketing routes, and capture source/medium/campaign/content tags plus
App Store and Google Play outbound clicks. Reuse existing event wrappers after
verifying current event behavior. Return daily totals, referrers, campaign and
landing-page breakdowns to this dashboard with a collection-start date. Use
explicit event allowlists and sanitized paths; never collect dream text, share
tokens, account identifiers or OAuth callback values. Test tagged links through
the live site and confirm ingestion, aggregation and dashboard readback.

**Alternative: Vercel Pro plus Web Analytics Plus.** Fewer integration changes,
but verify total account cost first. The published Plus price is an additional
$10/month per team on Pro, not a standalone $10 Hobby upgrade. Published reporting
windows: Hobby one month, Pro 12 months, Plus 24 months. Hobby excludes custom
events and UTM parameters. Plan/usage and existing event receipt must be checked
before buying an upgrade. Compare this with Umami's hosting and maintenance cost.

Sources: [Umami campaigns](https://docs.umami.is/docs/utm),
[Umami campaign measurement](https://docs.umami.is/docs/guides/measure-campaigns),
[Vercel pricing](https://vercel.com/docs/analytics/limits-and-pricing).

## Then: exposure and landing-page evidence

- **Google Search Console:** connect queries, search impressions, clicks and
  position to distinguish visibility from site visits. Verify property ownership
  and the reporting identity; preserve API privacy/aggregation omissions.
- **Instagram/TikTok and ad reporting:** use each platform's authorized insights
  for post views/reach, engagement, outbound clicks and spend. Referral page views
  cannot replace these. Verify Postiz analytics support or use direct APIs.
- **Microsoft Clarity:** optional landing-page heatmaps and session recordings
  to investigate where people hesitate or leave. This is behavior diagnosis,
  not the primary source for long-term campaign accounting. Restrict recording
  to approved public landing pages; exclude dream entry/results, shared dreams,
  account and OAuth routes. Verify masking, consent behavior and eligibility.
  Microsoft says Clarity must not be used on sites/apps targeting under-18s.
  Its export API covers only the previous 1–3 days and allows ten requests/day
  per project, so persistent dashboard trends would require scheduled snapshots.

Sources: [Clarity setup](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup),
[Clarity export API](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api).

## AppsFlyer remains a separate decision

Verify total plan/API cost beyond the introductory period, compatibility with
Abb's actual ChatGPT campaign, iOS consent limits and RevenueCat event identity.
The acceptance test is a campaign link through each store to installation and
first paid subscription, without duplicate revenue. Ad spend and social reach
still come from their platform reporting connections. Agree the experiment
budget and acquisition-cost target from actual net subscription economics.

No newly installed tool can recreate the history it never collected. Keep
collection coverage visible, and do not add cross-platform reach figures into
one supposedly unique audience.
