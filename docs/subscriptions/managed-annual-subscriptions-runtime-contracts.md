# Managed subscriptions runtime contracts — checkpoint 1

Status: **PERSISTENCE CONTRACTS ONLY / NO PROVIDER WRITES**.

This checkpoint introduces the stored shapes, validators, repository boundary,
RBAC permission and reviewed index plan required by the future managed annual
subscription runtime. It does not publish a policy, create an instance, reserve
an entitlement, call Viva, charge/refund money or expose a new HTTP route.

## Feature boundary

The new collections and startup index checks are disabled by default. They are
included only when:

```text
SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED=true
```

The flag is not a runtime-sales flag. When disabled, every new repository
read/write fails closed and startup ignores the new collections. Enabling it
activates index ensure/verification and permits internal persistence access,
but still exposes no service/controller command.

## Collections

### `subscription_canonical_target_snapshots`

Immutable, PII-free target/price/dictionary projections consumed by the trusted shadow resolver.
The unique identity is tenant + target + action + revision. A row contains the canonical station,
event/product type, duration, start time, RUB base price and separate target/price evidence
references. Action/category mismatches, missing add-on product type, stale/expired rows and revoked
rows fail closed. This checkpoint exposes read access only; it does not add an ingestion route or
pretend that a provider payload is canonical.

An operator-only synthetic producer can insert strict `synthetic:` fixtures into an explicitly
guarded DEV/TEST database after the reviewed indexes exist. It has no HTTP route, requires gap-free
revisions and makes a REVOKED revision terminal. Its write and index paths require a loopback-only
dedicated Gate D database plus an exact, credential-free host/port/database fingerprint; current
DEV and production databases are rejected before connect. The resolver accepts only the latest
revision, so an older ACTIVE row cannot bypass a later revocation. This fixture path is not
provider evidence.

### `subscription_provider_mappings`

Reviewed identity mapping between a CUP subscription type and one provider
catalogue product in an exact tenant/studio/station/station-set scope. A station-set scope is
content-addressed from sorted unique station IDs, so reordering cannot create a second identity.
`VERIFIED` requires
evidence reference, verifier and timestamp. `clientSubscriptionId` is not part
of this document.

### `subscription_policy_publications`

Immutable publication envelope containing the policy digest, exact compiled
runtime projection, verified mapping reference, dictionary revision, impact
preview and approval audit references. The projection type/version/effective
date must match the envelope.

### `subscription_instances`

One local client-owned subscription pinned to policy version/digest and the
exact provider client plus `clientSubscriptionId`. An `ACTIVE` instance is
invalid without both payment and provider-instance evidence.
Cancellation/refund before activation use separate terminal states: they
require payment plus refund/cancellation read-back evidence but forbid an
active date range and do not pretend provider activation occurred.

### `subscription_entitlement_aggregates`

One future concurrency boundary per instance. It contains all active, daily,
weekly, monthly and future counters plus current reservations and a revision.
Checkpoint 1 validates the shape only; the atomic reservation transaction/CAS
is implemented in a later checkpoint.

### `subscription_operations`

Idempotent Saga metadata with tenant/actor/kind/key uniqueness, immutable
decision snapshot, provider evidence references, retry and reconciliation
state. Raw request bodies, authorization headers and payment instruments are
not stored. Client actor IDs in operations/ledger are required to be 64-character
hashes; raw provider client IDs remain confined to the access-controlled
instance mapping where reconciliation needs them.
Purchase operations use a dedicated decision snapshot containing the release
program/phase, verified mapping/product, station, quantity and quoted price;
they cannot be encoded as an add-on product benefit.
Their instance reference may be null while payment/activation is pending, but
is mandatory once the purchase operation is confirmed or compensated. Every
non-purchase operation is instance-owned from creation.

### `subscription_usage_ledger`

