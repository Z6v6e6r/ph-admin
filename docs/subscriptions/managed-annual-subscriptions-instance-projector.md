# Annual subscription instance-projector checkpoint contract

Status: **CONTRACT ONLY / FLAGS OFF / NO WRITER / NO PRODUCTION GO**.

This expands the persisted read contract for an authoritative Viva annual-subscription
instance-projector checkpoint. It does not add a Viva adapter, poller, worker, route,
writer, compare-and-swap operation, or sale-readiness state transition. In particular,
it cannot cause `ready: true`.

The collection is `subscription_instance_projector_checkpoints`. A checkpoint is bound
to the exact tenant, Viva product and `TENANT`, `STATION`, or `STATION_SET` scope, and
pins mapping revision, publication/version/digest, runtime compatibility, producer
contract, coverage, reconciliation, failure, lease and document revision. `STUDIO` is
invalid. The validator accepts only the declared shapes and hashes; it stores no raw
provider payload or client identity fields.

`CURRENT` requires a completed reconciliation, no failure, no lease and zero failures.
`FAILED` requires a failure record. Coverage cannot be later than reconciliation
completion, reconciliation counters cannot be negative or exceed its source count, and
all timestamps are ordered. A checkpoint is evidence storage, not proof that the Viva
source is authoritative or fresh enough for sales.

## Flags and lazy verification

Both flags are default-off:

```dotenv
SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED=false
SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED=false
```

The checkpoint read requires runtime contracts and then projector contracts. Enabling
the projector flag while runtime contracts remain disabled is a configuration error.
Existing runtime deployments do not verify checkpoint indexes unless both flags are
enabled. Index verification happens when the repository establishes its normal
connection; it is not a startup health, provider, or production readiness proof.

The expand-only index plan currently contains only unique checkpoint ID and exact
tenant/provider/product/scope identity indexes. Applying it is a separately approved
Mongo operation: it requires `SUBSCRIPTIONS_INDEX_APPLY=CONFIRM`, expected database,
credential-free target fingerprint, writable-primary confirmation, duplicate preflight,
and exact existing-index matching. Rollback retains the collection and indexes.

## Remaining blockers

There is no approved Viva client-subscription list/change-feed contract, authoritative
source HAR/evidence, or verified release-program and phase binding. Those are required
before any writer, checkpoint freshness policy, monitoring query, sale-readiness
integration, staging exercise, or future `ready: true` proposal.
