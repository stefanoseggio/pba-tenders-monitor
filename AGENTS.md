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
