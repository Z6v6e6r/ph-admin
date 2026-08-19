# CUP → PadlHub player level projection

The CUP rating ledger remains the authoritative source. Delivery is an asynchronous, idempotent
projection into PadlHub; a PadlHub outage must never roll back an accepted CUP rating change.

## Safety defaults

- `PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED=false` is the default.
- The worker starts only when URL, tenant key and a server-only token of at least 32 characters are
  present.
- The request contains the opaque Viva client identifier, normalized level code and numeric rating.
  It never contains a phone, name, PadlHub user UUID, cookie or browser token.
- While the flag is off, rating changes do not create this outbox, advance its revision or create
  its indexes. When enabled, each canonical rating change and its desired PadlHub snapshot are
  committed in the same MongoDB transaction. Existing states are added by the bounded reconcile
  scan.
- One coalescing outbox record per player keeps a delivered revision and a leased in-flight
  snapshot. A newer rating cannot be acknowledged by an older request.

## Configuration

```text
PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED=false
PADLHUB_PLAYER_LEVEL_PROJECTION_URL=https://internal.padlhub.example
PADLHUB_PLAYER_LEVEL_PROJECTION_TENANT_KEY=local-padel
PADLHUB_PLAYER_LEVEL_PROJECTION_TOKEN=<server-only secret>
PADLHUB_PLAYER_LEVEL_PROJECTION_POLL_MS=5000
PADLHUB_PLAYER_LEVEL_PROJECTION_TIMEOUT_MS=5000
PADLHUB_PLAYER_LEVEL_PROJECTION_BATCH_SIZE=20
PADLHUB_PLAYER_LEVEL_PROJECTION_LEASE_MS=30000
PADLHUB_PLAYER_LEVEL_PROJECTION_CIRCUIT_FAILURE_THRESHOLD=5
PADLHUB_PLAYER_LEVEL_PROJECTION_CIRCUIT_RESET_MS=30000
```

Inject the token through the server runtime environment. Never place it in frontend configuration,
Node-RED browser responses or logs. The receiver token is additionally bound to the exact configured
tenant key; one token must not be reused for multiple tenants.

## MongoDB preflight

With the worker flag still off, record whether `player_level_projection_outbox` exists. Enabling the
worker intentionally creates only these repeatable indexes:

- unique `{ playerKey: 1 }`;
- due-work `{ status: 1, nextAttemptAt: 1, playerKey: 1 }`.

Their stable names are `player_level_projection_player_uq` and
`player_level_projection_pending`. Runtime index checks must always pass the reviewed explicit
name: production rating collections use managed names, and asking MongoDB to recreate the same key
and options under an auto-generated name fails with `IndexOptionsConflict`. For compatibility with
older development databases, an already existing index is accepted by key and significant options
(`unique` and partial filter) regardless of its name; incompatible options remain a startup error.

After the first staging start, verify both index definitions and rerun the check after one restart to
prove repeatability. If the collection already exists, first aggregate duplicate `playerKey` values
and validate the required outbox fields/statuses; do not enable the worker or create the unique index
until both checks are clean. The collection is a coalescing full-snapshot outbox: its update pipeline
accepts only a strictly newer desired revision, so a stale reconcile scan cannot overwrite a
concurrent transactional rating change. A newer desired revision resets its attempt budget, while
completion or failure of an older leased snapshot cannot mark that newer revision synced or dead.
After 20 failed deliveries the row becomes `DEAD`; a `SUPER_ADMIN`
may explicitly reset it through `POST /admin/player-ratings/:playerKey/padlhub-projection/retry`
after the dependency or mapping is repaired.

The sender requires HTTPS outside explicit loopback development, refuses redirects, opens a bounded
circuit after consecutive delivery failures, and emits only aggregate structured counters (attempts,
applied, replayed, failed, stale, skipped cycles and invalid canonical states).

## Staged rollout

1. Apply the PadlHub expand-only migration while both runtime flags remain off.
2. Deploy the PadlHub ingress with `CUP_PLAYER_LEVEL_PROJECTION_ENABLED=false` and verify the
   disabled `503` contract.
3. Enable ingress in staging and verify invalid token, wrong tenant, unknown mapping, replay, stale
   revision and a newer full snapshot that skips coalesced intermediate revisions.
4. Enable the CUP worker in staging. Compare anonymized counts of canonical states, outbox desired,
   delivered, retryable and PadlHub projection rows.
5. Run join/waitlist/payment tests only after the projection parity gate passes. Eligibility modes
   remain `OFF` during this rollout.

Rollback is operationally safe: turn the CUP worker off first, then turn the PadlHub ingress off.
Existing PadlHub level projections remain readable; no rating ledger event is removed or rewritten.

This stage intentionally has no deletion/invalid-state tombstone contract. Invalid canonical states
are skipped with aggregate-only warnings, without identifiers. Keep `player_projection_ready=false`
and eligibility enforcement out of `BLOCK` while any invalid state exists or deletion semantics are
unresolved; otherwise PadlHub could retain the last accepted level indefinitely.