Append-only business events with unique `eventId` and a repository-verified
SHA-256 over the canonical event payload. Reusing an event ID with changed
content is an idempotency conflict even when a caller reuses the old hash.
Provider-confirmed payment/refund/booking/attendance/no-show events require an
evidence reference.
Only reservation/failure/expiry and quote events may be operation-owned before
an instance exists. `PURCHASE_PAID` and every entitlement/booking/attendance
event require an instance reference.

### `subscription_outbox`

PII-free delivery pointer for one ledger event. It contains no arbitrary
payload: only ledger/instance references, topic, attempts and delivery state.

Ledger and outbox have no standalone insert methods. The repository exposes one
combined append operation and writes both documents in one MongoDB transaction.
Entitlement mutation is still absent: a later checkpoint must add revision-CAS
before any operational Saga can reserve counters.

Before enabling operational writes, the approved MongoDB topology must support
multi-document transactions and pass a real transaction rollback/replay test.
Checkpoint 1 does not enable the append method from any service or route.

## RBAC

The existing subscription permissions remain separate for catalogue, release,
instances, financial operations, analytics and PII export. Checkpoint 1 adds:

```text
subscriptions:publication:write
```

Only `SUPER_ADMIN` receives it through the existing wildcard. No default staff
role is broadened.

## Index rollout

MongoDB has no executable migration framework in this repository. Index
rollout therefore remains an explicit guarded operation.

Forward procedure for a later approved environment:

1. deploy compatible code with `SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED` off;
2. take the environment-approved backup/snapshot;
3. enable the flag only for the index audit process and run
   `npm run subscriptions:indexes:check`;
4. inspect missing/drifted indexes and duplicate-preflight scope;
5. after separate data-mutation approval, set
   `SUBSCRIPTIONS_INDEX_APPLY=CONFIRM` and run
   `npm run subscriptions:indexes:apply`;
6. rerun the read-only check;
7. enable the flag for the application only after every expected index matches.

The canonical target collection adds three reviewed indexes: unique snapshot id, unique
tenant/target/action/revision, and the active revision lookup. They are included in the same guarded
runtime plan and are never auto-created by application startup.

Application startup is verify-only for these runtime indexes even when ordinary
development index auto-creation is enabled. It cannot bypass the guarded apply
script or its duplicate preflight.

The apply script performs duplicate preflight for every unique index before
creating any index. A duplicate aborts the operation with
`DUPLICATE_PRECHECK_FAILED`.

Recovery:

- keep compatible code and leave the flag off if apply is not completed;
- do not drop successfully created indexes during ordinary application
  rollback because unused indexes are data-compatible;
- an index drop requires a separate reviewed plan with exact names and
  production approval;
- no document backfill is part of this checkpoint.

## Compatibility

- Existing DRAFT policies, release programmes and fake test runtime collections
  are unchanged.
- Existing startup behavior is unchanged while the new flag is absent/false.
- The persistence checkpoint itself changes no public DTO or client SDK. The
  later publication candidate adds two authenticated admin routes behind
  separate default-off flags.
- The publication candidate reuses only the exact-ID, read-only Viva evidence
  adapter; it adds no provider mutation endpoint.
- The publication candidate proves that the inserted mapping is `VERIFIED`,
  the policy is the exact `PUBLISHED` version/digest, and every enabled benefit
  contains canonical station/event/product selectors before inserting the
  immutable envelope.
- Old and new application versions can coexist because no runtime document is
  created and new index checks are opt-in.

## Shadow quote checkpoint

The internal, default-off candidate is specified in
`managed-annual-subscriptions-shadow-quote.md`. It reads a verified mapping,
publication, instance and aggregate, remains non-binding and does not reserve
counters or call a provider mutation endpoint. It intentionally has no HTTP
route until authoritative LK identity and server target resolvers are ready.

The next gate is that authenticated shadow-only adapter; atomic reservation and
provider confirmation remain separate later checkpoints.

The isolated first-publication candidate is documented in
`managed-annual-subscriptions-publication-command.md`. It preserves the runtime
validators and unique indexes, is disabled by separate preview/command flags,
and creates no production document until an explicitly approved command is
released and invoked.
