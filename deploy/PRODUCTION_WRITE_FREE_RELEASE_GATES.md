# Production write-free release gates

These gates apply to a systemd release switch or rollback that claims a
write-free startup and browser-smoke window. A source commit, CI result, local
test, or loopback health check does not establish that claim on its own.

## Runtime gate

Before the first server-side release write, read the effective values from both
the protected env file and the currently running process. The candidate unit
must produce the same values after restart.

- `NODE_ENV=production` after trim/case normalization.
- `QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED=false`.
- `SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS=0`.
- `PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED=false`.
- `SUBSCRIPTIONS_ACTIVATION_DEADLINE_WORKER_ENABLED=false`.
- `TOURNAMENTS_VIVA_STATUS_SYNC_RUN_ON_STARTUP=false`.
- `TOURNAMENTS_VIVA_STATUS_SYNC_INTERVAL_MS=0` for an unbounded window; a
  non-zero value is acceptable only when the verified window ends before the
  first interval.
- `VIVA_TOURNAMENT_SNAPSHOT_ENABLED=false`.
- `VIVA_TOURNAMENT_SNAPSHOT_PUBLIC_REVALIDATION_ENABLED=false`.
- `VIVA_REFERENCE_CACHE_ENABLED=false`.

Strict zero-write evidence also requires controlled ingress. Unrelated user,
webhook, queue, or scheduled traffic must be drained, blocked, or explicitly
excluded from the measured invariant. Disable WebPush and direct connector
delivery as defense in depth when the smoke does not need them.

## Immutable candidate and rollback

Freeze the source SHA/tree, build command, archive, manifest, runtime inventory,
unit file, env file, deployment script, and smoke-marker schemas by SHA-256.
Reject symlinks, special files, unexpected ownership/modes/link counts, archive
path traversal, extra roots, and any mismatch between archive and manifest.

The rollback target must be a separately attested, complete, write-safe runtime
artifact. Restoring only the old unit bytes is insufficient. Before switching,
verify every rollback runtime file against its manifest and confirm that its
startup obeys the runtime gate above. If the old artifact can seed, reconcile,
or call a provider during restart, rollback is blocked until a write-safe
rollback artifact exists or that exact mutation boundary receives separate
approval.

Publish candidate and rollback trees durably: fsync every created regular file,
then each directory from the artifact root through the release parent. Copy and
fsync the candidate unit to a no-clobber temporary path, atomically rename it,
and fsync the systemd directory. A stable exclusive lock must cover preparation,
switch, smoke, and rollback.

Every failure after the unit switch must enter the rollback trap. Rollback must
restore and verify the full artifact and unit identity, reload systemd, restart,
wait for running state, and pass both loopback and public health/admin/bundle
checks. A loopback-only recovery is not a successful rollback.

## Pre-smoke and post-smoke custody

The pre-smoke marker is a hard prerequisite before candidate transfer or any
other server-side release write. The post-smoke marker is required after the
candidate is running. Each marker must bind:

- phase (`pre` or `post`), candidate SHA/tree, deployment-plan SHA, and script
  SHA;
- a unique unpredictable nonce and the exact tested URLs/status expectations;
- the authenticated test subject or session identifier without storing a
  credential;
- browser timestamp and result; and
- the expected marker-body SHA-256 frozen before the wait starts.

For each marker, prove absence before waiting, then require a fresh regular
non-symlink file owned by `root:root`, mode `0600`, link count one, mtime newer
than the wait epoch, and the exact expected hash. Independently correlate every
nonce request and response status in nginx access logs after that epoch. A
manually composed assertion without request-level correlation is not PASS.

The smoke itself is read-only: use GET health/admin/bundle endpoints, an existing
authenticated session, and `GET /api/auth/me`. Do not use `POST /api/auth/login`,
because login success and failure are audited to MongoDB. Do not request a Viva
refresh or another action that can persist state or call a provider.

Capture Mongo collection counters/fingerprints and provider/outbound-call
counters before and after both phases. The release is write-free only when all
in-scope deltas are zero and the exact candidate/rollback identities remain
unchanged.

## Opt-in maintenance bootstrap (preparation, not deployment admission)

`PHAB_RELEASE_MAINTENANCE_ENABLED=true` selects a minimal startup graph instead
of `AppModule`: the existing auth and client-script modules, system/UI
controllers and roles guard. Business, provider and background-worker modules
are not instantiated. The selector defaults to `false`; any other value than
trimmed/case-normalized `true` or `false` fails startup. This is a process-start
setting, not a request/header toggle.

Maintenance requires all ten runtime-gate values above explicitly, including
`TOURNAMENTS_VIVA_STATUS_SYNC_INTERVAL_MS=0`. Before listening, bootstrap awaits
auth persistence readiness and the Nest lifecycle, and requires persistent
auth, enforced staff tokens and a configured non-default admin signing secret.
Auth persistence shares one initialization between readiness and the lifecycle
hook. Production index checks remain read-only; users/roles are not seeded.
This introduces no credential, role, index or database-configuration change.

The fence runs before body parsing, CORS, guards and controllers. Only exact
GET/HEAD paths are admitted:

- `/api/health`
- `/api/auth/me`
- `/api/ui/admin`
- `/api/client-script/admin-panel.js`
- `/api/client-script/gift-certificates-admin.js`
- `/api/client-script/referral-links-admin.js`

Other requests receive HTTP503 with `code=RELEASE_MAINTENANCE`, no-store and
correlation/release-mode headers. This includes login/logout, OPTIONS,
callbacks, queue pulls and the **mutating GET** tournament payment return
(`paymentsuccess=true`). The admin shell may load while its business requests
are unavailable; this is degraded containment, not normal product acceptance.
No successful callback acknowledgment or upstream retry is manufactured.

**Do not activate this profile until callback/in-flight custody is admitted.**
An outbound support/Telegram outbox is not an inbound retry queue. Where a
bridge acknowledges upstream before CUP accepts the event, rejecting that
event can lose delivery. A disk Node-RED snapshot or an anonymous GET `/flows`
returning401 does not attest the deployed graph or a drain. Require exact
active ingress/ack/retry evidence and an approved loss-safe transition. Do not
invent an inbox, replay provider writes or change Node-RED/routing to bypass
this gate.

The profile alone is not a switch/recovery executor, an attested rollback
artifact, Node executable custody, pre/post smoke evidence or zero-write
production proof. All preceding gates still apply. In particular, do not
restart the legacy tournament payment writer after newer attempt states have
been written; a read-only recovery runtime must itself be fully admitted.

Flag owner/purpose: CUP release owner (Alexey), bounded R1 deployment/recovery
containment. Activation requires the admitted maintenance window; deactivation
requires callback/in-flight recovery, post-smoke and explicit reopening
admission. No automatic reopening. Review/remove after R1 production acceptance
before reuse for another release. With the selector absent/false, the normal
application graph, parsers, prefix, CORS, validation and listen settings remain
selected.
