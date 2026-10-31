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

### `subscription_projection_fences`

One unique coordination document per subscription type. Its binding revision/digest pins the
current verified mapping and schema-v3 publication. Publication advances it in the same Mongo
transaction as mapping, policy, publication and type state. The instance projector must CAS the
same document in its import transaction, so a stale import cannot commit after a newer publication
binding. If the import commits first, MongoDB may safely serialize or retry publication against the
reconciled fence. The last projector reconciliation is digest-only; no provider/client identity is
stored in the fence.

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

This order assumes the target application currently has runtime contracts disabled. If an
environment already runs with `SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED=true`, deploying code that
requires `subscription_projection_fences` before its indexes exist is **NO-GO**: take the approved
backup, apply and verify the immutable target's guarded fence indexes first, then deploy compatible
code. Fresh target inventory and separate live mutation/deploy approvals are still required.

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
- Old and new application versions may coexist only while
  `SUBSCRIPTIONS_PUBLICATION_COMMAND_ENABLED=false` is applied to every writer. An old
  publication writer does not advance `subscription_projection_fences`; publication writes
  must therefore be quiesced before the first mixed-version deployment and remain off until
  every writer is fence-aware. The flag must not be enabled on only a subset of nodes.

Rollback has the same boundary. If any fence-aware publication or projector transaction has
committed, rolling back application code does not authorize old publication writers. Keep the
publication command off, retain the indexes/documents, and run an exact read-only consistency
audit that proves each fence matches its current mapping, publication and runtime compatibility
binding before re-enable. No generic production audit or fence-repair command is exposed by this
checkpoint, so its absence is **NO-GO** for such a rollback/re-enable. Any mismatch requires a
separately reviewed forward-fix/reconciliation plan, exact target and backup, data-mutation
authorization, and post-write read-back; do not delete or rewrite a fence manually.

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


## Organizer-quarter CREATE provenance bridge (source-only, v2 intake)

This bounded extension prepares a canonical target for the organizer's **one of four**
places in a 60-minute game. It does not create a game, reserve a provider booking, publish
an existing policy or activate a runtime. Existing JOIN and legacy CREATE requests and
idempotent decisions are unchanged. No generic discount evaluator or new flag is added.

Publication may explicitly include `createQuarterDescriptor` schema 1, kind
`ORGANIZER_QUARTER_CREATE`. Its exact fields are direction `4588`, type `1613`,
selector revision, duration 60, participant count 4, spot 1, RUB, price basis
`ORGANIZER_QUARTER`, benefit `FREE_ENTITLEMENT`, usage units 1, daily limit 1, and
1–8 unique approved station/service rows. Each row explicitly binds **canonical
stationId to providerStudioId**, masterServiceId and subServiceId; matching strings or
aliases are not mapping evidence. The existing policy CREATE rule and station scope
must admit exactly this FREE/60-minute/one-unit slice without surcharge. Direction 4588
is not a station ID. A descriptor is an operator-approved mapping, not a live catalogue
observation and not a claim that all eight LK source mappings have been approved.

CUP normalizes descriptor keys/rows and hashes the content with domain
`subscription-create-quarter-descriptor:v1\0`. Both
`dictionary:create-quarter:<digest>` and `evidence:canonical-dictionary:<digest>` must
match the supplied descriptor. Preview and publish bind its bytes and digest in the
impact reference, request fingerprint, immutable opt-in schema-4 publication and existing
approval audit (`createQuarterDescriptorJson`, `createQuarterDescriptorDigest`). The
existing permission, command gates, provider product verification, approval-before-write
and publication CAS remain required. Publications without the descriptor are **not**
quarter capable, even when their revision text happens to match. Omission preserves
legacy schema-3 publication/request bytes; null and malformed descriptors fail closed.

The existing authenticated `POST /api/internal/subscriptions/canonical-targets` accepts a
strict v2 union: `contractVersion:2`, `kind:ORGANIZER_QUARTER_CREATE`, targetId, revision,
state, subscriptionTypeId, policyVersion, publicationId, createOperationId, draftId,
clientRefHash, stationId, roomId, startsAt, observedAt, expiresAt, catalogue and price.
Operation/draft are canonical UUIDs; targetId is exactly `create-draft:<draftId>`.
clientRefHash is the **existing CUP identity hash**, never a raw provider ID or phone.
The future LK producer must obtain/bind that existing identity contract; it must not
invent a hash algorithm, expose private references publicly or treat an unsigned LK
preparation capsule as authenticated authority.

