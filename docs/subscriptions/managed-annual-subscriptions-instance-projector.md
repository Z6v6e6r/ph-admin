# Annual subscription instance projector

Status: **SOURCE ONLY / CHECK ONLY / FLAGS OFF / NO WRITER / NO PRODUCTION GO**.

This slice adds a dormant importer for an approved, normalized full snapshot of Viva
annual-subscription instances. It does not fetch Viva, infer provider states, run on a
schedule, register an HTTP route, or enable any shared runtime. The input file is a
separately reviewed evidence artifact; source availability and production authority are
still external release gates.

## Safety model

Only `REVIEWED_NORMALIZED_PROVIDER_INSTANCE_SNAPSHOT` version 1 is accepted. The
manifest and every record have exact shapes, unknown fields are rejected, the snapshot
contains 1-500 unique provider/client-subscription identities, and all evidence fields
are digest-only references. The private input file must be an absolute, non-symlink,
regular file no larger than 1 MiB, owned by the executing user, with no group/other
permissions.

The deterministic plan pins:

- tenant, Viva product and exact `TENANT`, `STATION`, or `STATION_SET` scope;
- verified mapping ID and revision;
- schema-v3 publication ID/version/digest and runtime compatibility;
- release program, release phase and exact purchase price;
- producer/source capability digests, snapshot digest, coverage and result evidence;
- HMAC-derived instance IDs and `clientRefHash` values using the runtime pepper.

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
digests. An uncheckpointed existing row or changed checkpoint fails closed.

## Write boundary blocked

There is deliberately no CLI/package `apply` command and no service writer. A safe
writer requires a shared CAS/lease fence touched by both subscription publication and
the projector; snapshot reads alone cannot prevent a concurrent publication from
committing a stale immutable initial import. Replica-set race tests and a rollback or
repair path are also required before exposing any writer.

All reader flags remain off by default:

```dotenv
SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED=false
SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED=false
SUBSCRIPTIONS_INSTANCE_PROJECTOR_READINESS_ENABLED=false
```

The input SHA-256, plan SHA-256, approval reference, tenant, provider product, scope
kind/id, expected database and credential-free Mongo target fingerprint must all be
pinned even for `check`. Automatic index creation must be explicitly false. Index
application, manifest approval, any future writer, environment provisioning and
execution are separate live gates.

Sale readiness may report `instanceProjector.status: CURRENT` only for a fresh,
fully-accounted checkpoint whose mapping revision, publication binding, policy digest
and runtime compatibility still match. This source path is also default-off and is not
deployment or provider-readiness evidence.

## Remaining blockers

There is still no approved Viva client-subscription list/change-feed contract,
authoritative pagination/snapshot-completeness proof, status-transition mapping,
price/payment/activation evidence contract, timezone/range contract, or production
manifest. Those inputs and a separate exact authorization packet are required before
implementing the publication/projector fence, any production import, runtime flag
change, sale-readiness activation or LK enforcement rollout.
