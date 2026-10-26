# Message delivery source corrections — 26 October 2026

Paired task branches: `codex/message-delivery-fixes-20261026` in ph-admin and LK. Preparation only; no merge/deploy/import/restart, provider request, queue replay or live data/ACL change.

## Root causes and evidence boundaries

Server-147 still has the legacy `maxbot-send` outbox graph, and `SUPPORT_MAX_OUTBOX_MODE` was unset in the running backend. Permanent provider403/404 failures repeat when no fail receipt is produced; legacy attempt-limit logs finally marked18 commands in three dialogs FAILED during the audited day. Commands may predate that day. The fenced protocol already in main is a separate, not-yet-active source implementation; this change does not enable it.

The provider code `dialog.suspended` is now retained in the safe failure allowlist. It is PROVIDER_REFUSED for403 and cannot be retried by the fenced store.404 chat.not.found has the same terminal behavior. Unknown transport/5xx remains DELIVERY_UNKNOWN;429 retains its bounded backoff. No raw provider description/body/identifier is exported. A code alone never overrides status classification.

`/api/messenger/dialogs` and message POSTs are staff CUP APIs, not player LK message APIs. Existing401 guards remain. The audited15:47 POST404 was near a restart, but its exact target was not identified in this task. Separately, source tests reproduce that a persisted support dialog cannot be replied to after an empty-cache startup: full sync is intentionally disabled, while the synchronous reply previously looked only in memory.

## Bounded cold reply restoration

Messenger compatibility fallback and the support reply controller now use an async wrapper around the unchanged synchronous send path. Normal warm replies remain synchronous inside the wrapper. The cold path:

1. Requires staff before persistence access.
2. Reads exact dialog ID from every configured available backend within one5-second operation budget. Divergent copies fail503. Genuine absence returns404; errors never masquerade as absence.
3. Requires the connector-owned backend's exact client and compares all same-ID profile copies, including auth/phone/email/identity binding. Email order, identity order and lastSeenAt are preserved because they determine the selected recipient. No contact/phone-based identity linking or arbitrary backend fallback is used.
4. Reads only latest inbound and first inbound ID for reply context. No full history/outbox scan, hydration, reconciliation or startup resync.
5. Rechecks current memory after awaiting reads. Never overwrites a dialog/client warmed concurrently; conflicting bindings fail503. Existing station/connector/closed/writable checks run before cache installation and again in synchronous send.
6. Keeps bounded reply context separate from complete message history, preserving quick-reply first-message semantics and SLA state.

MAX/TG/email replies now reject a missing selected recipient with `SUPPORT_REPLY_TARGET_UNAVAILABLE` before appending the staff message or updating SLA. This prevents apparent success with no outbound command. LK web replies do not require an external-bot target.

HTTP payloads/routes are unchanged. Nest awaits the controller Promise. New failures are deliberate503 instead of a false successful reply or transient404. Existing persistence remains fire-and-forget for ordinary messages; this patch does not claim durable enqueue or external delivery. No schema/index migration is added.

Conservative duplicate-copy checks can return503 until inconsistent stored copies are reconciled through a separately authorized process. Revocation/authorization still follows existing scopes; no denial is converted into success.

## Validation and release boundary

`test/support-cold-reply.test.ts` covers exact bounded reads, auth/station/connector/closed/read-only denial, true absence, backend outage/conflict, missing recipient, concurrent cache warming, routing binding conflicts, correct first-message/SLA behavior and exactly one message/outbox creation. `test/max-outbox-provider-refusal.test.ts` covers safe code classification. Physical Mongo regression in `test/max-outbox-receipts.test.ts` includes both observed permanent refusals and proves they cannot be claimed again.

Run the new tests plus existing auth/RBAC, LK identity, support contact isolation/client resolution/station mapping/dialog resolution/outbox/diagnostics, messenger dialog-resolution and backend build/typecheck. CI executes the new tests with existing physical Mongo receipts. Local Docker daemon was unavailable; do not label a collection-spy test as physical Mongo acceptance.

Paired LK changes remove automatic non-idempotent message replay and preserve ambiguous-result wording/drafts. The live VivaCRM chat-auth availability issue is not bypassed. Before future activation, use `docs/support/MAX_OUTBOX_RECEIPTS.md` and LK adapter README; fresh runtime/graph/artifact/canonical recipient checks and rollback/recovery plan remain mandatory. No failed/unknown messages may be replayed as a validation step. Reverting source before activation affects no live state; after activation, stop consumers and retain uncertain-delivery evidence rather than resuming legacy retries.
