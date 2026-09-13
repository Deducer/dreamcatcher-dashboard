# DreamCatcher web measurement setup and remaining connections

Reviewed September 13, 2026. Recommendation: select one primary web acquisition
collector, connect platform exposure separately, then evaluate AppsFlyer for the
store-to-paid-subscription link. Umami and Clarity collection are installed; unified-dashboard imports and AppsFlyer remain separate work.

## What is already present

- Vercel Web Analytics is mounted in the marketing site's `0/src/main.tsx` and
  returns real production visitors, page views, referring hosts and daily data.
- `0/src/lib/analytics.ts` already attempts named events for App Download Click
  (store/location), trial-dream actions, partner attribution and scroll depth.
  Instrumentation in source is not proof that the current plan accepts/reports it.
- The website includes scoped Umami and consent-gated Clarity collectors. Their
  reports are linked separately until backend reporting access is configured.
- Vercel campaign-tag queries return HTTP 402. The current response does not
  provide the previous 30-day or 90-day periods. Keep unknowns visible.

## Collection installed September 13, 2026

Ian supplied the existing self-hosted Umami site and Clarity project. The marketing
site now installs Umami at `analytics.dissonance.cloud`, website
`3a631133-dde5-406e-8bfb-8fa32b7a7afc`, on public marketing routes. Safe payloads
retain campaign tags, store-link events, trial status and scroll milestones;
OAuth callbacks, shared dreams, account identity and dream content are excluded.

Clarity project `yht2eghkun` is optional after an explicit adult (18+) analytics
choice. Advertising storage is denied, the trial container is masked, and recording
stops on dream-form interaction. The footer supports withdrawal. The privacy
policy states the marketing website's adult audience separately from app ratings.

**Next: reporting access.** The dashboard still reads Vercel; collector IDs do not
grant read access. Obtain a dedicated reporting credential, confirm site scope,
retention/backups and API compatibility, then import daily totals, referrers,
campaigns and event breakdowns with the collection start date. Do not persist an
admin browser session as a backend credential. The dashboard links native reports
until this connection is completed.

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
