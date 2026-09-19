import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { isGridRendered, parseGrid } from '../../src/parsers/grid.js';

// Reconstructed from a real fetch of https://pbac.cgp.gba.gov.ar/ on
// 2026-09-04 - same table id, same column order, same postback href shape.
const HOME_HTML = [
    '<table class="table table-hover table-striped table-condensed" id="ctl00_CPH1_CtrlTablasPortal_gridPliegoAperturaProxima">',
    '<tr><th>Numero</th><th>Descripcion</th><th>Tipo</th><th>Apertura</th><th>Estado</th><th>Organismo</th></tr>',
    '<tr><td>',
    '<a id="ctl00_CPH1_CtrlTablasPortal_gridPliegoAperturaProxima_ctl02_lnkNumeroProceso" href="javascript:__doPostBack(\'ctl00$CPH1$CtrlTablasPortal$gridPliegoAperturaProxima$ctl02$lnkNumeroProceso\',\'\')">2026-338-99-265</a>',
    '</td><td>MANTENIMIENTO DE MESA DE ANESTESIA</td><td><p>Procedimiento Abreviado</p></td>',
    '<td>04/09/2026 08:00 Hrs.</td><td><p>Publicado</p></td>',
    '<td><p>103.14.11.1 - Dir. Pcial. Hospitales - Hospital L. C. De Gandulfo - L De Zamora</p></td>',
    '</tr>',
    '<tr><td>',
    '<a id="ctl00_CPH1_CtrlTablasPortal_gridPliegoAperturaProxima_ctl03_lnkNumeroProceso" href="javascript:__doPostBack(\'ctl00$CPH1$CtrlTablasPortal$gridPliegoAperturaProxima$ctl03$lnkNumeroProceso\',\'\')">2026-336-99-265</a>',
    '</td><td>ADQUISICION DE PROTESIS PACIENTE CORONEL SOFIA</td><td><p>Procedimiento Abreviado</p></td>',
    '<td>04/09/2026 08:30 Hrs.</td><td><p>Publicado</p></td>',
    '<td><p>103.14.11.1 - Dir. Pcial. Hospitales - Hospital L. C. De Gandulfo - L De Zamora</p></td>',
    '</tr>',
    '</table>',
].join('\n');

// The real adjudicados grid's header row and empty-state markup, captured verbatim from a live
// fetch of https://pbac.cgp.gba.gov.ar/ on 2026-09-19 - the grid was genuinely empty at fetch
// time ("No se encontraron resultados"; re-confirmed against Wayback Machine snapshots of the
// same page from 2025-12-19 and 2025-12-21, also empty), so only the schema below - 4 columns:
// Número de Proceso, Nombre de Proceso, Tipo de Proceso, Unidad Ejecutora, with NO Fecha de
// Apertura/Estado columns - is a real live capture. No populated adjudicados row could be
// captured live in this pass; ADJUDICADOS_POPULATED_HTML below is NOT a live capture (see its
// own comment).
const ADJUDICADOS_EMPTY_HTML = [
    '<table class="table table-hover table-striped table-condensed" cellspacing="0" border="0" id="ctl00_CPH1_CtrlTablasPortal_gridPliegosAdjudicados" style="border-collapse:collapse;">',
    '<tr class="tr-header"><th scope="col">Número de Proceso</th><th scope="col">Nombre de Proceso</th><th scope="col">Tipo de Proceso</th><th scope="col">Unidad Ejecutora</th></tr>',
    '<tr><td colspan="4"><div style="text-align: center">No se encontraron resultados</div></td></tr>',
    '</table>',
].join('\n');

// NOT a live capture - the real adjudicados grid was empty at every verification point above, so
// this single data row is hand-built to the real, live-confirmed 4-column header/order (comment
// above), using a numeroProceso/tipoProcedimiento/organismo format pattern that mirrors real rows
// actually observed live in the sibling ultimos_30_dias grid on the same 2026-09-19 fetch. Treat
// the SCHEMA (column count, order, header labels) as verified; treat these particular field
// VALUES as illustrative, not a genuine captured record.
const ADJUDICADOS_POPULATED_HTML = [
    '<table class="table table-hover table-striped table-condensed" cellspacing="0" border="0" id="ctl00_CPH1_CtrlTablasPortal_gridPliegosAdjudicados" style="border-collapse:collapse;">',
    '<tr class="tr-header"><th scope="col">Número de Proceso</th><th scope="col">Nombre de Proceso</th><th scope="col">Tipo de Proceso</th><th scope="col">Unidad Ejecutora</th></tr>',
    '<tr><td>',
    '<a id="ctl00_CPH1_CtrlTablasPortal_gridPliegosAdjudicados_ctl02_lnkNumeroProceso" href="javascript:__doPostBack(\'ctl00$CPH1$CtrlTablasPortal$gridPliegosAdjudicados$ctl02$lnkNumeroProceso\',\'\')">161-0594-LPU25</a>',
    '</td><td>ADQUISICION DE MEDICAMENTOS</td><td><p>Licitación Pública</p></td>',
    '<td><p>161-MINISTERIO DE JUSTICIA -DIRECCION PROVINCIAL DE SALUD PENITENCIARIA</p></td>',
    '</tr>',
    '</table>',
].join('\n');

