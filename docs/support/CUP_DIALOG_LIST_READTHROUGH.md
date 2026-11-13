# CUP conversation list with support sync disabled

`GET /api/messenger/dialogs` previously merged persisted legacy messenger
conversations with only the support service's current memory. With support
full sync disabled, a restart could therefore leave old conversations out of
the list even though their dialogs and message history remained in MongoDB.
The phone lookup likewise discovered stored IDs but discarded IDs absent from
the service cache.

The compatibility controller now awaits a bounded support list read-through.
Each configured support store selects a ranked prefix after station/connector
scope and visibility filtering. Exact selected IDs are checked across all
stores for ownership and ACL agreement. Client titles use an exact client-ID
lookup and one complete latest summary projection; phones and identities are
never combined or reassigned. A second exact context read catches authority
changes during awaited lookups. Backend failures and conflicting authority
produce a sanitized 503 rather than a successful empty list. Physical copies
must also agree on their normalized list projection, including rank, preview,
unread, pending and resolution fields. A divergent copy returns 503 and needs
separate reconciliation; choosing the latest copy could invalidate the ranked
prefix. Different update timestamps alone do not create a conflict.

Summaries are response-local copies. LIST does not hydrate shared caches, load
message history, reconcile identities, mark anything read, modify outbox, or
reset pending response, unread, waiting, resolution or SLA state. Newer cached
unpersisted conversations remain eligible for the merged ranked prefix. The
cached contribution is limited to the same requested prefix before exact
database context reads, including during phone searches.
Existing synchronous cache APIs remain available; the CUP compatibility route
uses the asynchronous method. The public response remains an array, with the
existing limit/offset merge and rank tie-breaking. Resolved PROMO and
unrankable system-only conversations retain their existing visibility rules.
Legacy connector and preview/author aliases are supported.
BOT and SERVICE author aliases follow SYSTEM visibility. A nonempty pending
message array clears resolved status in the response before PROMO visibility
filtering, matching the existing normalization without modifying stored markers.

The operation has a five-second deadline. Each store returns at most the
requested `offset + limit` prefix. Prefixes above 5000 return a sanitized 503;
they are never silently truncated. Exact phone searches bound client matches
to 300 and use the same ranked prefix. No new schema, index, dependency,
startup sync, queue operation, or external provider call is introduced.

## Verification

```sh
npx ts-node test/support-dialog-list-readthrough.test.ts
npx ts-node test/support-dialog-list-readthrough.mongodb.test.ts mongodb://127.0.0.1:27017
npx ts-node test/messenger-dialog-resolution.test.ts
npx ts-node test/support-dialog-phone-history.test.ts
npx ts-node test/support-history-readthrough.test.ts
npx ts-node test/support-web-history-custody.test.ts
npm run build
```

The Mongo test requires an explicit disposable loopback fixture and owns only
randomly named test databases. It verifies cold prefixes/offsets, phone lookup
with a client in another store, aliases, ACL filtering before limits, hidden
conflicting authority/list projections, BOT/SERVICE rank exclusion, pending
PROMO visibility, missing backends and unchanged stored records/caches.
CI runs both new tests in the existing isolated Mongo job.

Production release and MAX queue custody remain separate operations. The list
read-through does not require enabling full hydration. Reverting this change
restores the prior cache-only list behavior; no data migration needs reversal.
