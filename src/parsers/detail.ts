import type { CheerioCrawlingContext } from 'crawlee';

import type { TenderDetail } from '../types.js';

type CheerioAPI = CheerioCrawlingContext['$'];

// KNOWN LIMITATION (verified live 2026-09-04, not yet fixed): the postback
// response does contain new content under this id prefix - confirmed via a
// real fetch - but what's captured today is a short label ("Proceso de
// publicacion PBAC"), not the substantive clause/document text. The
// response embeds nested UpdatePanels (UC_ActosAdministrativos_Clausulas,
// UC_ActosAdministrativos per Sys.WebForms.PageRequestManager._initialize),
// so the real content likely lives in a different, deeper container than
// this selector reaches. The postback MECHANISM is proven (plain HTTP,
// no browser); only the exact text-bearing selector inside it remains
// unmapped. Follow-up: diff the full raw response HTML against this
// selector's match to locate the actual clause text before enabling
// fetchFullDetail as a real feature. Until then it returns whatever short
// label this selector finds - never fabricate placeholder content instead.
export function parseDetail($: CheerioAPI): TenderDetail | null {
    const container = $('[id^="ctl00_CPH1_UCVistaPreviaPliego"]').first();
    if (container.length === 0) return null;

    const textoCompleto = container.text().replace(/\s+/g, ' ').trim();
    if (!textoCompleto) return null;

    return { textoCompleto };
}
