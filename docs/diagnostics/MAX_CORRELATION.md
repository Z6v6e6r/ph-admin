# MAX diagnostics companion (SOURCE only)

This accompanies `Z6v6e6r/lk` branch `codex/lk1-correlated-error-diagnostics`.
Baseline: `87d2726013ede2120904ca6c41a0cab2a4a954fc`. The primary dirty checkout is unchanged.
The LK PR owns the complete contract, synthetic examples, coverage matrix, collector and future
rollout/rollback/retention/volume plan in `docs/diagnostics/README.md`.

This repository owns support ingress/identity binding, connector selection, outbox creation,
in-memory lease/ACK state and persistence. LK owns MAX SDK send/catch/output and existing ACK wires.
Instrument only MAX_BOT/MAX_ACADEMY_BOT; other support connectors produce no MAX diagnostics.
No DTO, stored command shape, target fallback, attempts, retry limit, lease, ACK, fail or cleanup
semantics change. Existing constructors, timers and database/provider configuration are untouched.
Tests import source classes with synthetic persistence stubs, never the live application bootstrap.

`support-diagnostics-core.ts` vendors the v1 LK executable allowlist as TypeScript. Future changes
must preserve field/enum parity with the LK core. Logs exclude raw targets, user/customer/chat IDs,
text, meta, token, URL/query, error.message/stack, credentials and other unlisted data. Dedicated
server HMAC refs are domain-separated and are omitted without a key (refUnavailable=true). A
VERIFIED/OPEN profile is not evidence of bot identity or provider access.

Ingress emits request-local random IDs and checked identity presence/equality flags. Outbox
observations use an opaque outboxRef and bindingRef when configured. A lease observation is
executionObserved=false; leaseAttempt is the existing claim count, not an SDK executor count.
leaseAgeMs=0 is emitted only at the actual issuance of the new lease. Existing commands do not
persist a reliable lease-start timestamp, so downstream age is UNKNOWN; creation age is never used
as lease age. Origin is UNKNOWN unless already supplied as SYSTEM/VivaCRM, never inferred from
connector/status. Bot identity/access evidence remains unknown.

`persistOutboxCommand` reports persist-requested/outcome_unknown before the existing asynchronous
write. MAX enqueue is insert-only: DB_ACK appears only for an acknowledged new insert, never
for a matched no-op over a possibly stale snapshot. MAX does not run cross-backend cleanup.
Lease observations follow the actual Mongo claim. Receipt DB_ACK follows the acknowledged
majority receipt or majority duplicate readback; it confirms queue state for ACK or fail,
not provider delivery. Other connector write/cleanup behavior remains unchanged.
A requested ACK or in-memory SENT response is not Mongo ACK or delivery proof. No ACK is invented
on a rejected/disabled/unavailable write. Observability errors do not change the persistence path.

Future explicit rollout configuration:

- LK_DIAGNOSTICS_ENABLED=true enables only this safe sink; default output is disabled.
- LK_DIAGNOSTICS_SOURCE_RELEASE must be the immutable installed source SHA, else UNKNOWN.
- LK_DIAGNOSTICS_HMAC_KEY is a dedicated 32-byte diagnostic key represented by64 hex characters.
  No key is generated or installed here. It must never be an auth, bot or provider credential.
- Shared diagnostic-key custody with LK is required for cross-process pseudonymous refs. Without
  it, report the correlation gap. Node-RED attempt metadata must not be added to persisted commands.

Default detail budget600/minute; excess counts aggregate per event kind at most once/second, with
request/entity details removed. Metrics retain exact observed/suppressed/loggerFailures in process;
sink delivery/abrupt shutdown remain best effort. Future restricted JSONL rotation/retention uses
the LK plan (32MiB rotation,128MiB/source total,24h maximum). These are proposals, not live settings.

LOCAL: run `npm run test:support-diagnostics`, the four existing support regressions, type-only
check and build. CI invokes the new diagnostic test alongside the existing support suite. No
aggregate check/lint command exists here. Green CI does not establish runtime package parity.
Current runtime service/persistence hashes and SDK/bot binding provenance need a separately
authorized scoped read; the supplied incident package is dated evidence only.

No merge/deploy/import/restart/rollback, real DB/index/migration/ACL/routing/secret mutation, provider
request, message send or live cleanup was performed. Publication/deployment and rollback remain
separately authorized transitions using the existing immutable-release runbooks.
