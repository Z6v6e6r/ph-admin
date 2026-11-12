# MAX new-generation isolation — preparation, not activation

## Scope and status

This source change provides a fail-closed new-only boundary for both MAX connectors in legacy custody mode. It does not deploy, mutate an operational queue, choose a live epoch, query MAX updates, restart a service or remove any pause. Existing receipts-v1 and non-MAX behavior remain unchanged when configuration is absent.

**The current installed83 process cannot safely receive this feature by an unreviewed restart.** Follow `docs/LEGACY_MAX_RESTART_CUSTODY.md` and `docs/LEGACY_MAX_SNAPSHOT_NORMALIZATION.md`: retain old Map and complete independently enumerated Mongo namespaces before the first restart. The source release and an installed83-compatible recovery path must both enforce the generation barrier; the V2 five-module recovery manifest is required; a historical three-file V1 recovery does not cover these new modules/controller.

## Protocol

Two public, server-only operation settings identify an immutable epoch:

- `SUPPORT_MAX_GENERATION`: UUID operation ID, not an authentication token.
- `SUPPORT_MAX_GENERATION_AFTER`: canonical UTC ISO timestamp chosen at a future fenced cutover.

A partial/invalid pair, non-legacy MAX mode or absent dedicated `SUPPORT_MAX_GENERATION_TOKEN` rejects startup. MAX ingress, parsed MAX pull, known-MAX ACK/fail and explicit MAX identity lookup require `x-max-generation-token` while the epoch is active. Non-MAX shared integration authentication is unchanged. Provisioning is an explicit separately reviewed data operation, never startup behavior. The configured MAX outbox namespace owns `<outbox>_generation_control` and its built-in unique `_id` index. Its singleton is:

```json
{"_id":"max-new-only-v1","schema":1,"generation":"<operation UUID>","after":"<fenced UTC epoch>","state":"CLOSED"}
```

After source/custody/graph acceptance, a separate CAS may change only `state` to `OPEN`. Generation and timestamp never rotate under writers. Pause consumers and finish in-flight operations before changing control state; control reads are not a distributed drain protocol.

Every legacy MAX transition reads the singleton with primary/majority semantics. Missing control with configured epoch, CLOSED, drift, unknown read, or a retained control without configuration rejects admission/claims. Removing environment settings cannot reopen the queue on this writer. Every Map claim and durable claim also checks the persisted `meta.maxGenerationAdmission`. Cached rows, primary-store residues and late legacy writes cannot gain a tag through hydration or metadata reconciliation. Old rows/statuses/evidence are retained; no claim sweep, deletion, fake ACK or `confirmed_not_sent` is used to isolate them.

Only fresh server-created staff replies and AUTO_REPLY intents with an original fresh provider timestamp/stable external event ID receive a tag at durable enqueue. Enqueue time never upgrades an old intent. No-reply timer origins are held for separate admission. Existing custody makes expired claims and unknown legacy failures terminal holds; no transport replay is introduced.

## Incoming MAX admission

`POST /api/support/max/ingress/admit` requires the dedicated **configured** `x-max-generation-token`; the historical shared `x-integration-token` contract is unchanged, one canonical MAX connector, event ID and original canonical provider time. It inserts one hashed event key into the control collection with majority+journal acknowledgment before any Node-RED business handler. The response contains only an opaque admission ID and epoch. Duplicate, failed or unknown admission never retries with a new ID.

`ingestEvent` consumes this admission by CAS before identity/history/auto-response side effects. A duplicate or uncertain handler execution stays held across restart. Direct backend integrations without a pre-admission ticket use the same insert/consume sequence. This is at-most-once processing admission, not lossless delivery: handler failure/unknown persistence needs explicit reconciliation, and the ledger deliberately contains no message/recipient payload.

The paired LK preparation must gate **all** receiver/webhook/link-in paths before lookup, callback `/answers`, direct service sender, support event and auto-reply. Existing raw timestamp fallbacks cannot be used as freshness evidence. Callback ID and update timestamp must be used together; old message timestamps do not make a fresh callback old. Unknown timestamps/IDs or unauthenticated webhooks stay held. Polling marker/drain is not executed by this preparation.

## Concrete release gates (all required, currently not attested)

1. Own the shared release lock. Recheck exact loaded process identity/source/module hashes, initial/effective mode, all physical namespace mappings, all eight MAX pauses and SDK guard hashes. No unrelated release may restart this backend during custody capture.
2. Review a cooperative old-process capture/drain bridge. Preserve pre-drain and final MAX Map plus web history custody; stop old producers and independently enumerate complete durable namespaces. Never use outbox pull as export, inspector/credential bypass, or inferred Mongo-only completeness.
3. Bind the complete retained union, private artifacts, runtime identity and target fingerprints. All commands present before the fresh epoch remain old, including arrivals during the earlier pause. Preserve old SENT/FAILED and ambiguous lease evidence. No migration into the new generation.
4. Prepare a clean pushed source release, exact installed83 preimage/recovery manifests and closed singleton. Complete source/runtime claim tests for old Map, old durable/residual rows, late writes, missing config, duplicates, lost ACK, expired claims, restart and rollback. Merely swapping collection names or calling `fail(false)` is insufficient.
5. Verify both actual bot graphs: fresh provider timestamp/ID gate -> durable pre-admit HTTP round trip -> business handler. It must dominate every direct sender and callback. Keep transport nodes paused throughout these checks. Test only fake transport; do not call real pull/provider to prove the gate.
6. Verify durable readback and zero old admissions/claims, matching epoch in Node-RED/backend/control, configured dedicated MAX token, fresh receiver-source compatibility, and absence of an older writer. Only then prepare a **separate** reviewed unpause action.

The present source PR is not first-restart acceptance. Until these receipts exist, live isolation and unpause readiness remain **HOLD**. The user authorized queue isolation and preparation; source merge, the shared backend maintenance window and its reviewed deployment/restart remain distinct transitions requiring exact authority.

Rollback keeps all MAX transport paused and retains the control/old custody. Never restore old PENDING/LEASED, delete the ledger, disable its epoch on a compatible writer, or start an older writer that ignores this barrier.
