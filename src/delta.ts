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
export function findClosed(state: DeltaState, fetchedIds: ReadonlySet<string>, scrapedAt: string, sourceUrl: string): TenderRecord[] {
    const closed: TenderRecord[] = [];
    for (const [recordId, entry] of Object.entries(state.entries)) {
        if (fetchedIds.has(recordId)) continue;
        closed.push({
            numeroProceso: recordId,
            descripcion: entry.descripcion,
            tipoProcedimiento: '',
            fechaApertura: '',
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