Catalogue contains directionId, typeId, providerStudioId, masterServiceId, subServiceId,
selectorRevision and roomIds (null means provider catalogue omitted that restriction).
Price contains basis `WHOLE_COURT_WINDOW`, amountMinor, RUB, durationMinutes 60,
participantCount 4 and spot 1. CUP checks the exact approved mapping and accepts only a
positive integer whole amount <=10,000,000 divisible by four. CUP computes the quarter
**once**, persists it as basePriceMinor and retains the whole amount and original facts.
Caller-supplied basePriceMinor, quarter price or dictionary revision is forbidden in v2.
Authenticated producer observations are trusted transport input, not independently
fetched by this CUP endpoint. Freshness uses the existing configured shadow-quote limit;
observation cannot be future and expiry must be within 60 seconds of that original
observation. An immutable revision cannot be reused with changed facts or timestamps.

Schema-2 targets retain publication/policy/approval references, descriptor digest,
original operation/draft/actor, exact catalogue facts and whole-price evidence in the
existing target collection. Intake uses VERIFY_ONLY connection initialization, so it
never creates indexes. Resolver rechecks exact publication and tenant-owned VERIFIED
product mapping. Quote additionally compares the instance-pinned publication and the
verified actor hash; a target cannot be borrowed by another actor. FREE then applies to
this quarter base, not the whole court and not a second fractional calculation. Actual
eligible results must have FREE, final price zero, usage one and active daily limit one.
Daily exhaustion and fallback cannot authorize this new branch.

Existing entitlement preflight accepts CREATE only with `contractVersion:2` and an
already stored quarter target. Its existing nonbinding response adds `expectations.createQuarter`
containing schemaVersion 1, createOperationId, draftId, clientRefHash, publicationId and
descriptorDigest. Those original bindings enter the versioned reserve fingerprint; fresh
reserve rechecks them before mutations and each CAS retry. Identical committed reserve
replays use the stored decision without re-resolving a later publication or expired target.
Changed original binding with the same key conflicts. Old JOIN response fields and legacy
CREATE reserve fingerprints/replay remain unchanged. This is still not a provider receipt,
booking authorization, usageRef issued before reservation or a new validity period.

Adoption requires separate reviewed publication evidence, the LK authenticated producer,
original CREATE journal/receipt integration, all compatible readers, and explicit runtime
activation approval. None is supplied by this source change. Runtime mapping/catalogue and
provider acceptance remain unverified. On rollback retain all targets and publication/audit
facts: old readers reject schema-2 targets rather than using their quarter values as v1.
Do not strip provenance, rewrite schema versions or redate targets to force availability.
Descriptor-bearing publications require schema 4; schema 3 with a descriptor and schema 4
without it are invalid. The exact previous schema-3 validator rejects schema 4 before
reading its projection. New readers also reject a v1 CREATE target against a quarter
publication, even if its dictionary revision was copied; JOIN and descriptor-absent v1
publications retain historical behavior. This bidirectional fence prevents old binaries
from silently granting whole-court FREE after rollback. Mixed-reader availability requires
deployment validation before activation.

**Unimplemented SOURCE adoption dependency:** existing instance projector, sale readiness
and legacy binding promotion still require schema-3 publications. They intentionally remain
closed for schema 4. No normal production instance can adopt the new publication through
those paths yet. The physical test seeds a synthetic instance directly inside its owned CI
DB; that is storage/transaction evidence, not a usable adoption workflow or approval to seed
production. A separately reviewed bounded instance-adoption implementation is required;
there is no manual production override or migration in this packet.

LOCAL tests use synthetic repositories and actual service/parser/evaluator paths; they do
not prove physical Mongo transactions, publication execution, provider observations or live
CREATE acceptance. No indexes, database fixtures, migrations or provider calls are executed
by the focused new synthetic suite. The existing CI-only entitlement Mongo harness additionally
stores schema-4 publication/schema-2 target through the real repository, checks immutable
duplicate/conflict behavior, and reserves/replays after lost ACK with real Mongo transactions.
It reuses the existing unique owned DB, replica-set URI guard, index fixture and cleanup; it is
not run or provisioned locally. Its physical result remains pending until automatic CI runs.
Full automatic CI, normal instance adoption and the separate LK producer remain dependencies.
