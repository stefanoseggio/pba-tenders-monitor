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

/**
 * Per-view column layout. `apertura_proxima` and `ultimos_30_dias` share PBAC's normal 6-column
 * shape (Número de Proceso, Nombre de Proceso, Tipo de Proceso, Fecha de Apertura, Estado,
 * Unidad Ejecutora). `adjudicados` genuinely renders only 4 - re-verified against a live fetch
 * of https://pbac.cgp.gba.gov.ar/ on 2026-09-19, whose `gridPliegosAdjudicados` header row reads
 * exactly: "Número de Proceso", "Nombre de Proceso", "Tipo de Proceso", "Unidad Ejecutora" - no
 * Fecha de Apertura/Estado columns at all. Before this per-view schema existed, parseGrid()
 * applied the 6-column shape (and its `cells.length < 6` guard) to every view, which silently
 * discarded every real adjudicados row (an awarded tender then read as CLOSED - vanished from
 * every grid - instead of the real STATUS_CHANGE it is).
 *
 * `fechaApertura`/`estado` are `null` for a view whose grid has no such column; parseGrid() then
 * fills that TenderRow field with '' rather than guessing.
 */
interface GridColumnSchema {
    /** Minimum real <td> count for a row to be real data, not PBAC's own header row or its
     *  single-`<td colspan>` "No se encontraron resultados" placeholder row. */
    minCells: number;
    descripcion: number;
    tipoProcedimiento: number;
    fechaApertura: number | null;
    estado: number | null;
    organismo: number;
}

const GRID_SCHEMAS: Record<ViewName, GridColumnSchema> = {
    apertura_proxima: { minCells: 6, descripcion: 1, tipoProcedimiento: 2, fechaApertura: 3, estado: 4, organismo: 5 },
    ultimos_30_dias: { minCells: 6, descripcion: 1, tipoProcedimiento: 2, fechaApertura: 3, estado: 4, organismo: 5 },
    adjudicados: { minCells: 4, descripcion: 1, tipoProcedimiento: 2, fechaApertura: null, estado: null, organismo: 3 },
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
    const schema = GRID_SCHEMAS[view];
    const rows: TenderRow[] = [];

    $(`#${tableId} tr`).each((_i, el) => {
        const cells = $(el).find('td');
        if (cells.length < schema.minCells) return; // skip header/empty/"no results" rows

        const link = cells.eq(0).find('a').first();
        const controlId = extractPostbackTarget(link.attr('href'));
        const numeroProceso = link.text().trim();
        if (!controlId || !numeroProceso) return;

        rows.push({
            numeroProceso,
            descripcion: cells.eq(schema.descripcion).text().trim(),
            tipoProcedimiento: cells.eq(schema.tipoProcedimiento).text().trim(),
            fechaApertura: schema.fechaApertura !== null ? cells.eq(schema.fechaApertura).text().trim() : '',
            estado: schema.estado !== null ? cells.eq(schema.estado).text().trim() : '',
            organismo: cells.eq(schema.organismo).text().trim(),
            vistaOrigen: view,
            controlId,
        });
    });

    return rows;
}
