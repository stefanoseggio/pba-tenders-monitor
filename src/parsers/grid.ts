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
