export type DateRangePreset = '24h' | '7d' | '30d';

const WINDOW_MS: Record<DateRangePreset, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
};

// Argentina Time (ART) has been a fixed UTC-3 with no daylight saving since
// 2009, so converting PBAC's local wall-clock timestamp to a true UTC
// instant is a plain fixed offset - same reasoning as
// cordoba-compras-monitor's dateFilter.ts, which this mirrors.
const ARGENTINA_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

// `fechaApertura` renders as "DD/MM/YYYY HH:mm Hrs." (no seconds, a literal
// "Hrs." suffix) - verified against the real reconstructed fixture in
// test/parsers/grid.test.ts ("04/09/2026 08:00 Hrs."). This is the
// scheduled BID-OPENING date, not a publication date - for the
// apertura_proxima grid specifically it is routinely in the FUTURE relative
// to when the tender was first listed (the opening hasn't happened yet),
// the same gotcha already disclosed on salta-compras-monitor and
// mendoza-compras-monitor for their own opening-date fields. dateRange here
// is implemented as the standard backward-looking "in the last N" (matching
// this fleet's convention for a source's own date field), so it will not
// match apertura_proxima rows in practice - disclosed in README, not hidden.
export function parseFechaApertura(value: string | null | undefined): Date | null {
    if (!value) return null;
    const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}) Hrs\.?$/.exec(value.trim());
    if (!match) return null;
    const [, dd, mm, yyyy, hh, min] = match;
    const localAsUtc = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), 0);
    return new Date(localAsUtc + ARGENTINA_UTC_OFFSET_MS);
}

// `fechaApertura` is routinely a FUTURE date for apertura_proxima rows (see the doc comment
// above) - a plain `now - date <= window` would let every future-dated row match every
// preset, since a negative diff is always <= a positive window. Fixed the same way
// mendoza-compras-monitor's dateFilter.ts already had to be fixed for its own future-dated
// opening-date field: require `diffMs >= 0` too, so a date only counts as "within range" if
// it has actually already happened. Caught by this file's own test suite, not assumed correct
// from copying cordoba-compras-monitor's version (whose fechaInicio is genuinely
// backward-looking, so it never needed this guard).
export function isWithinDateRange(date: Date | null, preset: DateRangePreset | undefined, now: Date): boolean {
    if (!preset) return true;
    if (!date) return false;
    const diffMs = now.getTime() - date.getTime();
    return diffMs >= 0 && diffMs <= WINDOW_MS[preset];
}
