import { Actor } from 'apify';
import { CheerioCrawler, purgeDefaultStorages } from 'crawlee';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureDelta, router } from '../src/routes.js';

// Live integration test against the real PBAC portal - the same tradeoff
// the actor makes in production. Unlike example.com (used in similar
// tests elsewhere), this is a live government portal with no uptime
// guarantee; a failure here may mean PBAC is down or changed markup, not
// necessarily that this code is broken. The offline parser unit tests
// are the ones that must never depend on network availability.
//
// Skipped in CI (verified live, 2026-09-04): GitHub Actions' runner IP
// range timed out reaching this specific .gov.ar host at 30s, on the
// very first push, while every offline test passed. Whether that's
// rate-limiting, a geo/network block, or just latency, the actor's own
// production runs go through Apify's infrastructure, not GitHub's - a
// red CI check here would be permanent noise unrelated to code
// correctness. Still runs on every local/manual `npm test`.
describe.skipIf(process.env.CI)('CheerioCrawler router against the live PBAC portal', () => {
    beforeAll(async () => {
        await purgeDefaultStorages();
        // pushData(item, eventName) - used by src/routes.ts to charge the correct PPE event
        // without a separate, double-charge-risking Actor.charge() call (see
        // salta-compras-monitor's AGENTS.md for the real bug that pattern avoids) - requires
        // the ChargingManager, which only exists after Actor.init(). main.ts always calls this
        // before crawler.run() in production; this test must too, unlike the pre-delta-engine
        // version of this test, which called the router directly without an Actor lifecycle.
        await Actor.init();
    });

    afterAll(async () => {
        // { exit: false }: Actor.exit() calls process.exit() by default, which would kill the
        // vitest worker process itself - fine in the real actor runtime, not in a test.
        await Actor.exit({ exit: false });
    });

    it('parses at least one real tender row from the live homepage', async () => {
        configureDelta({ state: { entries: {}, lastRunAt: '' }, onlyNew: false, now: new Date() });

        const crawler = new CheerioCrawler({
            maxRequestRetries: 2,
            requestHandler: router,
        });

        await crawler.run([
            {
                url: 'https://pbac.cgp.gba.gov.ar/',
                userData: {
                    label: 'HOME',
                    views: ['apertura_proxima', 'ultimos_30_dias', 'adjudicados'],
                    fetchFullDetail: false,
                    maxItems: 5,
                },
            },
        ]);

        const { items } = await crawler.getData();
        expect(items.length).toBeGreaterThan(0);

        const first = items[0];
        expect(typeof first.numeroProceso).toBe('string');
        expect((first.numeroProceso as string).length).toBeGreaterThan(0);
        expect(['apertura_proxima', 'ultimos_30_dias', 'adjudicados']).toContain(first.vistaOrigen);
        expect(first.detalleCompleto).toBeNull();
        expect(typeof first.scrapedAt).toBe('string');
    }, 30_000);
});
