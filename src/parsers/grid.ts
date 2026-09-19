import type { CheerioCrawlingContext } from 'crawlee';

import type { TenderRow, ViewName } from '../types.js';

type CheerioAPI = CheerioCrawlingContext['$'];

// PBAC renders three grids directly in server-side HTML on the homepage -
// no postback needed to read them. Table ids are stable across loads
// (verified against a live fetch on 2026-09-04).
const GRID_IDS: Record<ViewName, string> = {
    apertura_proxima: 'ctl00_CPH1_CtrlTablasPortal_gridPliegoAperturaProxima',
    ultimos_30_dias: 'ctl00_CPH1_CtrlTablasPortal_gridPliegosUltimos30Dias',
    adjudicados: 'ctl00_CPH1_CtrlTablasPortal_gridPliegosAdjudicados',
};

// Extracts the __doPostBack control id from a link like:
// href="javascript:__doPostBack('ctl00$CPH1$...$lnkNumeroProceso','')"
function extractPostbackTarget(href: string | undefined): string | null {
    if (!href) return null;
    const match = href.match(/__doPostBack\('([^']+)'/);
    return match ? match[1] : null;
}

/**
 * Whether `view`'s grid table element itself is present in the parsed HTML - true even when it
 * has zero data rows (PBAC still renders the empty `<table>` with just its header row on a
 * genuinely quiet day). False means the page didn't render this grid at all: a redirect to an
 * unrelated/error page, a bot-check interstitial, or an unannounced markup change. That's a
 * materially different failure mode from "the grid rendered and is genuinely empty today", and
 * `parseGrid` returning 0 rows can't tell the two apart on its own - see src/main.ts's
 * mass-closure guard, which needs exactly that distinction before trusting a 0-row reading.
 */
export function isGridRendered($: CheerioAPI, view: ViewName): boolean {
    return $(`#${GRID_IDS[view]}`).length > 0;
}

export function parseGrid($: CheerioAPI, view: ViewName): TenderRow[] {
    const tableId = GRID_IDS[view];
    const rows: TenderRow[] = [];

    $(`#${tableId} tr`).each((_i, el) => {
        const cells = $(el).find('td');
        if (cells.length < 6) return; // skip header/empty rows

        const link = cells.eq(0).find('a').first();
        const controlId = extractPostbackTarget(link.attr('href'));
        const numeroProceso = link.text().trim();
        if (!controlId || !numeroProceso) return;

        rows.push({
            numeroProceso,
            descripcion: cells.eq(1).text().trim(),
            tipoProcedimiento: cells.eq(2).text().trim(),
            fechaApertura: cells.eq(3).text().trim(),
            estado: cells.eq(4).text().trim(),
            organismo: cells.eq(5).text().trim(),
            vistaOrigen: view,
            controlId,
        });
    });

    return rows;
}
