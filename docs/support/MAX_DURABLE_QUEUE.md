# Durable, prospective MAX outbox

This source change is opt-in (`SUPPORT_MAX_OUTBOX_MODE=receipt-v1`); it does not
change a running environment, import a snapshot, migrate an old queue or send a
message. Default legacy behavior remains available before the first v1 write.
The paired consumer lives in the LK repository's `node-red/max-outbox-adapter`
package, version 1.1.0, with `max-outbox-send` and `max-outbox-receipt`.

## Acceptance and restart behavior

A MAX reply succeeds only after insert-only majority+j enqueue and a primary
majority readback of the same immutable command. A timeout, missing authority or
mismatched payload is an error, never a process-local success fallback. Shutdown
waits for tracked enqueue writes before closing Mongo clients. Outbound delivery
uses Mongo directly with sync=0 and an empty process Map.

Every newly accepted v1 command receives `meta.maxOutboxProtocol=max-lease-v1`.
All dispatch claims, expiry/exhaustion sweeps, receipt reads/CAS/idempotency and
metadata reconciliation require that tag AND absence of both
`meta.legacyMaxRestartCustody` and `meta.legacyMaxArchive`. Marker presence,
including null, permanently excludes a row regardless of status. Archived data
and untagged legacy commands are not adopted, modified, resurrected or replayed.
Insert-only enqueue with an existing archived ID is a no-op and then refuses
acceptance; it cannot make a second sendable copy of the archived command.
The MAX authority must have a non-sparse, non-partial unique `{id:1}` index.
Missing URI/index readiness fails startup rather than silently falling back.

One pull response claims at most one command, even when a larger limit is
requested. This preserves the API's upper-bound semantics and avoids losing a
known prefix when a later claim times out. The paired pollers run every 500ms,
request limit=1 and a 120-second lease. Concurrent pulls still have one winner.
A lost claim response remains recorded in Mongo; it is not blindly reissued.

## Outcomes and finite retries

- Provider confirmation requires the single MAX POST to return a verified message
  identifier. Success persists a token-fenced, idempotent ACK before API success.
- Only explicit rate-limit rejection or proven local pre-send admission failure
  returns to PENDING, with bounded backoff. Provider attempts stop after five;
  local admission deferrals stop after 21 total deferrals (20 automatic retries).
- Timeout, network uncertainty, 5xx or expired/lost lease becomes terminal
  DELIVERY_UNKNOWN. No automatic provider resend can create a duplicate.
- The paired receipt node retries ONLY the same CUP receipt during short backend
  outages: same ID, lease token, kind and sanitized body. Each HTTP request is
  bounded at seven seconds; at most twenty attempts fit inside the original wall
  AND monotonic lease budget. Authentication/protocol conflicts stop immediately.
- Downtime longer than the remaining lease cannot be advertised as recovered.
  Such commands remain durable and require explicit review; receipts are not
  secretly converted into a new provider attempt. No exactly-once end-client
  delivery claim is made for an unknown provider outcome.
- The existing fenced transport is text-only. Unsupported attachments/invalid
  input remain durable FAILED/INVALID_INPUT, not a fabricated delivery ACK.
  Do not activate a deployment that needs a working media transport without
  separately implementing and validating that transport. Payload is retained.

## Counts-only health

`GET /api/support/outbox/health?connector=MAX_BOT` (or MAX_ACADEMY_BOT) requires the
existing configured integration token; missing configuration is an error. It
returns protocol/connector and pending, leased, sent, failed, due, expiredLeases,
needsReview and oldestPendingAgeMs. It returns no text, recipient, command ID,
lease token or raw provider response, and performs no queue mutation.

Monitor expiredLeases > 0, needsReview > 0 and sustained due > 0 with oldest
pending age > five minutes. These are operational signals, not an instruction
to reset statuses/restart/replay. Consumer failure warnings are fixed codes with
no private bodies. No external notifications or scheduled monitor are created
by this PR.

## Paired activation prerequisites (not executed by this change)

1. Keep all archive/custody rows unchanged; capture and verify their exact
   membership/postimages separately. Use a fresh authorized runtime/disk/editor
   baseline and the actual installed worker/module inventories.
2. Rehearse the NEW module's native hot-install on Node-RED 4.0.9. Verify that the
   module is absent, the exact package has no dependencies/lifecycle scripts and
   registry/package/lock/dependency preimages are backed up. Installing a new
   module can register types without a cold restart; upgrading an installed
   module may require restart and is a different release boundary.
3. The LK pure builder requires reviewed raw full-flow and closed node pins for
   the current outgoing-only dedicated-sender topology. It must not be used as a
   generic editor import or replace another active operator's lease.
4. Pause consumer claims under release custody, drain in-flight known outcomes,
   close/drain the legacy intake epoch and snapshot ALL remaining new commands.
   Preserve accepted-but-unclaimed legacy PENDING commands. They are untagged
   and deliberately NOT claimable in v1. If the exact remaining set is nonempty,
   prepare/review an explicit frozen-ID, full-preimage admission transition for
   only eligible new PENDING/attempts0 commands; never blanket-tag by time/status.
   Legacy leased/unknown outcomes stay held for review. This PR performs no such
   production migration and does not authorize one.
5. Independently verify both backend and consumer configured mode/protocol,
   credentials scopes (without exporting values), whole-flow worker binding and
   rollback preimages. Match the exact final Node-RED native disk encoding.
6. After authorized paired activation, observe natural new receipts, a full
   worker cycle and the required soak. Recheck archive membership and new queue
   health. Do not send synthetic notifications to real customers as a test.

Once any v1 protocol-tagged row exists, legacy startup refuses that authority.
Rollback after v1 activation is consumer pause plus a compatible v1 backend or
repair forward. Never clear tokens/protocol markers or downgrade old data into
legacy PENDING to make rollback appear green. A previous legacy binary is not a
compatible state rollback. No archive restore/requeue is part of recovery.

## Local verification

Use only a disposable loopback Mongo with test commands enabled; never an app URI:

```sh
npm run test:support-max-receipts -- mongodb://127.0.0.1:<test-port>
npm run test:support-max-durable -- mongodb://127.0.0.1:<test-port>
npx ts-node test/max-outbox-local-defer.test.ts mongodb://127.0.0.1:<test-port>
npm run build
```

Tests cover durable acceptance/readback, recreated client+service with sync0,
concurrent ownership, stale/duplicate receipts, lost ACK, finite retries,
prospective-only commands, raw-byte unchanged archive/hold fixtures in every
status (including null markers), authority outage/no fallback and health auth.
The real local DB is synthetic; passing it does not attest production delivery.
