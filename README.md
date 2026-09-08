# PBA Tenders Scraper & Monitor

**The tender-alert feed the Province of Buenos Aires never shipped.** Extracts every public tender listing from PBAC, the official procurement portal of Buenos Aires Province, Argentina - upcoming openings, tenders from the last 30 days, and awarded processes - as clean structured data. No Argentina national procurement actor covers this at the provincial level; Buenos Aires Province is the country's largest, most populous jurisdiction. Keeps it fresh with a delta mode that reports what is genuinely **new, moved between stages, amended, or no longer listed**.

[![PBA Tenders Scraper & Monitor](https://apify.com/actor-badge?actor=stefano_seggio/pba-tenders-monitor)](https://apify.com/stefano_seggio/pba-tenders-monitor)

- **Real lifecycle tracking, free.** A tender moving from "upcoming openings" to "awarded" - or its own `estado` column changing (e.g. "Publicado" -> "En Evaluacion") - is detected at zero extra cost, since both are already in the row this actor reads.
- **Amendment detection, also free.** A changed description, procedure type, opening date or organism is fingerprinted from the same already-parsed row.
- **Knows when a tender disappears from the site entirely** - reported `CLOSED`, gated on the query covering all 3 grids so it never guesses off a partial view.

## Who uses PBA procurement data

| Team | Question they ask | Fields that answer it | Decision |
| --- | --- | --- | --- |
| Suppliers to Buenos Aires Province organisms (health, general services) | Did a tracked tender move to evaluation or get awarded? | `estado`, `vistaOrigen`, `event_type=STATUS_CHANGE`/`CLOSED` | Prepare or withdraw an offer at the right moment |
| Compliance and legal teams | New public-sector bidding opportunities in Buenos Aires Province | `event_type=NEW_LISTING`, `organismo` | Route to the right business-development owner |
| Bid consultants and gestores managing several clients | What changed across my clients' tracked tenders since yesterday? | `event_type`, `previousVistaOrigen`, `previousEstado` | Notify the client with the specific change |
| Market research / regional data resellers | Public spending patterns by agency, procedure type or time period | `tipoProcedimiento`, `organismo`, `vistaOrigen` | Spending-pattern analysis; buy vs. build a scraper for a genuinely hard-to-reach portal |

## Delta mode

Set `onlyNew: true` for recurring/scheduled monitoring and each run returns only tenders that are `NEW_LISTING`, `STATUS_CHANGE` (vistaOrigen or estado changed), `UPDATED` (a fingerprinted amendment) or `CLOSED` (no longer listed anywhere on the site). `eventTypes` narrows which you want. Every record also always carries `is_new` (computed even on a plain non-delta run).

**`CLOSED` only fires when `views` covers all 3 default grids.** Requesting fewer than all three makes this run's fetch a genuine subset of the site - a previously-tracked tender absent from that partial fetch might simply be in a view you didn't request, not actually gone. CLOSED is skipped (and logged) otherwise. It's also worth knowing that `ultimos_30_dias` ("last 30 days") is a genuinely rolling window - a tender ages out of THAT grid alone as a normal, harmless side effect of time passing, without anything having happened to it; CLOSED only means "no longer in any of the 3 grids", not "removed from this one view".

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")
run = client.actor("stefano_seggio/pba-tenders-monitor").call(run_input={"onlyNew": True, "maxItems": 200})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(f"[{item['event_type']}] {item['numeroProceso']} - {item['organismo']}")
```

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });
const run = await client.actor('stefano_seggio/pba-tenders-monitor').call({ onlyNew: true, maxItems: 200 });
const { items } = await client.dataset(run.defaultDatasetId).listItems();
```

Wire new results straight into Slack, Zapier, Make, or your own endpoint with Apify's native [dataset webhooks](https://docs.apify.com/platform/integrations/webhooks) - no custom webhook code lives inside the actor itself.

## What you get

| Field | Description |
| --- | --- |
| `record_id` | Same value as `numeroProceso` |
| `event_type` | `NEW_LISTING` / `STATUS_CHANGE` / `UPDATED` / `UNCHANGED` / `CLOSED` |
| `previousVistaOrigen` / `previousEstado` | Set only for `STATUS_CHANGE`: whichever one actually changed |
| `contentHash` | sha1 fingerprint used to detect `UPDATED` |
| `is_new` | `true` if not seen in a prior run (computed even when `onlyNew` is off) |
| `source_url` | The PBAC homepage - this portal has no per-tender deep link (see Known limitations) |
| `numeroProceso` | PBAC process number, e.g. `2026-338-99-265` |
| `descripcion` | Short description of the tender |
| `tipoProcedimiento` | Licitacion Publica, Licitacion Privada, or Procedimiento Abreviado |
| `fechaApertura` | Opening date and time as shown by PBAC |
| `estado` | Publicado, En Apertura, En Evaluacion, Disponible Para Adjudicar, etc. |
| `organismo` | Contracting unit/agency |
| `vistaOrigen` | Which PBAC grid this row came from: `apertura_proxima`, `ultimos_30_dias` or `adjudicados` |
| `detalleCompleto` | Full document preview text, only populated when `fetchFullDetail` is enabled (see Known limitations) |
| `scrapedAt` | ISO timestamp of extraction |

## Input

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `views` | array | all three | Which grids to extract: `apertura_proxima`, `ultimos_30_dias`, `adjudicados` |
| `fetchFullDetail` | boolean | `false` | Simulates the per-process postback. **Known limitation:** currently returns a short label, not the full Pliego document text - see Known limitations. Leave off for now |
| `maxItems` | integer | `200` | Hard cap on processes returned this run, across all selected views |
| `onlyNew` | boolean | `false` | Delta mode - see Delta mode above |
| `eventTypes` | array | all four | Which of `NEW_LISTING`/`STATUS_CHANGE`/`UPDATED`/`CLOSED` to deliver when `onlyNew` is on |
| `dateRange` | string | (none) | `"24h"` \| `"7d"` \| `"30d"` - filter by `fechaApertura`. Won't match `apertura_proxima` rows (a future-dated field) - see Known limitations |
| `proxyConfiguration` | object | Residential+AR | Required - the source blocks non-residential-Argentina traffic |

```json
{ "views": ["apertura_proxima", "ultimos_30_dias"], "maxItems": 100 }
```

## How it works

PBAC server-renders all three grids directly in the homepage HTML - no login, no JavaScript, no browser needed to read them. Each row's "Numero de proceso" link is an ASP.NET postback (`__doPostBack`), not a plain URL; `fetchFullDetail` simulates that postback with plain HTTP (extract `__VIEWSTATE`/`__VIEWSTATEGENERATOR` from the loaded page, POST them back with the target control id) rather than requiring a browser. This was verified against the live site, not assumed.

PBAC blocks non-residential-Argentina traffic - confirmed live: both no proxy and standard datacenter proxy time out on every request from Apify's cloud infrastructure, while Residential proxy with country set to Argentina succeeds every time. The actor defaults to that automatically; leave the proxy field alone unless you know what you're changing.

## How much does it cost to monitor PBA tenders?

Pay per event, platform usage included:

| Event | Price | When |
| --- | --- | --- |
| `result` | **$0.003** per record | `NEW_LISTING`, `STATUS_CHANGE` or `UPDATED` |
| `result-summary` | **$0.001** per record | `CLOSED` - a derived absence signal, nothing fetched |
| Actor start | $0.00005 | Once per run |

A daily monitor finding 5 changes across all 3 grids costs about $0.02/day (~$0.45/month).

## Known limitations

- **`fetchFullDetail` is thin today.** The postback mechanism works - it returns 200 with genuinely new content - but the text captured is a short status label ("Proceso de publicacion PBAC"), not the substantive clause/document text. The response embeds nested ASP.NET UpdatePanels, so the real content likely sits in a deeper container not yet mapped. Disclosed here rather than shipped silently; the summary grids (the actor's core value) are unaffected, and `fetchFullDetail` does not change pricing - it would be dishonest to charge more for a fetch that isn't yet meaningfully richer.
- Column labels (`tipoProcedimiento`, `estado`) are extracted as free text exactly as PBAC renders them - values may vary slightly across process types.
- Requires a Residential + Argentina proxy - handled automatically by default.
- `CLOSED` only fires when `views` covers all 3 default grids - see Delta mode above.
- Whether PBAC's own grids are internally capped (e.g. "show only the most recent N rows") has not been independently re-verified against a full live capture - if the site does cap a grid, CLOSED could in principle still misfire even with all 3 views requested. See `AGENTS.md`.
- `dateRange` filters on `fechaApertura` (scheduled opening date), which is routinely a future date for `apertura_proxima` rows - it will not match those, the same gotcha already disclosed on mendoza-compras-monitor and salta-compras-monitor for their own opening-date fields.

## Resources

- [PBAC portal](https://pbac.cgp.gba.gov.ar/)
- [Crawlee documentation](https://crawlee.dev)
- [Apify SDK for JavaScript](https://docs.apify.com/sdk/js)

Full technical detail is in `AGENTS.md`.
