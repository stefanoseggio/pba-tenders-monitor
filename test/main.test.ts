import { CheerioCrawler, purgeDefaultStorages } from 'crawlee';
import { beforeAll, describe, expect, it } from 'vitest';

import { router } from '../src/routes.js';

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
    });

    it('parses at least one real tender row from the live homepage', async () => {
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
