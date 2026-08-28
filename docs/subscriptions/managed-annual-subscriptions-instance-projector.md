# Annual subscription instance projector

Status: **SOURCE ONLY / CHECK CLI ONLY / FENCED REPOSITORY PRIMITIVE DORMANT / NO PRODUCTION GO**.

This slice defines a dormant repository import primitive for an approved, normalized full snapshot of Viva
annual-subscription instances. It does not fetch Viva, infer provider states, run on a
schedule, register an HTTP route, or enable any shared runtime. The input file is a
separately reviewed evidence artifact; source availability and production authority are
still external release gates.

## Safety model

Only `VIVA_AUTHORITATIVE_COMPLETE_SUBSCRIPTION_INSTANCE_SNAPSHOT` version 2 is accepted.
The manifest and every record have exact shapes, unknown fields are rejected, the snapshot
contains 1-500 unique provider/client-subscription identities, and all evidence fields
are digest-only references. The private input file must be an absolute, non-symlink,
regular file no larger than 1 MiB, owned by the executing user, with no group/other
permissions.

The deterministic plan pins:

- tenant, Viva product and exact `TENANT`, `STATION`, or `STATION_SET` scope;
- the current publication/projector fence ID, binding revision and binding digest;
- verified mapping ID and revision;
- schema-v3 publication ID/version/digest and runtime compatibility;
- release program, release phase and exact purchase price;
- producer/source capability digests, snapshot digest, coverage and result evidence;
- digest-only Viva endpoint/query/pagination/normalization/state/money contracts, exhaustive
  page/item counts, zero rejected rows, zero duplicate identities and completeness evidence;
- HMAC-derived instance IDs and `clientRefHash` values using the runtime pepper.

Projection row accounting is isolated by tenant, provider product and the fence-bound
`subscriptionTypeId`. This permits the mapping contract's distinct station/station-set scopes
for one Viva product without treating another scope's instances as uncheckpointed local rows.

Checkpoint schema v2 stores the fence attestation and authoritative-source digest.
`CURRENT` requires complete accounting: coverage count, reconciliation source count and
insert/update/replay/terminal counters must match exactly. A checkpoint stores no raw
provider payload, client identity or raw cursor. Ordered change-feed watermarks are
digest references only; this importer does not support incremental mode.

## Commands

```bash
npm run subscriptions:instance-projector:input-fingerprint
npm run subscriptions:instance-projector:target-fingerprint
npm run subscriptions:instance-projector:check
```

`input-fingerprint` and `target-fingerprint` do not connect to Mongo. `check` performs a
read-only, target-attested state preflight and emits only counts, deterministic IDs and
digests. It rereads the common fence after preflight and fails if publication changed
during the check. An uncheckpointed existing row or changed checkpoint fails closed.

## Shared publication/projector fence

`subscription_projection_fences` is keyed uniquely by subscription type. Publication
creates or advances its binding revision in the same transaction as mapping, publication,
policy and type changes. The dormant repository primitive reads that exact binding and performs a
coordination CAS on the same document in the same transaction as all instance inserts and
the checkpoint. A newer publication binding cannot be followed by a stale immutable
projection. If the projector commits first, MongoDB may safely serialize or retry the
publication against the newly reconciled fence. Both fenced transactions request snapshot
reads, primary routing and majority journaled writes. Exact replay requires the same
checkpoint, instances and recorded reconciliation digest, followed by an exact post-commit
read-back.

For an already-published legacy binding that predates this collection, read-only check
accepts only the deterministic revision-1 fence described by the manifest. A future
authorized runner may create that fence in the same transaction as instances and checkpoint.
It cannot silently adopt a different or partially initialized fence.

There is deliberately no apply command, service method, HTTP route or feature flag. The
repository primitive is not reachable from deployed application code and exists only for
source-level transaction and race verification. A manifest, environment variables and an
operator confirmation string cannot independently authorize a provider-derived production
write. A future executable runner therefore requires a separately reviewed trust anchor,
for example a detached signed, expiring and replay-protected authorization receipt over the
canonical manifest, plan and target fingerprint under an independently pinned signer key.
Its custody, issuance, revocation and audit procedure are outside this source checkpoint.
Update, delete and repair operations remain absent.

All reader flags remain off by default:

```dotenv
SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED=false
SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED=false
SUBSCRIPTIONS_INSTANCE_PROJECTOR_READINESS_ENABLED=false
```

The input SHA-256, plan SHA-256, approval reference, tenant, provider product, scope
kind/id, expected database and credential-free Mongo target fingerprint must all be
pinned even for `check`. Automatic index creation must be explicitly false. Index
application, manifest approval, authorization-receipt design, executable runner,
environment provisioning and execution are separate live gates. The checkpoint
`approvalRef` is durable audit metadata, not a cryptographic authorization grant.

Sale readiness may report `instanceProjector.status: CURRENT` only for a fresh,
fully-accounted checkpoint whose mapping revision, publication binding, policy digest
and runtime compatibility still match. This source path is also default-off and is not
deployment or provider-readiness evidence.

## Remaining blockers

Source now enforces an authoritative evidence contract, but no real Viva contract or
production manifest has been supplied or approved. Fresh provider inventory must still
prove the endpoint/query and pagination semantics, state and money mappings, complete
product/scope coverage, payment/activation evidence and time ranges. Before deploying this
code into an environment where runtime contracts are already enabled, the guarded fence
indexes must already exist and have passed verification; otherwise startup would fail
closed. Before any future live import, a fresh backup and an actual replica-set
rollback/race/replay rehearsal plus read-back must pass, and an independently verifiable
exact authorization receipt must name the target and pinned manifest/plan. That rehearsal
is not available in the current local environment and remains a mandatory blocker.
Runtime flags, sale-readiness activation and LK enforcement remain later independent
gates.
