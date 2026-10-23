# MAX outbox receipt protocol v1

MAX_BOT and MAX_ACADEMY_BOT use acknowledged Mongo claims and receipts. Other
connectors keep their existing queue implementation. No rollout, message replay,
cleanup, migration or reset is part of this source change.

## API and stored shape

- GET /api/support/outbox/pull requires receiptProtocol=max-lease-v1 for MAX;
  legacy/missing protocol returns409 OUTBOX_RECEIPT_PROTOCOL_REQUIRED before a claim.
  A configured, valid integration token is required; missing configuration returns503.
- Every claim atomically increments attempts and creates a UUID leaseToken.
- POST /api/support/outbox/:id/ack body: {leaseToken}.
- POST /api/support/outbox/:id/fail body:
  {leaseToken,failure:{status,code},retryAfterSeconds?}. Legacy error/requeue values
  cannot override the MAX policy. No raw message/body/stack/headers are stored.
- Missing/malformed/stale/expired token or conflicting receipt returns409 without
  modifying the command. Duplicate same-kind receipt returns the original result;
  it cannot shift retry due time. A new claim clears the previous receipt.
- Claims/receipts use the configured MAX backend only, never runtime fallback to
  another database. Acknowledged writes use majority; API success follows Mongo.
- MAX enqueue is insert-only. Old process-local snapshots cannot overwrite a
  lease, terminal state or provider diagnosis. This intentionally freezes the
  original MAX command's delivery/association fields after enqueue, including on
  client/dialog merges; merge metadata must not be used to reconstruct delivery.

Additive optional fields: leaseToken,nextAttemptAt,updatedAt,lastReceipt,
lastProviderFailure,terminalReason. Existing id unique and connector/status indexes
remain unchanged. No new indexes, backfill or startup migration. MAX store reads
Mongo directly, so another process's claim/receipt does not depend on stale Map
hydration. Non-MAX known commands do not query MAX storage on ACK/fail.

## Retry and outcome semantics

| Outcome | Action |
| --- | --- |
| Provider accepted200 with message.body.mid | SENT after valid receipt; this is API acceptance, not human delivery/read |
| Explicit429 | PENDING with persisted exponential backoff+jitter, bounded Retry-After(300s), max5 attempts |
| Other4xx, including403 with unknown code | FAILED/PROVIDER_REFUSED; no assumption that the user blocked the bot |
| Network/timeout/5xx/malformed success | FAILED/DELIVERY_UNKNOWN; never automatically replay an ambiguous send |
| Expired or legacy LEASED without valid receipt | FAILED/DELIVERY_UNKNOWN, no reclaim/send |
| Invalid input/unsupported attachments | FAILED/INVALID_INPUT |
| Attempt cap | FAILED/ATTEMPTS_EXHAUSTED; provider failure preserved separately |

A new intentional message is a distinct command with its own bounded budget. This
patch does not block an entire recipient/dialog based on an unspecified403, nor
provide a manual requeue/resume endpoint. Unknown delivery needs operator/provider
reconciliation under separate authorization. Receipt loss is not delivery failure:
only the same receipt may be repeated, never the provider send. Exactly-once external
delivery is not promised. Mongo write timeout can leave an uncertain receipt; retry
that same receipt/token safely, rather than sending a second message.

## Paired upgrade and recovery plan (not authorization)

1. Obtain separate approval for the exact backend and LK adapter revisions. Keep
   backups of code/config and queue state within existing secret-safe custody.
2. Pause all legacy MAX pollers, drain known in-flight handlers and reconcile
   ambiguous existing leases without resending them. Confirm configured queue DB
   and existing unique id index; reject fallback copies/duplicate IDs.
3. Install the reviewed backend and paired LK max-outbox adapter/graph in staging.
   Verify real Node-RED module loading, config-node token access, abort/close,
   receipt persistence, protocol handshake and both connector graphs without using
   real recipients. Then obtain the distinct production decision.
4. Legacy pollers must remain paused: backend-first old pulls are rejected;
   adapter-first old commands lack tokens and must not send. Enable only paired
   protocol-v1 consumers after runtime checks.
5. Verify state/hash readback, no stale receipt mutations, no unexpected claim,
   bounded429 due times, no PII/provider text in diagnostics, and a defined soak.

Rollback must pause pollers first and preserve new terminal/uncertain states.
Do not revert to the legacy lease-expiry replay loop or remove fencing fields to
make old receipts pass. Source rollback alone is not permission to replay data.
No automatic repair/backfill is supplied. Old LEASED records will be quarantined
on the first protocol-v1 pull; retain them for explicit reconciliation.

## Verification

npm run build
npm run test:support-outbox-max-attempts
npm run test:support-max-receipts -- mongodb://127.0.0.1:<isolated-test-port>

The Mongo test accepts loopback only, creates and drops a random max_retry_test_*
database, and never loads app env files. It covers concurrent claims, stale and
opposite receipts, duplicates/lost response, due time, exhaustion, old records,
privacy, intended-backend failure and non-MAX isolation. The adapter companion
uses mocked fetch only. CI runs Mongo7 on an isolated service. These checks do not
prove provider delivery, production topology or real Node-RED installation.
