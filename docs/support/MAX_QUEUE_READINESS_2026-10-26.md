# MAX queue readiness and guarded activation — 26 October 2026

Owner: CUP support/messaging. Audience: main MAX and Academy support recipients.
This packet prepares source and acceptance. It does not authorize merge, deployment,
control provisioning, trust changes, queue reconciliation, real sends or activation.

## Runtime guarantees and limits

- Receipt-mode application replies await majority queue admission before publishing a
  new outbound history message, SLA success or HTTP success. Other message/history
  persistence remains eventual; this is not an atomic transaction for all support data.
- Enqueue, batch pull, ACK/fail and operator reconciliation update one control document
  **first** inside a Mongo transaction. Snapshot reads and majority commit serialize
  independent API processes. Command IDs are created before any transaction retry.
- `queueSequence` comes from that transaction, so a backdated event, UUID tie or concurrent
  insert cannot overtake an admitted message. A recipient means connector/bot scope +
  chat-preferred-else-user target, with trimmed identifiers and distinct target types.
- Select the recipient head before checking due time/status. A429/backoff, live lease,
  DELIVERY_UNKNOWN or an unreviewed legacy record holds that recipient. Other recipients
  continue. Only a structured proven refusal/invalid input/exhausted429, SENT, or an explicit
  evidence-based non-delivery decision releases its successor.
- All claims in a pull commit together. A failed statement aborts all tentative claims;
  an unknown commit emits no commands. If its leases did commit, expiry quarantines them
  without a provider replay. Fixed failure telemetry reports operation/stage/tentative
  count only; tentative claims are never reported as confirmed execution.
- Mongo statements and commit share a monotonic5s budget; abort cleanup has a separate
  bound of at most100ms. A transient, proven-aborted DB transaction may retry within
  that budget (max8 callbacks). An unknown commit never reruns the command/provider.
- Ordinary expired/stale/opposite receipts remain409. Retain token/expiry/attempt privately
  for explicit reconciliation. There is no public reconciliation/requeue endpoint.
- Automatic replies use upstream MAX message IDs; separate staff waiting cycles use their
  own staff-message ID. Admission retries keep one intent ID across restart; input without
  a stable upstream ID remains in support history but does not trigger an unsafe auto reply.
  No-reply timers retry admission at most5 times per runtime, then warn for operator action.
- A manually repeated staff HTTP request remains a new intentional message; there is no
  end-to-end client idempotency/read/delivery guarantee. A provider200 means acceptance only.
- The adapter supports text only. Attachments require separate media acceptance.

## Explicit control migration and compatibility

The canonical outbox has one new companion collection: `<configured_outbox>_max_control`.
Its only required index is Mongo's built-in unique `_id`; retain the existing non-partial
unique outbox `{id:1}` index. No outbox backfill/index repair/startup creation is added.

Provision exactly one reviewed document while consumers are paused:

```json
{"_id":"max-queue-v1","schema":1,"enabled":false,"sequence":0}
```

Standalone Mongo is unsupported. Verify actual replica-set/sharded transaction support
and majority durability **on the canonical MAX database**, not an available fallback.
Provisioning is an explicit operator migration; startup never creates or enables control.
With receipt-v1 mode and absent/disabled control, admission/pulls fail closed. Pausing
control blocks new admission/claims/receipts, so pause pollers and drain receipts first.

Legacy mode refuses a provisioned control or records containing queueSequence/fencing
state. A recovery artifact must retain that guard. Never restore an old binary/poller
that ignores new fields or treat deleting control/lease fields as rollback.

Old PENDING/LEASED/FAILED records are not automatically sent, bulk quarantined, deleted,
rewritten or given a sequence by this implementation. They block their addressed stream.
The owner has requested **individual review of old messages**. Keep that decision;
classify each record with evidence and preserve every unresolved outcome.

## Offline operator tool

Run compiled/tested source under the exact intended runtime and existing canonical API
configuration, provided through the approved runtime mechanism. The tool does not read
`.env` files or bootstrap the application. It uses the API's authority resolver and never
falls back after a connection failure. Never print or put the URI/token on a command line.

Audit is the default and performs reads only:

```sh
npx ts-node scripts/max-outbox-readiness.ts --report /absolute/private-new-dir/audit.json
```

Use a private owner-controlled directory. Report files are exclusive0600, outside the repo.
Stdout contains counts only. Private cases contain command ID, state, attempts, timestamps
and a canonical BSON preimage fingerprint; no text/recipient/token/URI. The fingerprint
includes BSON types and the document identity. A DB audit does not prove consumer pause,
bot mapping, trust configuration, writer inventory or provider delivery.

Mutation is only via a reviewed external0600 plan, with its exactSHA256:

```sh
npx ts-node scripts/max-outbox-readiness.ts \
  --report /absolute/private-new-dir/result.json \
  --apply-plan /absolute/private-dir/reviewed-plan.json \
  --plan-sha256 <exact-reviewed-plan-sha256>
```

Plan schema is `MAX_QUEUE_OPERATOR_PLAN_V1`. Every plan binds `targetFingerprint` and
`expectedControlFingerprint` from a fresh audit, and explicitly attests
`consumersPaused:true` and `writerCohortVerified:true`. Those attestations require actual
operator evidence; a boolean cannot manufacture it. Supported actions:

| Action | Conditions and effect |
|---|---|
| `provision` | Control absent, transaction capability and unique-ID index verified; create disabled control only. |
| `reconcile` | Control disabled; one exact `id` + `expectedRecordFingerprint` + `resolution` + `evidenceSha256`; also supply `--evidence-file` to verify private evidence bytes. |
| `enable` | No unreviewed old/unknown records or outstanding leases; `pairedAcceptanceVerified:true` and `recoveryArtifactVerified:true` with reviewed packet evidence. CAS the exact control. |
| `pause` | Consumers already paused/drained; CAS the exact control to disabled. |

