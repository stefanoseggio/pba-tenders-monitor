# run_monitor.py
# Calls the PBAC Buenos Aires Province Tenders Monitor actor (yWvRQyWSyGVLJPtQ7)
# and prints the resulting new/changed/closed tender records.
import os

from apify_client import ApifyClient

client = ApifyClient(os.environ["APIFY_TOKEN"])  # set this in your shell before running

run_input = {
    "views": ["apertura_proxima", "ultimos_30_dias", "adjudicados"],
    "onlyNew": True,
    "eventTypes": ["NEW_LISTING", "STATUS_CHANGE", "CLOSED"],
    "maxItems": 200,
    "proxyConfiguration": {
        "useApifyProxy": True,
        "apifyProxyGroups": ["RESIDENTIAL"],
        "apifyProxyCountry": "AR",
    },
}

# Runs the actor and waits for it to finish before returning
run = client.actor("yWvRQyWSyGVLJPtQ7").call(run_input=run_input)

print(f"Run finished with status: {run['status']}")

# Pull the records the run pushed to its default dataset
dataset_items = client.dataset(run["defaultDatasetId"]).list_items().items
print(f"Retrieved {len(dataset_items)} tender record(s)")

for item in dataset_items:
    event = item["event_type"]
    numero = item["numeroProceso"]
    descripcion = item["descripcion"]
    estado = item["estado"]
    print(f"[{event}] {numero} - {descripcion} ({estado})")
