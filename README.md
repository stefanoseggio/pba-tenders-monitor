# Buenos Aires Province Tenders Monitor - PBAC Public Procurement (Argentina Government Contracts)

Buenos Aires Province — Argentina's most populous province — publishes its public tenders on PBAC (`pbac.cgp.gba.gov.ar`) across three separate grids: upcoming openings, tenders from the last 30 days, and awarded processes. This is the provincial portal for the Province of Buenos Aires specifically — not the city of Buenos Aires (CABA) and not Argentina's national procurement system, which run on entirely separate sites. PBAC gives no per-tender bookmark URL to track a listing by (see Output below), so keeping an eye on it by hand means revisiting all three grids on a schedule and manually comparing each row against what you remember from the last check. This actor automates that comparison: it extracts all three grids on every run and, in delta mode, reports only what genuinely changed since the previous run — a new listing, a move between grids or a status change, an amended field, or a tender that has disappeared from the site entirely — turning a manual, error-prone re-check into a structured feed you can put on a schedule.

[![Buenos Aires Province Tenders Monitor](https://apify.com/actor-badge?actor=stefano_seggio/pba-tenders-monitor)](https://apify.com/stefano_seggio/pba-tenders-monitor)

## Who uses this data

| Team | Question they ask | Fields that answer it | Decision |
| --- | --- | --- | --- |
| Suppliers to Buenos Aires Province organisms (health, general services) | Did a tracked tender move to evaluation or get awarded? | `estado`, `vistaOrigen`, `event_type` = `STATUS_CHANGE` / `CLOSED` | Prepare or withdraw an offer at the right moment |
| Compliance and legal teams | What new public-sector bidding opportunities opened in Buenos Aires Province? | `event_type` = `NEW_LISTING`, `organismo` | Route to the right business-development owner |
| Bid consultants and gestores managing several clients | What changed across my clients' tracked tenders since yesterday? | `event_type`, `previousVistaOrigen`, `previousEstado` | Notify the client with the specific change that happened |

## Input

```json
{ "views": ["apertura_proxima", "ultimos_30_dias"], "maxItems": 100 }
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `views` | array | all three | Which PBAC grids to extract: `apertura_proxima` (upcoming openings), `ultimos_30_dias` (tenders from the last 30 days), `adjudicados` (awarded processes) |
| `fetchFullDetail` | boolean | `false` | Optional enrichment: simulates the per-process ASP.NET postback to fetch more detail. Known limitation — it currently returns a short status label, not the full Pliego document text, so it adds cost with limited extra value today; leave it off (see Known limitations) |
| `maxItems` | integer | `200` | Hard cap on processes returned this run, across all selected views |
| `onlyNew` | boolean | `false` | Delta mode — return only tenders that are new, changed, amended, or closed since a prior run of this actor |
| `eventTypes` | array | all four | Which of `NEW_LISTING` / `STATUS_CHANGE` / `UPDATED` / `CLOSED` to deliver when `onlyNew` is on |
| `dateRange` | string | (none) | `"24h"` \| `"7d"` \| `"30d"` — filters by `fechaApertura` (opening date). Won't match `apertura_proxima` rows, since that field is routinely a future date on that grid — see Known limitations |
| `proxyConfiguration` | object | Residential + Argentina | Required — PBAC blocks non-residential, non-Argentina traffic; leave the prefilled default alone |

## Output

Each dataset item is one tender row plus its delta classification. Illustrative example built from the actor's real schema — exact field values vary per PBAC listing:

```json
{
    "record_id": "2026-338-99-265",
    "event_type": "STATUS_CHANGE",
    "previousVistaOrigen": null,
    "previousEstado": "Publicado",
    "contentHash": "3f2a9c1e7b4d6f0a8c2e5b9d1a4f7c0e3b6d9a2c",
    "is_new": false,
    "source_url": "https://pbac.cgp.gba.gov.ar/",
    "numeroProceso": "2026-338-99-265",
    "descripcion": "Adquisicion de insumos medicos",
    "tipoProcedimiento": "Licitacion Publica",
    "fechaApertura": "2026-09-15 10:00",
    "estado": "En Evaluacion",
    "organismo": "Ministerio de Salud",
    "vistaOrigen": "ultimos_30_dias",
    "detalleCompleto": null,
    "scrapedAt": "2026-09-09T14:32:00.000Z"
}
```

| Field | Description |
| --- | --- |
| `record_id` | Same value as `numeroProceso` |
| `event_type` | `NEW_LISTING` / `STATUS_CHANGE` / `UPDATED` / `UNCHANGED` / `CLOSED` |
| `previousVistaOrigen` / `previousEstado` | Set only for `STATUS_CHANGE`: whichever one actually changed |
| `contentHash` | sha1 fingerprint used to detect `UPDATED` |
| `is_new` | `true` if not seen in a prior run (computed even when `onlyNew` is off) |
| `source_url` | The PBAC homepage — this portal has no per-tender deep link |
| `numeroProceso` | PBAC process number, e.g. `2026-338-99-265` |
| `descripcion` | Short description of the tender |
| `tipoProcedimiento` | Licitacion Publica, Licitacion Privada, or Procedimiento Abreviado |
| `fechaApertura` | Opening date and time as shown by PBAC |
| `estado` | Publicado, En Apertura, En Evaluacion, Disponible Para Adjudicar, etc. |
| `organismo` | Contracting unit/agency |
| `vistaOrigen` | Which PBAC grid this row came from: `apertura_proxima`, `ultimos_30_dias` or `adjudicados` |
| `detalleCompleto` | Full document preview text, only populated when `fetchFullDetail` is enabled (see Known limitations) |
| `scrapedAt` | ISO timestamp of extraction |

## Reliability

PBAC server-renders all three grids directly in the homepage HTML — no login, no JavaScript, and no browser needed to read them. Each run classifies every row against state persisted in a **named** key-value store (`pba-tenders-monitor-delta-state`, capped at 3,000 tracked processes) rather than the run's own isolated default store, which is what makes "only new/changed since last run" work across a schedule at all:

- **`NEW_LISTING`** — a `numeroProceso` not present in the persisted state.
- **`STATUS_CHANGE`** — `vistaOrigen` or `estado` differs from what was last recorded (a tender moving from `apertura_proxima` to `adjudicados`, for example, means it was awarded). `previousVistaOrigen`/`previousEstado` records whichever one actually changed.
- **`UPDATED`** — `vistaOrigen`/`estado` are unchanged but a sha1 fingerprint of `descripcion`, `tipoProcedimiento`, `fechaApertura`, and `organismo` differs from last time.
- **`CLOSED`** — a previously tracked `numeroProceso` absent from every row fetched this run. This is only reported when `views` covers all three default grids; a narrower selection makes the fetch a genuine subset of the site, which could otherwise misreport a tender as closed when it simply sits in a grid you didn't request this run — that case is skipped and logged instead. `maxItems` does not affect this: PBAC's homepage returns every row of every requested grid in one response with no pagination, so `maxItems` only trims what gets pushed to the dataset, never what gets fetched.

The per-process detail postback (`fetchFullDetail`) is a plain HTTP POST that extracts `__VIEWSTATE`/`__VIEWSTATEGENERATOR` from the loaded page and replays them with the target control id, rather than requiring a browser — verified against the live site. PBAC also blocks non-residential, non-Argentina traffic: confirmed live, both no proxy and a standard datacenter proxy time out on every request from Apify's cloud infrastructure, while Residential proxy with country set to Argentina succeeds consistently; the actor defaults to that automatically.

## Pricing

Pay per event, platform usage included:

| Event | Price | When |
| --- | --- | --- |
| `result` | **$0.003** per record | `NEW_LISTING`, `STATUS_CHANGE` or `UPDATED` |
| `result-summary` | **$0.001** per record | `CLOSED` — a derived absence signal, nothing fetched |
| Actor start | $0.00005 | Once per run |

A daily monitor finding 5 changes across all 3 grids costs about $0.02/day (~$0.45/month). `fetchFullDetail` does not add a separate charge — since that enrichment is disclosed as not yet substantively useful (see Known limitations), charging more for it would not be honest.

## Support & Enterprise SLA

This is an independently developed and maintained actor, not a team- or enterprise-run product — there is no dedicated support desk or contractual SLA on offer. Report issues, ask questions, or request features through the Issues tab on this actor's Apify Store page; the developer aims to respond within about 48 hours. If your organization needs a guaranteed response time or a formal support agreement, reach out via the Store page first to discuss what's realistically possible before relying on this actor for time-critical monitoring.

## Known limitations

- **`fetchFullDetail` is thin today.** The postback mechanism works — it returns 200 with genuinely new content — but the text captured is a short status label ("Proceso de publicacion PBAC"), not the substantive clause/document text. The real content likely sits in a nested ASP.NET panel not yet mapped. Disclosed here rather than shipped silently; the three summary grids (the actor's core value) are unaffected.
- Column labels (`tipoProcedimiento`, `estado`) are extracted as free text exactly as PBAC renders them — values may vary slightly across process types.
- `dateRange` filters on `fechaApertura` (scheduled opening date), which is routinely a future date for `apertura_proxima` rows — it will not match those rows.
- Whether PBAC's own grids are internally capped (e.g. showing only the most recent N rows) has not been independently re-verified against a full live capture. If a grid is capped, `CLOSED` could in principle still misfire even with all three views requested.
- Requires a Residential + Argentina proxy — handled automatically by default; do not switch this to a datacenter proxy.

## Resources

- [PBAC portal](https://pbac.cgp.gba.gov.ar/)
- [Crawlee documentation](https://crawlee.dev)
- [Apify SDK for JavaScript](https://docs.apify.com/sdk/js)
