import { Actor } from 'apify';

// A NAMED key-value store (not the run's own default one, which is isolated
// per run and would not survive between scheduled runs) - this is what
// makes "only new/changed since last run" possible at all across a
// schedule.
const STATE_STORE_NAME = 'pba-tenders-monitor-delta-state';
const MAX_SEEN_IDS = 3000;

/** Last-known vistaOrigen (which of the 3 grids this tender was in), estado text, and content
 *  fingerprint per numeroProceso - all three come from the already-parsed grid row, zero extra
 *  request. vistaOrigen moving (e.g. apertura_proxima -> adjudicados) is this domain's clearest
 *  real lifecycle signal - a tender being awarded - so it is tracked and compared exactly like
 *  estado, not folded silently into the generic content fingerprint. */
export interface SeenEntry {
    vistaOrigen: string;
    estado: string;
    hash: string;
    descripcion: string;
    organismo: string;
}

export interface DeltaState {
    entries: Record<string, SeenEntry>;
    lastRunAt: string;
}

function emptyState(): DeltaState {
    return { entries: {}, lastRunAt: '' };
}

function isValidState(value: unknown): value is DeltaState {
    if (!value || typeof value !== 'object') return false;
    const v = value as Partial<DeltaState>;
    return typeof v.entries === 'object' && v.entries !== null;
}

export async function loadState(): Promise<DeltaState> {
    const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
    const state = await store.getValue<unknown>('state');
    return isValidState(state) ? state : emptyState();
}

/**
 * Pure and exported on its own so the cap/ordering logic is testable without touching Actor's
 * key-value store. Newest ids first (this run's ids), then whatever from the previous state
 * wasn't re-seen this run, capped so the store doesn't grow unbounded across months of
 * scheduled runs.
 */
export function mergeEntries(
    previousEntries: Record<string, SeenEntry>,
    observedThisRun: readonly { id: string; entry: SeenEntry }[],
    cap = MAX_SEEN_IDS,
): Record<string, SeenEntry> {
    const observedIds = new Set(observedThisRun.map((o) => o.id));
    const order = [...observedThisRun.map((o) => o.id), ...Object.keys(previousEntries).filter((id) => !observedIds.has(id))];
    const cappedIds = order.slice(0, cap);

    const merged: Record<string, SeenEntry> = { ...previousEntries };
    for (const { id, entry } of observedThisRun) merged[id] = entry;

    const result: Record<string, SeenEntry> = {};
    for (const id of cappedIds) {
        const entry = merged[id];
        if (entry) result[id] = entry;
    }
    return result;
}

export async function saveState(entries: Record<string, SeenEntry>, runAt: string): Promise<void> {
    const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
    await store.setValue('state', { entries, lastRunAt: runAt });
}
