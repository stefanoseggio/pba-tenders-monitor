import { Actor } from 'apify';
import { createCheerioRouter } from 'crawlee';

import type { DateRangePreset } from './dateFilter.js';
import type { Classified } from './delta.js';
import { classifyRows, passesDateRange, passesEventTypes, passesOnlyNew } from './delta.js';
import { parseDetail } from './parsers/detail.js';
import { isGridRendered, parseGrid } from './parsers/grid.js';
import { buildDetailPayload, extractPostbackFields } from './parsers/postback.js';
import type { DeltaState, SeenEntry } from './state.js';
import type { EventType, TenderRecord, TenderRow, ViewName } from './types.js';

export const router = createCheerioRouter();

const EVENT_DETAIL = 'result';
const PBAC_URL = 'https://pbac.cgp.gba.gov.ar/';

export interface DeltaOptions {
    state: DeltaState;
    onlyNew: boolean;
    eventTypes?: Exclude<EventType, 'UNCHANGED'>[];
    dateRange?: DateRangePreset;
    now: Date;
}

// Module-scope, set once by main.ts before crawler.run() - the router is a shared singleton
// with no direct access to run()'s own locals, and this is a single-process-per-run Actor, so
// module state is safe here (never shared across concurrent runs). observedThisRun accumulates
// every row actually pushed (not just classified) so main.ts can persist state after the crawl
// finishes - only what was truly delivered counts as "seen", matching the fleet-wide principle
// that a record held back by maxItems/a charge limit must stay eligible next run.
let deltaOptions: DeltaOptions | null = null;
const observedThisRun: { id: string; entry: SeenEntry }[] = [];
const fetchedIdsThisRun = new Set<string>();
// Which of the 3 grid tables actually rendered on the HOME response this run - distinct from
// fetchedIdsThisRun being non-empty, since a grid can legitimately render with zero data rows.
// See parseGrid's isGridRendered() and main.ts's mass-closure guard.
const renderedGridsThisRun = new Set<ViewName>();

export function configureDelta(options: DeltaOptions): void {
    deltaOptions = options;
    observedThisRun.length = 0;
    fetchedIdsThisRun.clear();
    renderedGridsThisRun.clear();
}

export function getObservedThisRun(): { id: string; entry: SeenEntry }[] {
    return observedThisRun;
}

export function getFetchedIdsThisRun(): ReadonlySet<string> {
    return fetchedIdsThisRun;
}

export function getRenderedGridsThisRun(): ReadonlySet<ViewName> {
    return renderedGridsThisRun;
}

function toEntry(row: TenderRow, hash: string): SeenEntry {
    return {
        vistaOrigen: row.vistaOrigen,
        estado: row.estado,
        hash,
        descripcion: row.descripcion,
        organismo: row.organismo,
        tipoProcedimiento: row.tipoProcedimiento,
        fechaApertura: row.fechaApertura,
    };
}

function buildRecord(row: TenderRow, c: Omit<Classified, 'row'>, scrapedAt: string, detalleCompleto: TenderRecord['detalleCompleto']): TenderRecord {
    return {
        numeroProceso: row.numeroProceso,
        descripcion: row.descripcion,
        tipoProcedimiento: row.tipoProcedimiento,
        fechaApertura: row.fechaApertura,
        estado: row.estado,
        organismo: row.organismo,
        vistaOrigen: row.vistaOrigen,
        detalleCompleto,
        scrapedAt,
        record_id: row.numeroProceso,
        event_type: c.eventType,
        previousVistaOrigen: c.previousVistaOrigen,
        previousEstado: c.previousEstado,
        is_new: c.isNew,
        source_url: PBAC_URL,
        contentHash: c.hash,
    };
}

// Charges one PPE event and returns whether the caller's budget was reached. Shared by both
// handlers so a run stops cleanly the moment the caller's configured spend limit is hit.
// pushData's own eventName argument performs the charge itself - a separate Actor.charge()
// call after it would double-charge, verified against the installed apify SDK's own
// pushData(item, eventName): Promise<ChargeResult> overload before writing this - see
// salta-compras-monitor's AGENTS.md for the real bug this avoids.
async function pushAndCharge(
    record: TenderRecord,
    eventName: string,
    crawler: { autoscaledPool?: { abort: () => Promise<void> } },
): Promise<boolean> {
    const { eventChargeLimitReached } = await Actor.pushData(record, eventName);
    if (eventChargeLimitReached) await crawler.autoscaledPool?.abort();
    return eventChargeLimitReached;
}

