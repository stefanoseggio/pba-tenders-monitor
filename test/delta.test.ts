import { describe, expect, it } from 'vitest';

import { classifyRows, findClosed, isSuspectedFetchFailure, passesDateRange, passesEventTypes, passesOnlyNew } from '../src/delta.js';
import { fingerprintOf } from '../src/fingerprint.js';
import type { DeltaState, SeenEntry } from '../src/state.js';
import type { TenderRow } from '../src/types.js';

const EMPTY_STATE: DeltaState = { entries: {}, lastRunAt: '' };
const SOURCE_URL = 'https://pbac.cgp.gba.gov.ar/';

function row(overrides: Partial<TenderRow> = {}): TenderRow {
    return {
        numeroProceso: '2026-338-99-265',
        descripcion: 'MANTENIMIENTO DE MESA DE ANESTESIA',
        tipoProcedimiento: 'Procedimiento Abreviado',
        fechaApertura: '04/09/2026 08:00 Hrs.',
        estado: 'Publicado',
        organismo: 'Hospital L. C. De Gandulfo',
        vistaOrigen: 'apertura_proxima',
        controlId: 'ctl00$...$lnkNumeroProceso',
        ...overrides,
    };
}

function stateWith(entries: Record<string, SeenEntry>): DeltaState {
    return { entries, lastRunAt: '' };
}

describe('classifyRows', () => {
    it('classifies an unseen row as NEW_LISTING', () => {
        const [c] = classifyRows([row()], EMPTY_STATE);
        expect(c.eventType).toBe('NEW_LISTING');
        expect(c.isNew).toBe(true);
        expect(c.previousVistaOrigen).toBeNull();
        expect(c.previousEstado).toBeNull();
    });

    it('classifies a known id with a different vistaOrigen as STATUS_CHANGE, with previousVistaOrigen set', () => {
        const target = row();
        const state = stateWith({ [target.numeroProceso]: { vistaOrigen: 'apertura_proxima', estado: target.estado, hash: fingerprintOf(target), descripcion: 'd', organismo: 'o' } });
        const [c] = classifyRows([{ ...target, vistaOrigen: 'adjudicados' }], state);

        expect(c.eventType).toBe('STATUS_CHANGE');
        expect(c.previousVistaOrigen).toBe('apertura_proxima');
        expect(c.isNew).toBe(false);
    });

    it('classifies a known id with a different estado (same vistaOrigen) as STATUS_CHANGE, with previousEstado set', () => {
        const target = row();
        const state = stateWith({ [target.numeroProceso]: { vistaOrigen: target.vistaOrigen, estado: 'stale-estado', hash: fingerprintOf(target), descripcion: 'd', organismo: 'o' } });
        const [c] = classifyRows([target], state);

        expect(c.eventType).toBe('STATUS_CHANGE');
        expect(c.previousEstado).toBe('stale-estado');
    });

    it('classifies a known id, same vistaOrigen/estado, different content fingerprint as UPDATED', () => {
        const target = row();
        const state = stateWith({ [target.numeroProceso]: { vistaOrigen: target.vistaOrigen, estado: target.estado, hash: 'a-hash-that-will-never-match', descripcion: 'd', organismo: 'o' } });
        const [c] = classifyRows([target], state);

        expect(c.eventType).toBe('UPDATED');
        expect(c.previousVistaOrigen).toBeNull();
        expect(c.previousEstado).toBeNull();
    });

    it('classifies a known id, nothing changed, as UNCHANGED', () => {
        const target = row();
        const state = stateWith({ [target.numeroProceso]: { vistaOrigen: target.vistaOrigen, estado: target.estado, hash: fingerprintOf(target), descripcion: 'd', organismo: 'o' } });
        const [c] = classifyRows([target], state);

        expect(c.eventType).toBe('UNCHANGED');
        expect(c.isNew).toBe(false);
    });
});

