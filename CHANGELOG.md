# Changelog

## 2.0.0 - 2026-09-08

The first delta engine this actor has ever had, built directly to this fleet's v2 standard (unlike every sibling actor, which went through a v1 retrofit first) - status-change, amendment and closure detection. See AGENTS.md "Delta engine v2" for the full technical reasoning.

### Added

- **Standardized B2B envelope**: every record now carries `record_id`, `event_type`, `previousVistaOrigen`, `previousEstado`, `is_new`, `source_url`, `contentHash` - previously absent entirely.
- **`STATUS_CHANGE` events**: a tender whose `vistaOrigen` (which of the 3 PBAC grids it's in) or `estado` changed since it was last seen - e.g. moving from "upcoming" to "awarded" - free to detect, both already in the parsed row.
- **`UPDATED` events**: a tender whose content changed (descripcion, tipo, fecha, organismo) while keeping the same vistaOrigen/estado, via a sha1 content fingerprint (`contentHash`).
- **`CLOSED` events**: a tender no longer listed in any of the 3 grids. Only computed when `views` covers all 3 default grids (see "Not added" below) - a narrower selection makes the fetch a subset of the site.
- **`onlyNew`/`eventTypes`/`dateRange` inputs**, matching the fleet-wide delta-mode convention.
- `src/state.ts`, `src/fingerprint.ts`, `src/delta.ts` (new). Apache-2.0 `LICENSE`, this `CHANGELOG.md`, an `npx eslint .` step in CI.

### Changed

- Pricing: two-tier PPE (`result` $0.003 for full-content events, `result-summary` $0.001 for CLOSED), replacing the v1 flat single-tier price.

### Fixed

- `isWithinDateRange` could have let every future-dated `apertura_proxima` row match every `dateRange` preset (a negative diff is always <= a positive window) - caught by this pass's own test suite before shipping, fixed with the same `diffMs >= 0` guard mendoza-compras-monitor's dateFilter.ts already needed for its own future-dated field.
- `test/main.test.ts` never called `Actor.init()` - harmless under the old `Actor.charge()` call, but the new `pushData(item, eventName)` pattern (which avoids a real double-charge risk - see salta-compras-monitor's AGENTS.md) requires it. Fixed with `Actor.init()`/`Actor.exit({exit:false})`.
- Production `start` script was tidied for local-dev consistency - the Dockerfile's own `CMD` never depended on it (this actor's Dockerfile is a genuine multi-stage build, same shape as cordoba-compras-monitor's, so `dist/` correctly stays gitignored here).

### Not added

- No live re-verification of whether PBAC's 3 summary grids are internally capped by the site (e.g., "show only the most recent N rows") - disclosed as unverified in AGENTS.md, not assumed either way, given the residential proxy's real per-request cost.