Reconciliation resolves only `confirmed_sent` or `confirmed_not_sent`. The disabled control and exact control fingerprint are checked again atomically inside the transaction. It never sets PENDING,
resets attempts, sends to MAX or changes delivery association. Ambiguous evidence remains
unresolved. Active leases and changed preimages reject. Duplicate matching proof is safe;
a repeated whole operator plan still needs fresh control readback. Unknown write outcome:
stop and audit; never blindly repeat a mutation. Legacy cleanup mutation is prohibited
for fenced MAX queues; do not bypass that guard with another script/manual database edit.

## Required paired adapter and topology

Use the combined LK snapshot `e357e70f279813a5d77bec6a7afd85ffbff59b87`
(`codex/max-queue-readiness-20261026`): merged pairing fix PR240 plus PR237 refusal
allowlist, with the activation note and immutable acceptance evidence.
The previous083a127 constructor swaps the real main/Academy pairs; it is not an eligible
activation dependency even if a generic synthetic two-bot graph passed.

| Queue | Flow | Bot config | Dispatch / pull |
|---|---|---|---|
| MAX_ACADEMY_BOT | 99db28109ee6a1f7 | 55b05444842e7b84 | 47c460de0db646e6 / 41be3d2c95b57295 |
| MAX_BOT | 913584cf84dbb460 | a5d5eca27e9e56da | 0006d5707259bc5b / 2e547e998eee631f |

The constructor now guards queue-specific pull hashes, flow ID and exact bot config ID.
Actual config-node identity/token access still needs secret-safe installed staging acceptance.
Use one Node-RED process; its shared scheduler permits one in-flight attempt and at least
500ms between starts for an addressed dialog. Disable all parallel legacy outbox paths.
No alternative writer (old API, repair, cleanup, manual script) may bypass the control fence.

## TLS preparation

A read-only probe from147's Node22.23.2 found stock trust fails with
`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` for `platform-api2.max.ru`. The peer issuer is
`Russian Trusted Sub CA`. A public root from
<https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt> was independently
fingerprint-checked and supplied only to one ephemeral strict TLS connection: TLS1.3,
authorized=true, hostname `*.max.ru`. No HTTP, credentials or message was involved.

Root certificate DER SHA256:
`D26D2D0231B7C39F92CC738512BA54103519E4405D68B5BD703E9788CA8ECF31`.
Prepared PEM SHA256:
`936a43fea6e8e525bcc0f81acd9c3d21b4fc4b9b68acea7906d698005afc6504`.

No server trust/configuration was changed. A later explicit trust action must name the
exact CA bytes/path and Node-RED process scope, preserve any existing extraCA configuration,
and reverify actual-runtime hostname/chain with validation enabled. Avoid a system-wide
trust install. NODE_EXTRA_CA_CERTS affects all TLS from that Node process; it is not a
per-domain trust pin. Never use rejectUnauthorized:false, NODE_TLS_REJECT_UNAUTHORIZED=0
or an insecure agent to unblock activation.

## Ordered activation and safe stop — not executed

1. Freeze merged/pushed backend + bot-pair adapter source, artifacts/hashes, tests, exact
   canonical DB authority and CA packet. Confirm transaction topology/majority/index readiness.
2. Obtain exact authorization for this source/scope/target, explicit control migration,
   service-scoped trust change, Node-RED import/restart if needed, verification and recovery.
3. Fresh authenticated runtime flow export into a new private external workspace; verify
   full wiring, config identities, poller inventory and foreign-change guards. Disk metadata
   is not authenticated running-flow attestation. Retain current code/config/queue custody.
4. Pause both legacy outbox pollers, drain known handlers/receipts. Individually reconcile
   old records under separate exact case authority; never mass-reset/replay them.
5. Stage/provision disabled control and install reviewed API/adapter plus scoped trust.
   Validate loaded module/editor, both real bot pairs, protocol/auth, TLS and safe-stop path
   against synthetic recipients/provider transport only. Do not run real sends as a TLS test.
6. Fresh target-bound audit/plan and explicit enable, then enable only protocol-v1 pollers.
   Control state by itself is not permission to start a sender. Observe bounded claims,
   pending age, uncertain/held streams,429 due times, receipts, actual PID/process count,
   status counts and safe diagnostics for a defined observation period.
7. Stop on foreign state, wrong binding, TLS/auth/protocol failure, unexpected duplicate or
   unexplained held stream. Pause pollers; drain confirmed receipt handlers, then pause
   control. Preserve every lease/receipt/terminal record. Recovery keeps fencing and control;
   never roll back into legacy expiry replay. Disabling source/config does not undo a send.

## Acceptance evidence

Local tests use official-SHA-verified Mongo7.0.28 in three owned loopback processes, real
Node-RED4.0.9 and actual Nest support controller/service/persistence with mocked provider.
Physical tests cover independent API processes, backdated admission,429 head blocking,
transaction batch rollback, accepted-but-lost commit response, expired/unknown holds,
per-record reconciliation, paused replication, actual primary SIGKILL/rollback/restart,
majority ACK custody and duplicate admission. Paired CI pins the exact LK commit and emits
runtime hashes. Unit fixtures are explicitly not persistence proof.

Run the applicable receipt/queue/operator/replica tests and build; see the exact-head
`max-outbox-receipts.yml` jobs for disposable Mongo and pinned Node-RED setup. Production
DB capability, installed module/flow/bot acceptance, scoped trust installation, per-record
old-queue review and live delivery/read receipts are separate evidence. Keep activation
closed until those live prerequisites have actual receipts.
