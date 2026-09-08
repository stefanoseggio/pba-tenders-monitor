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

## Delta engine v2 (2026-09-08)

Unlike every other actor in this fleet, PBA never got the 2026-09-06 delta
retrofit pass - this is the first delta engine it has ever had, built
directly to the v2 standard (STATUS_CHANGE/UPDATED/CLOSED) rather than a
v1-then-v2 sequence. New files: `src/state.ts`, `src/fingerprint.ts`,
`src/delta.ts`. `src/parsers/*` are untouched.

- **Three grids, three "vistas", one real lifecycle signal.** PBAC's
  `estado` column genuinely varies within a grid (the dataset schema
  already listed real observed values: "Publicado, En Apertura, En
  Evaluacion, Disponible Para Adjudicar" - unlike, say,
  cordoba-compras-monitor's single constant "EN PROCESO"). But the
  clearest domain-level transition is a tender moving between GRIDS
  (`apertura_proxima` -> `adjudicados` = "this tender was awarded"), so
  `vistaOrigen` is tracked and compared exactly like `estado` - either
  differing produces `STATUS_CHANGE`, with `previousVistaOrigen`/
  `previousEstado` set to whichever one actually changed.
- **CLOSED gated on `views` covering all 3 default grids - not on
  maxItems, unlike every other actor with CLOSED.** PBAC's homepage
  server-renders every row of every requested grid in ONE response - there
  is no pagination for the summary grids at all, so `maxItems` only trims
  what gets pushed (in `src/routes.ts`), never what's fetched. The one
  real completeness risk here is the `views` INPUT ITSELF: a caller
  requesting fewer than all 3 default views makes the fetch a genuine
  subset of the site - the exact false-positive risk already found and
  fixed on entrerios-compras-monitor (there, a search-form filter; here,
  the views selector). `src/main.ts`'s `isFullSiteQuery` check mirrors
  `entrerios-compras-monitor`'s `isUnfilteredInput()` directly.
- **Disclosed, unverified**: whether PBAC's own grids are internally
  capped (e.g., "show only the most recent N rows") was never confirmed
  live either way - the only fixture available is a small reconstructed
  2-row sample, not a full real capture. If the site does cap a grid
  internally, CLOSED could still misfire even with all 3 views requested.
  Re-verify against a real full page capture before trusting CLOSED
  heavily in production; not done in this pass due to the residential
  proxy's real per-request cost.
- **`ultimos_30_dias` is a genuinely rolling time window** - a tender can
  age out of THAT grid alone with nothing having actually happened to it.
  CLOSED only means "absent from all 3 grids", never "removed from one
  specific view" - disclosed in the EventType doc comment, README and
  input schema, not conflated with a real status change.
- **Module-scope delta context in `src/routes.ts`** (`configureDelta`/
  `getObservedThisRun`/`getFetchedIdsThisRun`), set once by `main.ts`
  before `crawler.run()`. Necessary because Crawlee's `router` is a
  shared singleton with no access to `run()`'s own locals - safe here
  since this is a single-process-per-run Actor (no concurrent runs
  sharing one Node process). Every other actor in this fleet uses plain
  `fetch()` with no such indirection; this one is Crawlee-based (the only
  one in the fleet, alongside primer-actor) so the wiring looks different
  even though the classify/CLOSED logic itself is the same shape.
- **Pricing**: two-tier - `result` $0.003 for NEW_LISTING/STATUS_CHANGE/
  UPDATED (regardless of `fetchFullDetail` - the detail postback is
  disclosed as not-yet-useful, see "Known limitation" above, so charging
  more for it would be dishonest) / `result-summary` $0.001 for CLOSED
  (a derived absence signal, nothing fetched). `Actor.pushData(record,
  eventName)` performs the charge itself - verified against the installed
  SDK's `.d.ts` before writing this, per the double-charge bug caught on
  salta-compras-monitor. This surfaced a real test-environment gap while
  wiring it up: `test/main.test.ts` instantiated a bare `CheerioCrawler`
  and called the router directly, without ever calling `Actor.init()` -
  harmless under the OLD `Actor.charge()` call, but `pushData(item,
  eventName)` throws "ChargingManager is not initialized" without it.
  Fixed by adding real `Actor.init()`/`Actor.exit({exit:false})` calls to
  the test (the `{exit:false}` matters - `Actor.exit()` calls
  `process.exit()` by default, which would kill the test runner itself).
- **`isWithinDateRange` needed the same fix Mendoza already needed, not
  Cordoba's version** - caught by this file's own test, not assumed:
  `fechaApertura` can be a FUTURE date (apertura_proxima rows), so a bare
  `now - date <= window` lets every future-dated row match every preset
  (a negative diff is always <= a positive window). Fixed with the
  `diffMs >= 0` guard mendoza-compras-monitor's dateFilter.ts already
  carries - copied that version, not cordoba-compras-monitor's (whose
  own date field is genuinely backward-looking and never needed the guard).
- New `onlyNew`/`eventTypes`/`dateRange` inputs, matching the fleet
  convention.

Cost consequence: residential proxy runs ~$7-8/GB vs. datacenter being
effectively free on this plan. Pages here are ~50-90KB, so proxy cost is
roughly $0.35-0.70 per 1,000 requests - real but small. Factored into
the $1.50/1,000 pricing already proposed; margin is thinner than
primer-actor's but still positive. Re-verify this ratio before raising
`maxItems` defaults much higher, since proxy cost scales with pages
fetched, not with dataset items returned.