router.addDefaultHandler(async ({ $, request, response, crawler, log, addRequests }) => {
    const userData = request.userData ?? {};
    const label = typeof userData.label === 'string' ? userData.label : 'HOME';
    const opts = deltaOptions;
    if (!opts) throw new Error('configureDelta() must be called before crawler.run()');

    if (label === 'DETAIL') {
        const row = userData.row as TenderRow;
        const c = userData.classified as Omit<Classified, 'row'>;
        const detalleCompleto = parseDetail($);

        log.info(`Detail fetched for ${row.numeroProceso}`, { found: detalleCompleto !== null });

        const record = buildRecord(row, c, new Date().toISOString(), detalleCompleto);
        const limitReached = await pushAndCharge(record, EVENT_DETAIL, crawler);
        if (!limitReached) observedThisRun.push({ id: row.numeroProceso, entry: toEntry(row, c.hash) });
        return;
    }

    // HOME: the PBAC landing page server-renders all three grids directly, no postback needed.
    const views = (userData.views as ViewName[] | undefined) ?? ['apertura_proxima', 'ultimos_30_dias', 'adjudicados'];
    const fetchFullDetail = Boolean(userData.fetchFullDetail);
    const maxItems = typeof userData.maxItems === 'number' ? userData.maxItems : 200;

    const allRows: TenderRow[] = [];
    for (const view of views) {
        if (isGridRendered($, view)) renderedGridsThisRun.add(view);
        allRows.push(...parseGrid($, view));
    }
    for (const row of allRows) fetchedIdsThisRun.add(row.numeroProceso);

    const rows = allRows.slice(0, maxItems);
    log.info(`Parsed ${allRows.length} rows across ${views.length} view(s), keeping ${rows.length} (maxItems=${maxItems})`);

    const scrapedAt = new Date().toISOString();
    const classified = classifyRows(rows, opts.state).filter(
        (c) =>
            passesOnlyNew(c.eventType, opts.onlyNew) &&
            passesEventTypes(c.eventType, opts.eventTypes) &&
            passesDateRange(c.row, opts.dateRange, opts.now),
    );
    log.info(`Delta filter kept ${classified.length}/${rows.length} rows (onlyNew=${opts.onlyNew}).`);

    if (!fetchFullDetail) {
        for (const c of classified) {
            const record = buildRecord(c.row, c, scrapedAt, null);
            const limitReached = await pushAndCharge(record, EVENT_DETAIL, crawler);
            if (!limitReached) observedThisRun.push({ id: c.row.numeroProceso, entry: toEntry(c.row, c.hash) });
            if (limitReached) {
                log.info('Charge limit reached - stopping.');
                return;
            }
        }
        return;
    }

    // fetchFullDetail: queue one POST per row, carrying the session cookie explicitly.
    // PBAC's ViewState is tied to server-affinity (NSC_qcbd, a load-balancer persistence
    // cookie) - relying on generic session-pool cookie handling isn't guaranteed to route the
    // POST to the same backend node that issued the ViewState, so it's forwarded explicitly.
    const setCookie = response?.headers?.['set-cookie'];
    const cookieHeader = setCookie?.map((c) => c.split(';')[0]).join('; ');

    const postbackFields = extractPostbackFields($);
    const pageUrl = request.loadedUrl ?? request.url;

    await addRequests(
        classified.map((c) => ({
            url: pageUrl,
            method: 'POST' as const,
            payload: buildDetailPayload(postbackFields, c.row.controlId).toString(),
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                ...(cookieHeader ? { cookie: cookieHeader } : {}),
            },
            userData: { label: 'DETAIL', row: c.row, classified: { eventType: c.eventType, previousVistaOrigen: c.previousVistaOrigen, previousEstado: c.previousEstado, isNew: c.isNew, hash: c.hash } },
            uniqueKey: `detail-${c.row.numeroProceso}`,
        })),
    );
});
