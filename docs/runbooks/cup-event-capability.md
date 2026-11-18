# Exact CUP EVENT capability activation

This is an **R3 operational procedure**, not an application build or a general configuration editor.
It needs explicit owner approval for the two existing flags and a restart of the named CUP unit.
Source/security approval of the community writer does not approve this executor by itself.

## Fixed scope

- Host `lk-primary-147` / `3170594-cd19972`.
- Unit `phab-api-p32-2be5b1f.service`; existing release flock `/run/lock/phab-api-release.lock`.
- Preserve the currently selected immutable runtime `cup-419b7778`, source
  `419b777880d699d10681c3dd97077964a1669e73`, tree `cf4d86ea537031eab928278e3dbea92d7615b3a6`.
- Verify its manifest `62bdf040a8f5bc5119c3d2dfa9aa6115ae544ade07d43ef9579c88bd05c2ae1c`, every listed runtime file,
  the actual packaged executable and the source process. Do not deploy or restore superseded cup-26e3589 or cup-38e80af.
- Create only `/etc/systemd/system/phab-api-p32-2be5b1f.service.d/85-exhibition-event-capability.conf`.
  It contains only `PHAB_COMMUNITY_POLICIES_ENABLED=true` and `PHAB_COMMUNITY_POLICY_TYPES_ENABLED=EVENT`.
- EVENT capability becomes available to staff who already have the required role/permission/scope.
  This operation does not grant permissions or create identities. The subsequent business operation is restricted
  operationally to `community_1794221739126_корпспорт-падлхаб-2026`.

No real `.env` contents are read, edited or copied. Existing configuration is pinned by unit/drop-in hashes and
configuration-file metadata. All effective loaded drop-in files, including foreign `/run` or vendor paths,
remain in custody. Loaded
membership/order and file identities/bytes are pinned, excluding only the exact owned delta. Every repeated
`EnvironmentFiles` record is retained in systemd precedence order; duplicate scalar properties are rejected.
Environment-file contents are never read, and metadata for every listed file and its symlink target is pinned.
Process-environment values stay inside the adapter; only the two non-secret flags
and a digest of all other initial values are returned. Only INVOCATION_ID, JOURNAL_STREAM and SYSTEMD_EXEC_PID
are excluded as known volatile initial fields. Effective application capabilities are verified separately via
an authenticated server-rendered admin page: absence from the initial process environment alone is insufficient.

## Build and local evidence

```sh
node --check scripts/cup-event-capability.mjs
node --check scripts/cup-event-capability-remote.mjs
node --test test/cup-event-capability.test.mjs
```

Tests use synthetic facts, actual disposable files and systemd/process transport doubles. They cover the
exact target/two flags, no-clobber durable publication, inode custody before visibility, stale preimages,
release-flock ownership, unrelated config/runtime/environment/service drift, interrupted/failed publication,
restart recovery, failed browser evidence, source checks and the real CLI refusal path. They do not prove a
real restart or authenticated browser response. No application source/dependency graph is changed by these scripts.

## Admit and stage the exact procedure

1. Freeze the task commit/tree and both script hashes, obtain independent review of this executor and recovery,
   and preserve the already-approved current runtime and all foreign drop-ins. Reuse writer/security review
   only after proving its relevant source unchanged.
2. Create one fresh root:root0700 stage matching `/root/.phab-exhibition-event-YYYYMMDDTHHMMSSZ-UUID`.
   Place both scripts there as root:root0600 ordinary single-link files. Read their exact hashes back before execution.
3. Under the existing exclusive release flock, run `inspect`. It performs read-only runtime/configuration,
   protected-service, anonymous-denial and public-health checks. Capture its actual snapshot, never a fixture.
4. Build a fresh mode0600 `plan.json` in that stage with the exact host/unit/runtime/drop-in/flags, `before` snapshot,
   `scriptHashes` for exactly the two scripts and a fresh random `nonce`. For automatic browser acceptance,
   bind `browserProofSha256` before the wait. For explicitly owner-run browser acceptance use only
   `acceptanceMode: "owner-manual"` and omit `browserProofSha256`; no other acceptance mode is supported.
   Set `startupBehavior` to `preserve-existing-not-write-free`: this operation preserves the current background
   configuration and does **not** claim zero startup/database/provider activity. Unknown or changed startup scope,
   source/config precedence or callback custody is a stop condition, not a reason to toggle maintenance/worker flags.
