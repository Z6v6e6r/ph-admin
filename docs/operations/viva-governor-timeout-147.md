# Viva governor timeout — server 147 release candidate

Status: source fix and focused regression tests prepared. This document is not
permission to merge, deploy, restart, replay a POST or change production data.

## Changed behavior

A shared Viva read now has a deadline covering fetch and response-body parsing.
`VIVA_END_USER_TIMEOUT_MS` supplies the existing timeout (default 5000 ms). On
expiry all callers receive the same timeout failure, the AbortSignal is cancelled,
and the key is released. A new call can execute again subject to the existing
circuit breaker. No automatic retry is added. An ignored cancellation or late old
completion cannot evict a newer operation or update its circuit outcome.

Only VivaTournamentsService uses this governor, for GET reads. Routes, DTOs, Mongo
records, payments and registration mutation behavior are unchanged. With the
governor disabled, the existing direct-fetch path is preserved. The timeout bounds
one operation; a chain of sequential fallback reads can take multiple intervals.

## Provenance and scope

The source base is the actual active release commit
`3cc4708811fc3d734d1c6673fd38f3b928589154`, not the directory currently checked out
at `/opt/ph-admin`. The compiled delta is exactly:

- `dist/integrations/viva/viva-request-governor.service.js`
- `dist/integrations/viva/viva-request-governor.service.d.ts`
- `dist/integrations/viva/viva-tournaments.service.js`

Expected previous executable SHA-256 values, verified read-only on 17 November:

- governor: `8c4a2cb34a21f1e1d703aeca34337bc6b7a5092f1551d970b79c0352e61865ef`
- tournaments: `6212104b2d96574541ad650270aeb2ae8af2ff875a0b7d4a9e09ef365bcaaa91`

The artifact manifest records candidate commit, file hashes, previous file hashes,
archive contents and successful checks. Temporary incident Inspector scripts and
production logs are not part of this fix or artifact.

## Rehearsal and validation

- `npx ts-node test/viva-request-governor-timeout.test.ts`: timeout despite ignored
  abort, concurrent callers, retry, late success/rejection ownership, synchronous
  throw, reentrancy, circuit cooldown, body hang integration and keyless bound.
- `npx ts-node test/viva-request-governor.test.ts`: existing dedup/circuit and
  governor enabled/disabled behavior.
- `npx ts-node test/tournaments-custom-from-viva-link.test.ts` and
  `npm run test:tournaments-pricing-snapshot`: existing creation/pricing contracts.
- `npx tsc -p tsconfig.build.json --noEmit --incremental false`, `npm run build`,
  `npm run test:auth-rbac` and `node --test test/cup-runtime-artifact-workflow.test.mjs`.
- Both governor test files run automatically in the existing immutable-runtime CI.
  There is no aggregate repository test/lint gate.

## Activation plan — requires separate explicit authorization

1. Verify immutable candidate and rollback archives against their manifest. Repeat
   active PID, start time, executable, cwd and current-file hash checks. At the last
   check API port 3000 belonged to PID 1607888, service
   `phab-api-p32-2be5b1f`, cwd `/opt/ph-admin-releases/cup-3cc47088`; Inspector was off.
   Stop on drift and prepare a fresh review; do not overwrite the active directory.
2. Create a fresh release directory by copying the complete active runtime, keeping
   runtime binary, dependencies and all other assets unchanged. Replace only the
   three allowlisted files using fresh files plus atomic rename (never write into
   hardlinked baseline files). Include the overlay manifest beside the original
   runtime provenance. Verify only the allowlisted delta remains.
3. Preserve/review the effective service command and operational configuration.
   Multiple systemd drop-ins and a competing `phab-api` restart loop exist. Do not
   restart `phab-api`, run the generic updater, alter routing or guess which unit
   should own port 3000. The authorized rollout must explicitly pin ExecStart and
   WorkingDirectory to the reviewed complete candidate, preserving environment and
   capability settings. No env values belong in an artifact or report. Resolve any
   port-owner/configuration conflict before a service transition.
4. After approval for that exact service/candidate, stop/start the intended API
   service once. This is needed to replace old singleton/map state; a disk-only
   overlay does not repair the running process. Do not replay pending creates.
5. Verify port owner/new PID/cwd, actual served runtime hashes, health, no Inspector,
   governor diagnostics and logs. Then perform one separately authorized natural
   save of the target tournament. Check one custom record, correct source linkage,
   expected skin and pricing status. A quick health response is not acceptance of
   tournament persistence. Existing circuit policy may reject after repeated
   provider timeouts until cooldown; do not clear the map or widen timeouts live.
6. Observe provider timeout failures and recovery, with no indefinitely retained
   in-flight key. Do not treat a finite fallback chain as an infinite map hang.

## Rollback

Keep the complete old release directory and the pre-change effective service
configuration. If new API startup/health/served behavior fails, use the separately
authorized rollback transition to that exact old release and verify PID/cwd/hashes
and health. No database rollback is needed: this fix has no schema/data migration.
The old governor can reproduce the original hang; rollback is service recovery,
not a resolution of this incident. Never restart or kill an unrelated port owner.

Residual limits: an AbortSignal cannot force an arbitrary executor to release all
resources; the returned promise and dedup key are nevertheless bounded. The initial
transport event behind the incident's nonsettling promise was not established.
