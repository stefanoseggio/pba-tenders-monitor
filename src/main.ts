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

    // Verified live on Apify's cloud infrastructure (2026-09-04): without a
    // proxy, every request to pbac.cgp.gba.gov.ar timed out at 30s across
    // 4 retries - 0/1 succeeded. Identical requests from outside Apify's
    // cloud IP ranges succeeded in 1-2s every time during development.
    // That gap points at the site blocking Apify's datacenter IPs
    // specifically, so a proxy is not optional here the way it was for
    // primer-actor.
    const proxyConfiguration = await Actor.createProxyConfiguration(proxyConfigurationInput);

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