describe('parseGrid', () => {
    it('extracts every data row with its postback control id', () => {
        const $ = cheerio.load(HOME_HTML);
        const rows = parseGrid($, 'apertura_proxima');

        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({
            numeroProceso: '2026-338-99-265',
            descripcion: 'MANTENIMIENTO DE MESA DE ANESTESIA',
            tipoProcedimiento: 'Procedimiento Abreviado',
            fechaApertura: '04/09/2026 08:00 Hrs.',
            estado: 'Publicado',
            organismo: '103.14.11.1 - Dir. Pcial. Hospitales - Hospital L. C. De Gandulfo - L De Zamora',
            vistaOrigen: 'apertura_proxima',
            controlId: 'ctl00$CPH1$CtrlTablasPortal$gridPliegoAperturaProxima$ctl02$lnkNumeroProceso',
        });
    });

    it('skips the header row and returns nothing for a missing grid id', () => {
        const $ = cheerio.load(HOME_HTML);
        expect(parseGrid($, 'adjudicados')).toHaveLength(0);
    });

    // Regression test for the bug where parseGrid() applied the 6-column
    // apertura_proxima/ultimos_30_dias schema (and its `cells.length < 6` guard) to every view,
    // silently discarding every real adjudicados row (a genuine 4-column grid) so an awarded
    // tender read as CLOSED instead of the real STATUS_CHANGE it is.
    it('parses a real adjudicados row under its own 4-column schema (no Fecha de Apertura/Estado columns)', () => {
        const $ = cheerio.load(ADJUDICADOS_POPULATED_HTML);
        const rows = parseGrid($, 'adjudicados');

        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({
            numeroProceso: '161-0594-LPU25',
            descripcion: 'ADQUISICION DE MEDICAMENTOS',
            tipoProcedimiento: 'Licitación Pública',
            fechaApertura: '',
            estado: '',
            organismo: '161-MINISTERIO DE JUSTICIA -DIRECCION PROVINCIAL DE SALUD PENITENCIARIA',
            vistaOrigen: 'adjudicados',
            controlId: 'ctl00$CPH1$CtrlTablasPortal$gridPliegosAdjudicados$ctl02$lnkNumeroProceso',
        });
    });

    it('returns nothing for the real adjudicados empty-state markup ("No se encontraron resultados")', () => {
        const $ = cheerio.load(ADJUDICADOS_EMPTY_HTML);
        expect(parseGrid($, 'adjudicados')).toHaveLength(0);
    });
});

describe('isGridRendered', () => {
    // The distinction main.ts's mass-closure guard depends on: parseGrid() returns 0 rows both
    // when the table exists but is genuinely empty AND when the table itself never rendered
    // (wrong/redirected page, bot-check interstitial, site markup change) - isGridRendered()
    // is what tells those two apart.
    it('is true for a view whose grid table element is present, independent of row count', () => {
        const $ = cheerio.load(HOME_HTML);
        expect(isGridRendered($, 'apertura_proxima')).toBe(true);
    });

    it('is false for a view whose grid table element never rendered on the page', () => {
        const $ = cheerio.load(HOME_HTML);
        expect(isGridRendered($, 'adjudicados')).toBe(false);
    });

    it('is false for every view on a completely different/unrelated page (e.g. a bot-check interstitial)', () => {
        const $ = cheerio.load('<html><body><h1>Please verify you are human</h1></body></html>');
        expect(isGridRendered($, 'apertura_proxima')).toBe(false);
        expect(isGridRendered($, 'ultimos_30_dias')).toBe(false);
        expect(isGridRendered($, 'adjudicados')).toBe(false);
    });

    it('is true for a grid table that rendered with zero data rows (a genuinely quiet grid)', () => {
        const emptyGridHtml =
            '<table id="ctl00_CPH1_CtrlTablasPortal_gridPliegoAperturaProxima">' +
            '<tr><th>Numero</th><th>Descripcion</th><th>Tipo</th><th>Apertura</th><th>Estado</th><th>Organismo</th></tr>' +
            '</table>';
        const $ = cheerio.load(emptyGridHtml);
        expect(isGridRendered($, 'apertura_proxima')).toBe(true);
        expect(parseGrid($, 'apertura_proxima')).toHaveLength(0);
    });

    it('is true for the real adjudicados empty-state markup - the table rendered, it just has no rows today', () => {
        const $ = cheerio.load(ADJUDICADOS_EMPTY_HTML);
        expect(isGridRendered($, 'adjudicados')).toBe(true);
        expect(parseGrid($, 'adjudicados')).toHaveLength(0);
    });
});
