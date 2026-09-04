import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { parseDetail } from '../../src/parsers/detail.js';

describe('parseDetail', () => {
    it('extracts the visible text of the Vista Previa Pliego section', () => {
        const $ = cheerio.load(
            '<div id="ctl00_CPH1_UCVistaPreviaPliego_UC_ActosAdministrativos_Clausulas">' +
                '  <span>Clausula 1: entrega en 30 dias</span>  ' +
                '</div>',
        );
        expect(parseDetail($)).toEqual({ textoCompleto: 'Clausula 1: entrega en 30 dias' });
    });

    it('returns null when the section is absent instead of throwing', () => {
        const $ = cheerio.load('<div>pagina sin detalle</div>');
        expect(parseDetail($)).toBeNull();
    });
});
