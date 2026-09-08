import { createHash } from 'node:crypto';

import type { TenderRow } from './types.js';

/**
 * A stable content fingerprint of a tender's mutable fields, excluding numeroProceso
 * (identity) and vistaOrigen/estado (tracked separately as the primary status signal - see
 * src/state.ts - so a real lifecycle transition is reported as STATUS_CHANGE rather than
 * folded into a generic UPDATED). Free to compute: every field is already in the grid row
 * this actor parses from the one homepage fetch it always makes.
 */
export function fingerprintOf(row: TenderRow): string {
    const stable = {
        descripcion: row.descripcion,
        tipoProcedimiento: row.tipoProcedimiento,
        fechaApertura: row.fechaApertura,
        organismo: row.organismo,
    };
    return createHash('sha1').update(JSON.stringify(stable)).digest('hex');
}
