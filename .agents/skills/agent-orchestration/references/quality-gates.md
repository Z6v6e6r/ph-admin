# Quality gates

## By risk

- R0: syntax/visual check, configured formatter if any, narrow test if any, diff review.
- R1: focused test, no-emit typecheck for TS, build when emitted assets are in scope, diff review.
- R2: safe baseline when useful, targeted and relevant integration tests, affected typecheck/build, and at most one independent review when complexity or a domain trigger justifies it.
- R3: baseline, relevant unit/integration/contract evidence, build, negative and concurrency paths, one specialist reviewer selected by the actual risk trigger, compatibility, rollback/recovery, and observability. Add a second reviewer only for a distinct independent risk area.
- R4: recorded invariants/decision, all relevant automated levels, dry run, recovery rehearsal where safe, two independent review perspectives, release audit, manual approval before irreversible action, no automatic production deployment.

This repository has no aggregate test/lint/formatter/CI script. Report that limitation precisely and use the nearest focused evidence. Never use `support:cleanup-outbox` as a check or repeat an unchanged passing command merely because a checkpoint was created.

## Auth and access

Separate authentication from authorization. Test default deny/route metadata, role and permission checks, object/station/tenant scope, ownership, revoked/expired sessions, token validation, enumeration, sensitive logging, legacy compatibility, and audit records.

## Mongo persistence and migrations

Confirm canonical collection/database, index uniqueness, old/new application coexistence, null/default semantics, idempotent/repeatable execution, partial failure, locks/duration, affected counts, forward verification, backup/recovery, and post-change queries. Startup index creation is not a substitute for a migration plan.

## Games, tournaments, schedule, pricing, ratings

Check overlapping/capacity races, duplicate requests, concurrent join/waitlist winner, timezone, cancellation, stale availability, pricing snapshots/currency, partial external failure, deterministic results, corrections, duplicate/cancelled matches, and historical auditability.

## External systems and messaging

For Viva, LK, Telegram, Node-RED, Web Push, and webhooks, verify trust boundary, source of truth, authentication/signature, timeout, bounded retry/backoff, idempotency/deduplication, ordering, rate limit, circuit/failure isolation, reconciliation, privacy, audit/metrics, and recovery. A provider mock or queued outbox record is not delivery proof.

## API and client UI

Check public route/DTO/error/status compatibility, nullable fields, enum expansion, pagination, versioning, idempotency, old clients, and contract-negative cases. For `client-sdk/` and served UI, inspect the actual served asset, responsive/loading/empty/error states, keyboard/accessibility where relevant, permissions, console errors, and network requests.

## Deployment and release

Identify the exact target (local, Docker, server-147, Nano/staging, production) and immutable source SHA/artifact. Require pre-change snapshot, config-key presence without printing values, migration status, health/readiness plus real behavior, rollback command/artifact, monitoring/log evidence, compatibility, and explicit user approval. Never infer production success from local build output.