5. `preflight` must pass on that exact plan with no intent, ownership, applied, complete, recovery or browser-proof
   marker already present. Any PID/start/config/runtime/environment/neighbor drift invalidates admission.

Example invocation shape (all placeholders must come from the reviewed packet; not a ready live command):

```sh
flock -n -E 75 /run/lock/phab-api-release.lock \
  /usr/local/bin/node STAGE/cup-event-capability-remote.mjs inspect
flock -n -E 75 /run/lock/phab-api-release.lock \
  /usr/local/bin/node STAGE/cup-event-capability-remote.mjs preflight STAGE/plan.json
```

The adapter independently verifies root/Linux/host and the actual ancestor-owned exclusive kernel flock;
a caller flag cannot supply lock ownership. It rejects arbitrary targets, pre-existing config, symlinks,
unknown runtime, changed script hashes and stale process/config preimages.

## Apply and observe; keep owner acceptance separate

Only after admitted exact-target approval, execute `apply STAGE/plan.json` under the same flock.
The operation writes a durable private intent and pre-publication inode receipt; exclusively publishes the
single non-secret drop-in; reloads systemd; verifies effective flags and unchanged foreign inputs **before**
restart; then restarts only CUP. It verifies a new active PID/start tick, stable automatic-restart counter,
unchanged immutable runtime, all other initial environment values and protected team/Node-RED identity.
Public health must be 200 and anonymous exact-community access must remain 401/403.

The same process holds the release flock through at least120 seconds of server observation in either mode.
When the owner explicitly takes browser acceptance, the operation does not run a browser probe or require a
fabricated proof file. Its receipt is `SERVER_PASS`, `browserAcceptance: "OWNER_PENDING"` and a null browser-proof
hash, never full `PASS`. All runtime/config/protected-service/negative-auth/health checks and guarded recovery
remain unchanged. This is server configuration evidence, not browser, form, game or client acceptance.

In automatic browser mode, the process additionally holds the lock through the post-browser check below.
The parent reads `applied.json` to know when to use the existing Yandex HttpOnly-cookie session. Do not extract
cookies, bearer tokens, storage or passwords. Use same-origin GETs with credentials:'same-origin' to verify:

- `/api/auth/me`: the same legitimate operator, SUPER_ADMIN, settings:write and the applicable station scope;
- `/api/ui/admin`: actual server-rendered capabilities true / [EVENT];
- the exact community GET: expected target, FRIENDS/revision0, unchanged OWNER before the separate activation.

Bind the proof's body and nonce before waiting. Transfer the actual sanitized browser result only as the new
root:root0600 single-link `browser-post.json`; it must be newer than this operation's intent and match the
frozen body hash. Never compose a passing proof without those real requests. `complete.json` plus fresh parent
readback, not the apply call alone, establishes successful config activation. An operational observation
failure restores only this operation's proven-owned configuration, never business records.

## Guarded recovery and stopping

`recover STAGE/plan.json` also requires the original plan, durable intent, unchanged source/config preimages,
owned inode/body and the existing release flock. It removes only this delta, reloads systemd, restores the
prior process flag state through the same runtime, and verifies health/negative authorization/protected state.
It does not restore an old whole unit, old runtime, Mongo document, roster or game receipt. A proven atomic
final/temporary hard-link pair can be normalized only with the retained inode receipt and exact link count;
external aliases or changed bytes require reconciliation rather than deletion.

Stop on foreign drift, failed recovery, unexpected startup behavior, lost lock, new automatic restarts,
auth/health failure or any protected-service change. Preserve the failed attempt and receipts. Never blindly
retry, shorten another owner's lock/lease, clear restart counters, or manufacture browser/CI evidence.

## Separate canonical activation and game release

After config success, use authenticated fresh CUP GET → one exact-target PATCH → fresh GET. Send only EVENT,
the observed `expectedTypeSettingsRevision`, and full `typeSettings` with gameIds:[padel-jump] plus the already
approved six-field policy. No member arrays, eventEntries, caller epoch or retentionMode are PATCH fields.
Read back after an ambiguous response before retrying. Take real epoch/revision/binding from the canonical
aggregate, never from a fixture. Preserve OWNER and existing registrations.

Joining remains permanently available with mandatory private fullName/company/email and explicit
submitted-year-v1 acknowledgment; canonical retention is one calendar year from each server submission.
The separate game remains November12–13 2026 MSK. No November11 temporary opening follows automatically.
Exhibition5194/static/client composition/nginx and actual phone/replay/durable-board acceptance remain separate
release boundaries. Team5193 is never restarted or rebound by this procedure.
