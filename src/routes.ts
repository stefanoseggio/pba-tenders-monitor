import { Actor } from 'apify';
import { createCheerioRouter } from 'crawlee';

import { parseDetail } from './parsers/detail.js';
import { parseGrid } from './parsers/grid.js';
import { buildDetailPayload, extractPostbackFields } from './parsers/postback.js';
import type { TenderRecord, TenderRow, ViewName } from './types.js';

export const router = createCheerioRouter();

const RESULT_EVENT_NAME = 'result';

// Charges one "result" event and returns whether the caller's budget was
// reached. Shared by both handlers so a run stops cleanly the moment the
// caller's configured spend limit is hit, whichever handler is charging.
async function chargeResult(crawler: { autoscaledPool?: { abort: () => Promise<void> } }): Promise<boolean> {
    const { eventChargeLimitReached } = await Actor.charge({ eventName: RESULT_EVENT_NAME, count: 1 });
    if (eventChargeLimitReached) {
        await crawler.autoscaledPool?.abort();
    }
    return eventChargeLimitReached;
}

router.addDefaultHandler(async ({ $, request, response, crawler, log, pushData, addRequests }) => {
    const userData = request.userData ?? {};
    const label = typeof userData.label === 'string' ? userData.label : 'HOME';

    if (label === 'DETAIL') {
        const row = userData.row as TenderRow;
        const detalleCompleto = parseDetail($);

        log.info(`Detail fetched for ${row.numeroProceso}`, { found: detalleCompleto !== null });

        const record: TenderRecord = {
            numeroProceso: row.numeroProceso,
            descripcion: row.descripcion,
            tipoProcedimiento: row.tipoProcedimiento,
            fechaApertura: row.fechaApertura,
            estado: row.estado,
            organismo: row.organismo,
            vistaOrigen: row.vistaOrigen,
            detalleCompleto,
            scrapedAt: new Date().toISOString(),
        };

        await pushData(record);
        await chargeResult(crawler);
        return;
    }

    // HOME: the PBAC landing page server-renders all three grids directly,
    // no postback needed to read the summary rows.
    const views = (userData.views as ViewName[] | undefined) ?? ['apertura_proxima', 'ultimos_30_dias', 'adjudicados'];
    const fetchFullDetail = Boolean(userData.fetchFullDetail);
    const maxItems = typeof userData.maxItems === 'number' ? userData.maxItems : 200;

    const allRows: TenderRow[] = [];
    for (const view of views) {
        allRows.push(...parseGrid($, view));
    }
    const rows = allRows.slice(0, maxItems);
    log.info(`Parsed ${allRows.length} rows across ${views.length} view(s), keeping ${rows.length} (maxItems=${maxItems})`);

    if (!fetchFullDetail) {
        for (const row of rows) {
            const record: TenderRecord = {
                numeroProceso: row.numeroProceso,
                descripcion: row.descripcion,
                tipoProcedimiento: row.tipoProcedimiento,
                fechaApertura: row.fechaApertura,
                estado: row.estado,
                organismo: row.organismo,
                vistaOrigen: row.vistaOrigen,
                detalleCompleto: null,
                scrapedAt: new Date().toISOString(),
            };
            await pushData(record);
            const limitReached = await chargeResult(crawler);
            if (limitReached) {
                log.info('Charge limit reached - stopping.');
                return;
            }
        }
        return;
    }

    // fetchFullDetail: queue one POST per row, carrying the session cookie
    // explicitly. PBAC's ViewState is tied to server-affinity (NSC_qcbd,
    // a load-balancer persistence cookie) - relying on generic session-pool
    // cookie handling isn't guaranteed to route the POST to the same
    // backend node that issued the ViewState, so it's forwarded explicitly.
    // Node types 'set-cookie' as string[] | undefined - it's the one header
    // that can repeat, so it's never a plain string.
    const setCookie = response?.headers?.['set-cookie'];
    const cookieHeader = setCookie?.map((c) => c.split(';')[0]).join('; ');

    const postbackFields = extractPostbackFields($);
    const pageUrl = request.loadedUrl ?? request.url;

    await addRequests(
        rows.map((row) => ({
            url: pageUrl,
            method: 'POST' as const,
            payload: buildDetailPayload(postbackFields, row.controlId).toString(),
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                ...(cookieHeader ? { cookie: cookieHeader } : {}),
            },
            userData: { label: 'DETAIL', row },
            uniqueKey: `detail-${row.numeroProceso}`,
        })),
    );
});
