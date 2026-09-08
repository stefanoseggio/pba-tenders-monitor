import type { DateRangePreset } from './dateFilter.js';

export type ViewName = 'apertura_proxima' | 'ultimos_30_dias' | 'adjudicados';

/**
 * NEW_LISTING: numeroProceso never seen before. STATUS_CHANGE: seen before, `vistaOrigen`
 * (which of the 3 PBAC grids it's in) or `estado` differs from last time - free to detect,
 * both already in the parsed row. A vistaOrigen move (e.g. apertura_proxima -> adjudicados) is
 * this domain's clearest real signal - a tender being awarded. UPDATED: seen before, same
 * vistaOrigen/estado, but the content fingerprint differs (a changed descripcion, opening
 * date, or organismo). UNCHANGED: seen before, nothing differs - only produced on a full
 * (onlyNew=false) run. CLOSED: a previously-seen numeroProceso absent from every one of the 3
 * grids this run - only trustworthy when the query covers ALL THREE default views AND the
 * combined row count wasn't truncated by maxItems (see src/routes.ts and AGENTS.md "Delta
 * engine v2" - a narrower `views` filter or a maxItems cut makes the fetch a SUBSET of the
 * site, the exact false-positive risk already found and fixed on entrerios-compras-monitor).
 * Note `ultimos_30_dias` is a genuinely rolling time window - a tender can age out of THAT
 * grid alone without anything having actually happened to it; CLOSED here means "no longer
 * listed in ANY of the 3 grids", not "removed from one specific view".
 */
export type EventType = 'NEW_LISTING' | 'STATUS_CHANGE' | 'UPDATED' | 'UNCHANGED' | 'CLOSED';

export interface ActorInput {
    views: ViewName[];
    fetchFullDetail: boolean;
    maxItems: number;
    proxyConfiguration?: Record<string, unknown>;
    /** Delta mode: return only tenders that are new, status-changed, amended or closed since a
     *  prior run. See README/AGENTS.md - CLOSED additionally requires an unfiltered, untruncated run. */
    onlyNew?: boolean;
    /** Which event types to deliver when onlyNew=true. Ignored (everything delivered) when onlyNew=false. */
    eventTypes?: Exclude<EventType, 'UNCHANGED'>[];
    /** Filters to tenders whose fechaApertura falls within this window ending now. Independent
     *  of onlyNew. Will not match apertura_proxima rows in practice - see src/dateFilter.ts. */
    dateRange?: DateRangePreset;
}

export interface TenderRow {
    numeroProceso: string;
    descripcion: string;
    tipoProcedimiento: string;
    fechaApertura: string;
    estado: string;
    organismo: string;
    vistaOrigen: ViewName;
    controlId: string;
}

export interface TenderDetail {
    textoCompleto: string;
}

// The standardized B2B integration envelope shared across this portfolio's fleet, layered on
// top of the raw domain fields above - see src/delta.ts.
export interface TenderRecord {
    numeroProceso: string;
    descripcion: string;
    tipoProcedimiento: string;
    fechaApertura: string;
    estado: string;
    organismo: string;
    vistaOrigen: ViewName;
    detalleCompleto: TenderDetail | null;
    scrapedAt: string;
    record_id: string;
    event_type: EventType;
    /** Set only for event_type=STATUS_CHANGE: the vistaOrigen this record_id was last seen under. */
    previousVistaOrigen: ViewName | null;
    /** Set only for event_type=STATUS_CHANGE: the estado this record_id was last seen under. */
    previousEstado: string | null;
    is_new: boolean;
    source_url: string;
    /** sha1 content fingerprint as of this run - see src/fingerprint.ts. */
    contentHash: string;
}

export interface PostbackFields {
    viewState: string;
    viewStateGenerator: string;
}
