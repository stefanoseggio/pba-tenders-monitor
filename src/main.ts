import { Actor, log } from 'apify';
import { CheerioCrawler } from 'crawlee';

import { findClosed, isSuspectedFetchFailure } from './delta.js';
import { configureDelta, getFetchedIdsThisRun, getObservedThisRun, getRenderedGridsThisRun, router } from './routes.js';
import { loadState, mergeEntries, saveState } from './state.js';
import type { ActorInput, ViewName } from './types.js';

const PBAC_URL = 'https://pbac.cgp.gba.gov.ar/';
const EVENT_SUMMARY = 'result-summary';
const ALL_VIEWS: ViewName[] = ['apertura_proxima', 'ultimos_30_dias', 'adjudicados'];

await Actor.init();
await run();
await Actor.exit();

async function run(): Promise<void> {
    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);
    const {
        views = ALL_VIEWS,
        fetchFullDetail = false,
        maxItems = 200,
        proxyConfiguration: proxyConfigurationInput,
        onlyNew = false,
        eventTypes,
        dateRange,
    } = input;

    // Verified live on Apify's cloud infrastructure (2026-09-04), twice:
    // both no proxy and default (datacenter) Apify Proxy timed out at 30s
    // across 4 retries every time - 0 successes in either case. Only
    // Residential + Argentina succeeded (3.5s, 3/3 rows). This points at
    // the site geo/type-blocking non-residential-Argentina traffic, not
    // merely "Apify's IPs" - datacenter proxies from other providers would
    // very likely fail the same way. The input schema's "prefill" only
    // seeds the Console form; it does nothing for a caller who invokes
    // this Actor via API/CLI without passing proxyConfiguration at all -
    // so the real code default has to be residential+AR too, or every
    // such caller gets the same silent 30s-timeout failure this run did.
    const proxyConfiguration = await Actor.createProxyConfiguration(
        proxyConfigurationInput ?? { groups: ['RESIDENTIAL'], countryCode: 'AR' },
    );

    const now = new Date();
    const scrapedAt = now.toISOString();
    const state = await loadState();
    configureDelta({ state, onlyNew, eventTypes, dateRange, now });

    let failedCount = 0;

    const crawler = new CheerioCrawler({
        proxyConfiguration,
        maxRequestRetries: 4,
        requestHandlerTimeoutSecs: 60,
        retryOnBlocked: true,
        useSessionPool: true,
        persistCookiesPerSession: true,
        requestHandler: router,
        failedRequestHandler: async ({ request }, error) => {
            failedCount += 1;
            log.error(`Descartado tras ${request.retryCount} reintentos: ${request.url}`, {
                errorMessage: error.message,
            });
            await Actor.pushData({
                url: request.url,
                error: error.message,
                failedAtRetry: request.retryCount,
                scrapedAt: new Date().toISOString(),
            });
        },
    });

    await crawler.run([
        {
            url: PBAC_URL,
            userData: { label: 'HOME', views, fetchFullDetail, maxItems },
        },
    ]);

    // CLOSED is only safe to compute when `views` covers the site's default 3 grids - a
    // narrower views filter makes this run's fetch a SUBSET of the site, the exact
    // false-positive risk already found and fixed on entrerios-compras-monitor (there, a
    // filtered query; here, a narrowed views list). Unlike the fleet's paginated actors, PBAC's
    // homepage renders every row of every requested grid in one response - there is no
    // maxItems-driven pagination truncation to additionally gate on (maxItems only trims what
    // gets PUSHED, in routes.ts, never what's fetched) - see AGENTS.md "Delta engine v2".
    const isFullSiteQuery = ALL_VIEWS.every((v) => views.includes(v)) && views.length === ALL_VIEWS.length;
    const closedAllowed = !eventTypes || eventTypes.includes('CLOSED');
    const previousTrackedCount = Object.keys(state.entries).length;
    const fetchedCount = getFetchedIdsThisRun().size;
    const requestedGridsRendered = views.every((v) => getRenderedGridsThisRun().has(v));
    const suspectedFetchFailure = isSuspectedFetchFailure({ fetchedCount, previousTrackedCount, requestedGridsRendered });

    // Sanity guard: a HOME request that "succeeds" (200, no thrown error) but returns a
    // bot-check page, a redirect, or an empty/mis-rendered shell looks identical to a real
    // "nothing in any grid today" from here on down. Unguarded, findClosed() below would read
    // every previously-tracked id as CLOSED and both flood the dataset with false closure
    // events and permanently wipe them from state in this same run. See delta.ts's
    // isSuspectedFetchFailure() for the exact two signals this checks.
    if (suspectedFetchFailure) {
        log.error(
            `Suspected fetch failure, not a real mass closure - skipping CLOSED detection and leaving ${previousTrackedCount} ` +
                `previously-tracked record(s) untouched in state so a future good run can still detect a real closure. ` +
                `Fetched ${fetchedCount} id(s) across ${views.length} requested view(s); grids rendered: ${requestedGridsRendered}.`,
        );
    }

    let closedCount = 0;
    if (suspectedFetchFailure) {
        // Already logged above - deliberately not falling into the isFullSiteQuery branch below.
    } else if (isFullSiteQuery && closedAllowed) {
        const closed = findClosed(state, getFetchedIdsThisRun(), scrapedAt, PBAC_URL);
        const pushedClosedIds: string[] = [];
        for (const record of closed) {
            const { eventChargeLimitReached } = await Actor.pushData(record, EVENT_SUMMARY);
            closedCount += 1;
            pushedClosedIds.push(record.record_id);
            if (eventChargeLimitReached) {
                log.info('Charge limit reached while pushing CLOSED records - stopping.');
                break;
            }
        }
        if (pushedClosedIds.length > 0) {
            const withoutClosed = { ...state.entries };
            for (const id of pushedClosedIds) delete withoutClosed[id];
            state.entries = withoutClosed;
        }
    } else if (Object.keys(state.entries).length > 0) {
        log.info(
            `Skipping CLOSED detection this run: views does not cover all 3 default grids, so this fetch is not a complete census of the site. Run with the default views to enable it.`,
        );
    }

    const nextEntries = mergeEntries(state.entries, getObservedThisRun());
    await saveState(nextEntries, scrapedAt);

    if (failedCount > 0) {
        log.warning(`Terminado con ${failedCount} request(s) fallidos permanentemente. Ver registros con campo "error" en el dataset.`);
    }
    log.info(`Delta state saved: ${getObservedThisRun().length} record(s) observed, ${closedCount} CLOSED.`);
}
