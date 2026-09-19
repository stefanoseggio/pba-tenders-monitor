import type { DateRangePreset } from './dateFilter.js';
import { isWithinDateRange, parseFechaApertura } from './dateFilter.js';
import { fingerprintOf } from './fingerprint.js';
import type { DeltaState, SeenEntry } from './state.js';
import type { EventType, TenderRecord, TenderRow, ViewName } from './types.js';

export interface Classified {
    row: TenderRow;
    eventType: EventType;
    previousVistaOrigen: ViewName | null;
    previousEstado: string | null;
    isNew: boolean;
    hash: string;
}

function classify(previous: SeenEntry | undefined, row: TenderRow, hash: string): Omit<Classified, 'row' | 'hash' | 'isNew'> & { isNew: boolean } {
    if (!previous) return { eventType: 'NEW_LISTING', previousVistaOrigen: null, previousEstado: null, isNew: true };
    if (previous.vistaOrigen !== row.vistaOrigen || previous.estado !== row.estado) {
        return {
            eventType: 'STATUS_CHANGE',
            previousVistaOrigen: previous.vistaOrigen !== row.vistaOrigen ? (previous.vistaOrigen as ViewName) : null,
            previousEstado: previous.estado !== row.estado ? previous.estado : null,
            isNew: false,
        };
    }
    if (previous.hash !== hash) return { eventType: 'UPDATED', previousVistaOrigen: null, previousEstado: null, isNew: false };
    return { eventType: 'UNCHANGED', previousVistaOrigen: null, previousEstado: null, isNew: false };
}

/** Classifies every fetched row against the persisted state - pure, no side effects, so it's
 *  directly unit-testable. Does not filter anything; callers (src/routes.ts) apply
 *  onlyNew/eventTypes/dateRange afterward. */
export function classifyRows(rows: readonly TenderRow[], state: DeltaState): Classified[] {
    return rows.map((row) => {
        const hash = fingerprintOf(row);
        const c = classify(state.entries[row.numeroProceso], row, hash);
        return { row, hash, ...c };
    });
}

export function passesOnlyNew(eventType: EventType, onlyNew: boolean): boolean {
    return !onlyNew || eventType !== 'UNCHANGED';
}

export function passesEventTypes(eventType: EventType, eventTypes: readonly EventType[] | undefined): boolean {
    return !eventTypes || eventType === 'UNCHANGED' || eventTypes.includes(eventType);
}

export function passesDateRange(row: TenderRow, dateRange: DateRangePreset | undefined, now: Date): boolean {
    if (!dateRange) return true;
    return isWithinDateRange(parseFechaApertura(row.fechaApertura), dateRange, now);
}

/**
 * A previously-seen numeroProceso absent from every row fetched THIS run has left all 3 PBAC
 * grids. Only trustworthy when `isCompleteQuery` is true (see callers in src/main.ts): a
 * narrower `views` filter or a maxItems truncation makes the fetch a SUBSET of the site, which
 * would produce false positives - the exact bug class already found and fixed on
 * entrerios-compras-monitor (a filtered query) and salta-compras-monitor (a truncated walk).
 */
export interface FetchSanityCheck {
    /** Distinct numeroProceso ids parsed across every requested grid this run. */
    fetchedCount: number;
    /** Object.keys(state.entries).length BEFORE this run touches it. */
    previousTrackedCount: number;
    /** True only if every requested view's grid table element rendered in the HOME response -
     *  see parsers/grid.ts's isGridRendered(). False if the site returned something other than
     *  the real PBAC homepage (bot-check interstitial, redirect, markup change, etc). */
    requestedGridsRendered: boolean;
}

/**
 * Guards findClosed() against a run whose HTTP fetch "succeeded" (200, no thrown error, so
 * main.ts's failedCount stays 0) but did not actually deliver real grid content. findClosed()
 * treats any previously-tracked id absent from `fetchedIds` as CLOSED - it has no way to tell
 * "the site genuinely has nothing there today" apart from "the fetch returned a bot-check page,
 * a redirect, an empty shell from a site change, or otherwise garbage". Left unguarded, the
 * latter reads as "every tracked tender just disappeared" and both floods the dataset with false
 * CLOSED events and wipes those records from persisted state in the same run.
 *
 * Two independent signals, either one is enough to suspect this - callers should skip CLOSED
 * detection entirely (not just filter it) when this returns true, and leave the existing state
 * untouched so a future good run can still detect a real closure:
 *  1. Structural: one of the requested grids didn't even render. findClosed()'s absence-based
 *     logic would otherwise misread every id that used to live in that grid as closed, even if
 *     the other grids came back with plausible-looking data.
 *  2. Numeric: the fetch found nothing at all (0 ids, across every requested grid) despite
 *     previously tracking real entries. PBAC's `ultimos_30_dias` grid is a rolling 30-day
 *     window, so a real, simultaneous drop to zero across all 3 grids in one run - with no
 *     structural problem to explain it - is vanishingly unlikely; a genuinely quiet grid still
 *     leaves the table rendered (see signal 1), just with fewer rows, not literally none.
 *  Deliberately NOT a fuzzy "dramatically fewer than before" threshold: PBA's rolling window and
 *  award-day clustering mean a large real drop is plausible on its own, and this guard exists to
 *  catch fetch failure, not to second-guess a real, structurally-valid result.
 */
export function isSuspectedFetchFailure({ fetchedCount, previousTrackedCount, requestedGridsRendered }: FetchSanityCheck): boolean {
    if (!requestedGridsRendered) return true;
    return fetchedCount === 0 && previousTrackedCount > 0;
}

export function findClosed(state: DeltaState, fetchedIds: ReadonlySet<string>, scrapedAt: string, sourceUrl: string): TenderRecord[] {
    const closed: TenderRecord[] = [];
    for (const [recordId, entry] of Object.entries(state.entries)) {
        if (fetchedIds.has(recordId)) continue;
        closed.push({
            numeroProceso: recordId,
            descripcion: entry.descripcion,
            tipoProcedimiento: entry.tipoProcedimiento,
            fechaApertura: entry.fechaApertura,
            estado: entry.estado,
            organismo: entry.organismo,
            vistaOrigen: entry.vistaOrigen as ViewName,
            detalleCompleto: null,
            scrapedAt,
            record_id: recordId,
            event_type: 'CLOSED',
            previousVistaOrigen: null,
            previousEstado: null,
            is_new: false,
            source_url: sourceUrl,
            contentHash: entry.hash,
        });
    }
    return closed;
}
