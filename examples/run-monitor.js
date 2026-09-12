// run-monitor.js
// Calls the PBAC Buenos Aires Province Tenders Monitor actor (yWvRQyWSyGVLJPtQ7)
// and logs the resulting new/changed/closed tender records.
const { ApifyClient } = require('apify-client');

const client = new ApifyClient({
    token: process.env.APIFY_TOKEN, // set this in your shell before running
});

async function main() {
    const input = {
        views: ['apertura_proxima', 'ultimos_30_dias', 'adjudicados'],
        onlyNew: true,
        eventTypes: ['NEW_LISTING', 'STATUS_CHANGE', 'CLOSED'],
        maxItems: 200,
        proxyConfiguration: {
            useApifyProxy: true,
            apifyProxyGroups: ['RESIDENTIAL'],
            apifyProxyCountry: 'AR',
        },
    };

    // Runs the actor and waits for it to finish before returning
    const run = await client.actor('yWvRQyWSyGVLJPtQ7').call(input);

    // Pull the records the run pushed to its default dataset
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    console.log(`Run finished with status: ${run.status}`);
    console.log(`Retrieved ${items.length} tender record(s)`);

    for (const item of items) {
        console.log(`[${item.event_type}] ${item.numeroProceso} - ${item.descripcion} (${item.estado})`);
    }
}

main().catch((err) => {
    console.error('Run failed:', err.message);
    process.exit(1);
});
