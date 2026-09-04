import { Actor, log } from 'apify';
import { CheerioCrawler } from 'crawlee';

import { router } from './routes.js';
import type { ActorInput } from './types.js';

const PBAC_URL = 'https://pbac.cgp.gba.gov.ar/';

await Actor.init();
await run();
await Actor.exit();

async function run(): Promise<void> {
    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);
    const {
        views = ['apertura_proxima', 'ultimos_30_dias', 'adjudicados'],
        fetchFullDetail = false,
        maxItems = 200,
        proxyConfiguration: proxyConfigurationInput,
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

    if (failedCount > 0) {
        log.warning(`Terminado con ${failedCount} request(s) fallidos permanentemente. Ver registros con campo "error" en el dataset.`);
    }
}
