# Private local tournament participation owner v1

SOURCE packet on CUP #62 (`41c744d5163ec2e7e4fab9792d96eadc76d98087`), including #61 discovery. This is a bounded LOCAL_ONLY nonmonetary owner, not permission to activate production. Existing LK1/public routes remain unchanged for unadopted tournaments.

## Activation and compatibility

`TOURNAMENT_LOCAL_OPERATIONS_ENABLED` is owned by R1 tournament integration. Only the exact string `true` enables the private controller; absent, false and malformed values deny before database/provider access. Purpose: source deployment may precede the matched LK2 consumer. Activation requires that consumer's exact version, clean physical CI evidence, runtime identity/capacity/rollback acceptance, and explicit owner approval. Review/remove the temporary gate after matched consumer rollout and recovery acceptance; do not remove persistent adoption barriers with the flag.

A tournament becomes adopted on its first durable operation, including a supported FULL/MEMBERSHIP_EXISTS refusal. While `localParticipationOperations` exists, all legacy capacity/payment mutations, generic custom updates (including metadata), and restore/recreate updates refuse to write that document. The guard is in the Mongo mutation predicate, so a legacy read before adoption cannot overwrite a newly adopted roster. It remains active with the feature disabled. Unadopted documents preserve their previous paths. No canonical delete method exists; the existing restore path is guarded. Out-of-band database repair is not authorized or made safe by this packet.

This conservative metadata freeze is a real activation compatibility constraint: an adopted tournament cannot use existing admin/LK1 editing or phone-only leave. Rollback means disabling new private commands and retaining this code, document journal and barriers. Do not deploy an older writer that lacks the barriers, erase the journal, replace the document, or change its identity. No backfill, collection, index or standalone roster is introduced.

## Explicit supported subset

The raw custom document must declare source CUSTOM, public=true, archived=false, no source/exercise/snapshot binding and no competing joinFlow. Its exact booking object has only `enabled:false`, `paymentRequired:false`, `acceptedSubscriptions:[]`, `purchaseOptions:[]`. Missing declarations, arbitrary additional booking fields, provider refs, pending payments, display price labels, pricing popovers or subscription offers do not establish free eligibility and are refused. Existing roster entries require exact IDs and unpaid status; no pre-existing membership is adopted. Public target resolution uses #61's fresh complete mapping for new JOIN and must identify CUP_CUSTOM with no exercise. That observation itself never authorizes a write.

Canonical level and MALE/FEMALE profile checks reuse existing CUP services; MIXED has no gender balance/profile requirement. No provider booking, payment, refund or visit-return writer is called. Existing read-only identity/JWKS and canonical gender reads remain possible. Existing registration-open behavior is retained; unsupported/unknown raw status is refused. Capacity is maxPlayers against canonical participants. FULL is a durable rejection; WAITLIST creation/promotion is not supported here.

## Private API and identity

Both routes require the existing integration token plus freshly verified actor RS256 Bearer. Request-provided actor, phone, gender, level, provider IDs or payment values are not accepted. Responses use no-store/no-referrer and fixed metrics labels without payload logging.

`POST /api/internal/tournaments/local-operations`, with `Idempotency-Key`:

```json
{"schemaVersion":1,"action":"JOIN","tournamentId":"11111111-1111-4111-a111-111111111111","date":"2026-11-02"}
```

LEAVE has the same fields with action LEAVE plus `originalJoinOperationId`. Its date must match the original JOIN. Keys are scoped to the verified tenant, actor and public tournament; this is not a global cross-tournament key namespace. Same key with changed action/date/original generation conflicts. The operation ID derives from that scope/key; a separate domain-separated canonical request hash binds the body.

`POST /api/internal/tournaments/local-operations/read` takes exactly `{schemaVersion:1,tournamentId,operationId}`. It does not mutate or re-evaluate current eligibility. Lookup is bounded to 500 canonical custom identities; an ambiguous/over-limit lookup fails closed. Exact historical operation replay precedes fresh mapping and rules, so discovery expiry does not invalidate a committed receipt.

Responses separate `operation:{operationId,action,outcome,reason,generation,committedAt}` from `registration:{status,asOf}`. A historical REGISTERED outcome survives leave or cancellation; fresh state never presents a cancelled/conflicting/rejoined generation as the original current registration. NOT_REGISTERED_BY_OPERATION is not a claim that the actor has no external attendance.

## Canonical persistence and recovery

`localParticipationOperations` and `localParticipationTenantKey` live at the root of the existing tournament document and are excluded by its public DTO projection. Each entry retains exact command identity, actor hash/phone, original generation, outcome, mapping digest, canonical eligibility snapshot and `TOURNAMENT_LOCAL_OPERATION_V1` audit tag. No bearer, integration token or signing material is persisted. This embedded audit is written atomically with roster and updatedAt by one majority+j Mongo update; no roster notification fanout is added.

Every new update compares the entire raw document preimage. Concurrent JOINs or existing writers cause a CAS miss and at most three current-state attempts. Same-actor different keys cannot create duplicate membership. Ambiguous write acknowledgement permits only a primary-majority exact-operation readback; no new operation replaces an unknown outcome. An active journal generation fences a second JOIN for the same verified tenant/clientId even if its verified phone changes. Exact read/replay and LEAVE use that stable actor identity; LEAVE uses the original receipt phone and participant ID, never transfers membership to the new phone. A different actor with the same phone has no ownership. LEAVE targets the exact original participant ID and receipt phone, preserving all receipts; stale leave/retry cannot delete a later rejoin.

History is bounded to 512 retained entries and never pruned. Each REGISTERED original generation reserves one future LEFT entry. New JOIN and refusal entries require remaining capacity after these reservations. Exact valid LEAVE spends its own reservation; wrong-generation refusals cannot spend another member's reserved slot. Once historical capacity is exhausted, the tournament accepts no new operations, but committed receipts remain readable/replayable. This finite-history subset is deliberate; no automatic rollover or destructive reset exists.

## Evidence and pending acceptance

Synthetic tests cover exact auth/body/key, whole JOIN/read/LEAVE/rejoin, concurrent preimages, late generations, lost ACK, foreign actor/tenant, unsupported provider/payment evidence, canonical gender/level, immutable receipt versus current observation, public projection, legacy flag-off barriers, and final-slot LEAVE. CI-only `test/tournament-local-owner.mongodb.test.ts` uses the already provisioned GitHub rs0 on 127.0.0.1:27017 with directConnection, separate actual connections and a unique test database. It does not provision Mongo or use ambient credentials. No local DB/provider calls are part of development checks.

Source and LOCAL checks do not establish physical CI, runtime legacy compatibility, provider behavior or production readiness. Full workflow wiring and independent specialist review are required before the task-branch publication. No client consumer, production activation, money flow or provider-backed LEAVE is included.
