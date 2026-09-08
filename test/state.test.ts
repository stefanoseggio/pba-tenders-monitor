import { describe, expect, it } from 'vitest';

import { mergeEntries } from '../src/state.js';
import type { SeenEntry } from '../src/state.js';

function entry(vistaOrigen: string, estado = 'Publicado', hash = 'h'): SeenEntry {
    return { vistaOrigen, estado, hash, descripcion: 'd', organismo: 'o' };
}

describe('mergeEntries', () => {
    it('puts this run ids first, then unseen previous ids', () => {
        const merged = mergeEntries(
            { old1: entry('apertura_proxima'), old2: entry('apertura_proxima') },
            [
                { id: 'new1', entry: entry('apertura_proxima') },
                { id: 'new2', entry: entry('apertura_proxima') },
            ],
        );
        expect(Object.keys(merged)).toEqual(['new1', 'new2', 'old1', 'old2']);
    });

    it('overwrites an existing id with its new entry (a real vistaOrigen/estado change) when re-seen this run', () => {
        const merged = mergeEntries({ a: entry('apertura_proxima') }, [{ id: 'a', entry: entry('adjudicados') }]);
        expect(merged.a).toEqual(entry('adjudicados'));
    });

    it('caps the result at the given size so the store does not grow unbounded', () => {
        const previous: Record<string, SeenEntry> = {};
        for (let i = 0; i < 10; i++) previous[`old${i}`] = entry('apertura_proxima');
        const merged = mergeEntries(
            previous,
            [
                { id: 'new1', entry: entry('apertura_proxima') },
                { id: 'new2', entry: entry('apertura_proxima') },
            ],
            5,
        );
        expect(Object.keys(merged)).toHaveLength(5);
        expect(Object.keys(merged)).toEqual(['new1', 'new2', 'old0', 'old1', 'old2']);
    });

    it('handles an empty previous state (cold start)', () => {
        const merged = mergeEntries({}, [
            { id: 'a', entry: entry('apertura_proxima') },
            { id: 'b', entry: entry('apertura_proxima') },
        ]);
        expect(Object.keys(merged)).toEqual(['a', 'b']);
    });

    it('handles an empty run (nothing observed) by leaving previous state untouched', () => {
        const previous = { a: entry('apertura_proxima'), b: entry('apertura_proxima') };
        expect(mergeEntries(previous, [])).toEqual(previous);
    });
});
