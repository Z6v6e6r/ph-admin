# CUP support history with full sync disabled

The CUP SDK requests `GET /api/messenger/dialogs/:id/messages`. For a support
dialog the compatibility controller delegates to `SupportService.listMessages`.
With `SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS=0`, a persisted dialog or its message
history may never have entered that service's cache. Cold reply context also
deliberately does not hydrate the complete history.

The history read now loads the selected dialog by exact ID, checks staff,
station and connector authority, and reads a bounded message page from the
configured support stores. It checks ownership/ACL agreement between copies
and rechecks authority after awaited reads. Canonical and legacy timestamps
are returned as ISO dates. The existing array response, limit (maximum 500),
exclusive `before` cursor, and `includeService` option are preserved.

The read is response-local: it does not hydrate clients or install partial
pages as complete cached histories. Existing already-cached related history
remains available; this path does not load additional phone-neighbour dialogs.
Normal message queries use the selected dialog ID, its client ID (or legacy
messages without a client ID), and permitted connector aliases. Identity
conflicts do not get repaired or merged by reading history.

The regular history lookups, service-message reads and read marker share a
five-second deadline. A missing dialog remains 404; unavailable stores,
disagreeing authority or authority changes return a sanitized 503/403 rather
than a successful empty history. In-memory-only installations keep their
existing behavior.

Reading history already marks a dialog as read. The persisted path now uses
an exact-snapshot compare-and-set for only `unreadCount=0` and
`hasUnreadMessages=false`. It includes ownership/ACL fields, unread count,
update/latest-message timestamps and pending message IDs in its predicate.
Concurrent changes leave the marker untouched. On success, a matching warm
cached dialog receives only those same two changes. Pending response IDs,
new-message markers, SLA, resolution, contacts and identities are preserved.
Historical storage placement is supported without moving or deleting records.

Do not enable full hydration/reconciliation to fix this symptom: those paths
can merge existing clients and dialogs. This change adds no schema, index,
provider call, outbox operation, Node-RED import, or identity migration.

## Verification

```sh
npx ts-node test/support-history-readthrough.test.ts
npx ts-node test/support-history-readthrough.mongodb.test.ts mongodb://127.0.0.1:27017
npx ts-node test/support-dialog-phone-history.test.ts
npx ts-node test/support-web-history-custody.test.ts
npx ts-node test/support-cold-reply.test.ts
npm run build
```

The Mongo test requires an explicitly supplied disposable loopback fixture;
it creates and removes only randomly named test databases. CI runs both new
history tests in the existing isolated Mongo job.

The exact legacy recovery patch and its derived-tree/patch-digest pins are
refreshed for the same three support modules. The baseline and preimage hashes,
source-equality check, compiled-closure allowlist and recovery tests remain
unchanged. Local rehearsal verifies the derived modules match the candidate
byte for byte and that both custody and history tests pass on that recovery.

Release requires approval for the exact CUP source and server target. A
live authenticated history GET changes read markers, so it is not a read-only
production diagnostic. After release, verify a selected authorized conversation
with a cold service cache, a previous page and a fresh incoming message. Check
that no history moves between clients and that another station/connector stays
denied. Reverting this code restores cache-only reads; no identity migration
needs to be reversed, and unread markers must not be restored from old backups.
