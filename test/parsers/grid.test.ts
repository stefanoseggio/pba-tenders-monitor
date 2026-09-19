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
});
