# PBA Tenders Monitor - technical notes (this repo)

Second actor in the portfolio, alongside `primer-actor` (CleanMeta Crawler).
Same conventions apply: one Actor = one repo, branch for non-trivial
changes, validate build/lint/test + a real `apify run` before pushing,
never `git push`/`apify push`/promote to `latest` without asking first in
that specific conversation. See primer-actor's AGENTS.md for the fuller
version of these rules - not duplicated here to avoid drift between two
copies of the same policy.

## PBAC technical facts (verified live, 2026-09-04 - re-check if this breaks)

- `https://pbac.cgp.gba.gov.ar/` is ASP.NET WebForms, but a genuinely
  different (much easier) profile than `comprar.gob.ar` (the national
  portal, which uses DevExpress controls and was rejected for that
  reason - see the sibling repo's chat history). PBAC's three summary
  grids (`gridPliegoAperturaProxima`, `gridPliegosUltimos30Dias`,
  `gridPliegosAdjudicados`, all under `ctl00_CPH1_CtrlTablasPortal_`) are
  plain Bootstrap `<table>` elements, server-rendered on the first GET.
  No login, no JS, no postback needed to read them.
- `__EVENTVALIDATION` is absent from this page (disabled server-side) -
  do not add it to the postback payload; it isn't required and doesn't
  exist to extract in the first place.
- The per-process detail link is a standard ASP.NET `LinkButton`
  postback (`__doPostBack('ctl00$CPH1$CtrlTablasPortal$<grid>$ctl0N$lnkNumeroProceso','')`),
  not a plain URL. Simulated with a plain HTTP POST carrying
  `__EVENTTARGET`, `__EVENTARGUMENT` (empty), `__VIEWSTATE`,
  `__VIEWSTATEGENERATOR` - confirmed live to return 200 with genuinely
  new content (verified by diffing response size and control ids present,
  not just status code).
- The site sets an `NSC_qcbd` cookie (looks like a load-balancer
  persistence cookie). `src/routes.ts` forwards it explicitly on the
  detail POST rather than trusting Crawlee's session pool to route to the
  same backend node - this was a deliberate choice, not paranoia: ASP.NET
  ViewState can be tied to server affinity behind a load balancer.

## Known limitation - `fetchFullDetail` is not actually useful yet

The postback mechanism works. What it returns today (`src/parsers/detail.ts`)
is a ~28-character label ("Proceso de publicacion PBAC"), not the
substantive Pliego/clause text. The response embeds nested ASP.NET
UpdatePanels (`UC_ActosAdministrativos_Clausulas`, `UC_ActosAdministrativos`
per the `Sys.WebForms.PageRequestManager._initialize(...)` call visible in
the response), so the real content is very likely in a deeper container
this selector doesn't reach yet. This is disclosed in the README and the
input schema description rather than hidden. Next step, if this gets
picked back up: fetch a real detail postback response, save it to a
fixture file, and grep it by hand for the actual clause/amount/requirement
text to find the right selector - don't guess at container ids without a
raw response in front of you.

## Memory

`minMemoryMbytes`/`maxMemoryMbytes` are 256/512 in `.actor/actor.json`.
Given the primer-actor lesson (these never synced from actor.json to the
live Actor record across a dozen builds), don't assume this took effect
just because it's in the file - check `defaultRunOptions` via
`apify api GET actors/<slug>` after the first build, same as had to be
fixed by hand for primer-actor.

## CI cannot reach PBAC (verified 2026-09-04, GitHub Actions specifically)

The live integration test in `test/main.test.ts` timed out at 30s on
GitHub Actions' runner IP range on the very first push, while all 7
offline unit tests passed. Fixed by skipping it under `CI=true`
(`describe.skipIf(process.env.CI)`) rather than deleting it - it still
runs on every local `npm test` and is genuinely useful there. Don't
re-enable it in CI without first checking whether this was transient
network flakiness or an actual block on GitHub's IP ranges from this
.gov.ar host.

## CRITICAL: PBAC blocks non-residential-Argentina traffic (verified 2026-09-04)

Both no proxy and default Apify Proxy (datacenter) time out at 30s across
4 retries on every request to pbac.cgp.gba.gov.ar from Apify's cloud
infrastructure - 0 successes across two separate cloud runs. Only
Residential proxy with `countryCode: 'AR'` succeeded (3.5s, 3/3 rows).
This is a geo/traffic-type block, not something specific to Apify's own
IP ranges - a datacenter proxy from any other provider would very likely
fail the same way.

Consequence: `src/main.ts` hardcodes `{ groups: ['RESIDENTIAL'],
countryCode: 'AR' }` as the fallback whenever the caller doesn't pass
`proxyConfiguration` explicitly. The input schema's `prefill` on that
field only seeds the Console form - it does nothing for an API/CLI
caller who omits the field, so the code-level default is what actually
matters. Do not "simplify" this back to plain `Actor.createProxyConfiguration()`
with no argument; that reintroduces the exact failure mode this section
documents.

Cost consequence: residential proxy runs ~$7-8/GB vs. datacenter being
effectively free on this plan. Pages here are ~50-90KB, so proxy cost is
roughly $0.35-0.70 per 1,000 requests - real but small. Factored into
the $1.50/1,000 pricing already proposed; margin is thinner than
primer-actor's but still positive. Re-verify this ratio before raising
`maxItems` defaults much higher, since proxy cost scales with pages
fetched, not with dataset items returned.
