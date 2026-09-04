import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { buildDetailPayload, extractPostbackFields } from '../../src/parsers/postback.js';

describe('extractPostbackFields', () => {
    it('reads __VIEWSTATE and __VIEWSTATEGENERATOR by id', () => {
        const $ = cheerio.load(
            '<input type="hidden" id="__VIEWSTATE" name="__VIEWSTATE" value="abc123" />' +
                '<input type="hidden" id="__VIEWSTATEGENERATOR" name="__VIEWSTATEGENERATOR" value="CA0B0334" />',
        );
        expect(extractPostbackFields($)).toEqual({ viewState: 'abc123', viewStateGenerator: 'CA0B0334' });
    });

    it('returns empty strings instead of throwing when the fields are missing', () => {
        const $ = cheerio.load('<div>no form here</div>');
        expect(extractPostbackFields($)).toEqual({ viewState: '', viewStateGenerator: '' });
    });
});

describe('buildDetailPayload', () => {
    it('builds a form body with the control id as __EVENTTARGET and no __EVENTVALIDATION', () => {
        const body = buildDetailPayload(
            { viewState: 'abc123', viewStateGenerator: 'CA0B0334' },
            'ctl00$CPH1$CtrlTablasPortal$gridPliegoAperturaProxima$ctl02$lnkNumeroProceso',
        );

        expect(body.get('__EVENTTARGET')).toBe('ctl00$CPH1$CtrlTablasPortal$gridPliegoAperturaProxima$ctl02$lnkNumeroProceso');
        expect(body.get('__EVENTARGUMENT')).toBe('');
        expect(body.get('__VIEWSTATE')).toBe('abc123');
        expect(body.get('__VIEWSTATEGENERATOR')).toBe('CA0B0334');
        expect(body.has('__EVENTVALIDATION')).toBe(false);
    });
});
