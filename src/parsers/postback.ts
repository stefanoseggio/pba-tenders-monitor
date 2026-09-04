import type { CheerioCrawlingContext } from 'crawlee';

import type { PostbackFields } from '../types.js';

type CheerioAPI = CheerioCrawlingContext['$'];

// Extracts the two hidden fields PBAC actually requires to accept a
// postback. __EVENTVALIDATION is deliberately not included: it is absent
// on this page (verified live on 2026-09-04, EnableEventValidation is off
// for this form), so requiring it here would break every request.
export function extractPostbackFields($: CheerioAPI): PostbackFields {
    return {
        viewState: $('#__VIEWSTATE').attr('value') ?? '',
        viewStateGenerator: $('#__VIEWSTATEGENERATOR').attr('value') ?? '',
    };
}

// Builds the form-encoded body for a postback targeting a specific
// process's detail link. Verified against a live PBAC postback: this
// exact field set (no __EVENTVALIDATION, no other form fields) returns a
// 200 with the process's detail section rendered.
export function buildDetailPayload(fields: PostbackFields, controlId: string): URLSearchParams {
    return new URLSearchParams({
        __EVENTTARGET: controlId,
        __EVENTARGUMENT: '',
        __VIEWSTATE: fields.viewState,
        __VIEWSTATEGENERATOR: fields.viewStateGenerator,
    });
}
