# PBA Tenders Monitor

Extracts public tender listings from PBAC, the official procurement portal of Buenos Aires Province, Argentina - upcoming openings, tenders from the last 30 days, and awarded processes - as clean structured data. No Argentina national procurement actor covers this at the provincial level today; Buenos Aires Province is the country's largest, most populous jurisdiction.

Actor: `stefano_seggio/pba-tenders-monitor` - $1.50 per 1,000 extracted results.

## Built for

- **Compliance and legal teams** tracking new public-sector bidding opportunities in Buenos Aires Province.
- **Businesses selling to government** who want a structured feed instead of checking the portal by hand.
- **Market research** on public spending patterns by agency, procedure type, or time period.

## Input

| Field | Type | Default | Description |
|---|---|---|---|
| `views` | array | all three | Which grids to extract: `apertura_proxima` (upcoming openings), `ultimos_30_dias` (last 30 days), `adjudicados` (awarded). |
| `fetchFullDetail` | boolean | `false` | Simulates the per-process postback. **Known limitation:** currently returns a short label, not the full Pliego document text - see "Known limitations" below. Leave off for now. |
| `maxItems` | integer | `200` | Hard cap on processes returned this run. |

```json
{
    "views": ["apertura_proxima", "ultimos_30_dias"],
    "maxItems": 100
}
```

## Output

One item per tender process:

```json
{
  "numeroProceso": "2026-338-99-265",
  "descripcion": "MANTENIMIENTO DE MESA DE ANESTESIA",
  "tipoProcedimiento": "Procedimiento Abreviado",
  "fechaApertura": "04/09/2026 08:00 Hrs.",
  "estado": "Publicado",
  "organismo": "103.14.11.1 - Dir. Pcial. Hospitales - Hospital L. C. De Gandulfo - L De Zamora",
  "vistaOrigen": "apertura_proxima",
  "detalleCompleto": null,
  "scrapedAt": "2026-09-04T12:10:15.000Z"
}
```

## How it works

PBAC server-renders all three grids directly in the homepage HTML - no login, no JavaScript, no browser needed to read them. Each row's "Numero de proceso" link is an ASP.NET postback (`__doPostBack`), not a plain URL; `fetchFullDetail` simulates that postback with plain HTTP (extract `__VIEWSTATE`/`__VIEWSTATEGENERATOR` from the loaded page, POST them back with the target control id) rather than requiring a browser. This was verified against the live site, not assumed.

PBAC blocks non-residential-Argentina traffic - confirmed live: both no proxy and standard datacenter proxy time out on every request from Apify's cloud infrastructure, while Residential proxy with country set to Argentina succeeds every time. The Actor defaults to that automatically; leave the proxy field alone unless you know what you're changing.

## Known limitations

- **`fetchFullDetail` is thin today.** The postback mechanism works - it returns 200 with genuinely new content - but the text captured is a short status label ("Proceso de publicacion PBAC"), not the substantive clause/document text. The response embeds nested ASP.NET UpdatePanels, so the real content likely sits in a deeper container not yet mapped. This is disclosed here rather than shipped silently; the summary grids (the actor's core value) are unaffected.
- Column labels (`tipoProcedimiento`, `estado`) are extracted as free text exactly as PBAC renders them - values may vary slightly across process types.

## Resources

- [PBAC portal](https://pbac.cgp.gba.gov.ar/)
- [Crawlee documentation](https://crawlee.dev)
- [Apify SDK for JavaScript](https://docs.apify.com/sdk/js)