describe('passesOnlyNew / passesEventTypes / passesDateRange', () => {
    it('passesOnlyNew excludes UNCHANGED only when onlyNew is true', () => {
        expect(passesOnlyNew('UNCHANGED', true)).toBe(false);
        expect(passesOnlyNew('UNCHANGED', false)).toBe(true);
        expect(passesOnlyNew('NEW_LISTING', true)).toBe(true);
    });

    it('passesEventTypes restricts to the requested subset but always keeps UNCHANGED (onlyNew decides that one)', () => {
        expect(passesEventTypes('STATUS_CHANGE', ['STATUS_CHANGE'])).toBe(true);
        expect(passesEventTypes('NEW_LISTING', ['STATUS_CHANGE'])).toBe(false);
        expect(passesEventTypes('UNCHANGED', ['STATUS_CHANGE'])).toBe(true);
        expect(passesEventTypes('NEW_LISTING', undefined)).toBe(true);
    });

    it('passesDateRange excludes a future-dated apertura_proxima row under a backward-looking window (disclosed gotcha)', () => {
        const futureRow = row({ fechaApertura: '04/09/2026 08:00 Hrs.' });
        const now = new Date('2026-01-01T00:00:00Z'); // months before the row's date
        expect(passesDateRange(futureRow, '30d', now)).toBe(false);
    });

    it('passesDateRange includes a row within the window', () => {
        const r = row({ fechaApertura: '04/09/2026 08:00 Hrs.' });
        const now = new Date('2026-09-04T20:00:00Z'); // same day, after the ART-adjusted instant
        expect(passesDateRange(r, '24h', now)).toBe(true);
    });

    it('passesDateRange is a no-op when dateRange is not set', () => {
        expect(passesDateRange(row(), undefined, new Date())).toBe(true);
    });
});

describe('findClosed', () => {
    it('reports a previously-seen id absent from this run\'s fetched ids as CLOSED, carrying its last-known vistaOrigen/estado', () => {
        const state = stateWith({
            stillHere: { vistaOrigen: 'apertura_proxima', estado: 'Publicado', hash: 'h1', descripcion: 'd1', organismo: 'o1' },
            goneNow: { vistaOrigen: 'ultimos_30_dias', estado: 'Publicado', hash: 'h2', descripcion: 'd2', organismo: 'o2' },
        });
        const closed = findClosed(state, new Set(['stillHere']), '2026-09-08T00:00:00.000Z', SOURCE_URL);

        expect(closed).toHaveLength(1);
        expect(closed[0].record_id).toBe('goneNow');
        expect(closed[0].event_type).toBe('CLOSED');
        expect(closed[0].vistaOrigen).toBe('ultimos_30_dias');
        expect(closed[0].descripcion).toBe('d2');
    });

    it('reports nothing closed when every previously-seen id is still present', () => {
        const state = stateWith({ a: { vistaOrigen: 'apertura_proxima', estado: 'Publicado', hash: 'h', descripcion: 'd', organismo: 'o' } });
        expect(findClosed(state, new Set(['a']), '2026-09-08T00:00:00.000Z', SOURCE_URL)).toHaveLength(0);
    });
});

describe('isSuspectedFetchFailure', () => {
    // The exact bug this guards: a HOME request that returns 200 but a bot-check page, a
    // redirect, or an empty/mis-rendered shell parses to 0 rows just like a real "nothing open
    // today" would - and without this guard, main.ts would feed that straight into findClosed()
    // and read every one of the previously-tracked records as CLOSED in the same run.
    it('flags a fetch that found nothing at all while real entries were already tracked', () => {
        expect(isSuspectedFetchFailure({ fetchedCount: 0, previousTrackedCount: 137, requestedGridsRendered: true })).toBe(true);
    });

    it('flags a fetch even with a nonzero fetchedCount if one of the requested grids never rendered (structural failure)', () => {
        expect(isSuspectedFetchFailure({ fetchedCount: 12, previousTrackedCount: 137, requestedGridsRendered: false })).toBe(true);
    });

    it('flags a structurally broken page even on a brand-new actor with no prior state', () => {
        expect(isSuspectedFetchFailure({ fetchedCount: 0, previousTrackedCount: 0, requestedGridsRendered: false })).toBe(true);
    });

    it('does not flag a real empty result on a brand-new actor (nothing tracked yet to protect)', () => {
        expect(isSuspectedFetchFailure({ fetchedCount: 0, previousTrackedCount: 0, requestedGridsRendered: true })).toBe(false);
    });

    it('does not flag a normal run that found real, if fewer, rows with the grids intact', () => {
        expect(isSuspectedFetchFailure({ fetchedCount: 40, previousTrackedCount: 137, requestedGridsRendered: true })).toBe(false);
    });

    it('does not flag a fully healthy run', () => {
        expect(isSuspectedFetchFailure({ fetchedCount: 150, previousTrackedCount: 137, requestedGridsRendered: true })).toBe(false);
    });
});
