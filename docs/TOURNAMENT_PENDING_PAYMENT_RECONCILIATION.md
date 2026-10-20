# Tournament pending-payment reconciliation

This is a mandatory pre-deploy gate before enforcing the new bound tournament payment lifecycle.
The command is dry-run by default and never calls Viva or changes MongoDB.
`TOURNAMENTS_MONGODB_DB` is now mandatory: there is no implicit `ph_admin` or
generic `MONGODB_DB` fallback in this recovery command. Before running, independently
verify that the explicit database, URI and collection match the admitted runtime.
The report echoes only database/collection names, never the URI or credentials.

## Runtime payment acknowledgment policy

`TournamentsPersistenceService` explicitly configures its Mongo client with
`w: 'majority'`, `j: true` and `wtimeoutMS: 5000`. This applies to its
`custom_tournaments` mutations, including local attempt reservation, the provider
POST claim, provider identity/binding, paid evidence and participant finalization.
The client options override an omitted or weaker URI write concern; this path no
longer depends on administrative access to inspect the cluster's defaults.

The timeout bounds the server's replication-acknowledgment wait, not the whole
request or network round trip. It does not cancel or roll back an applied write.
A write-concern error must propagate rather than become a successful prerequisite
for a provider POST. An ambiguously recorded claim remains unknown and must not
permit a new attempt or another POST. An unclaimed saved local attempt can resume
only through the existing atomic claim, retaining its original local ID.

LOCAL/CI evidence uses the real Mongo driver to check URI-option precedence and
observes actual application wire commands against the owned replica-set fixture.
The service regression injects write-concern failures around persistence steps;
the physical test also injects a lost acknowledgment after a real persisted claim.
Those injected errors are not a multi-node quorum-outage or production failover
rehearsal. Deployment must still bind the admitted source/artifact and runtime,
verify target/index readiness and retain the compatible payment lifecycle.

This runtime client policy does not attest the server's global defaults or other
Mongo clients. The reconciliation CLI has its own client: any later live `--apply`
still requires separate write-durability admission, an approved plan and verified
readback. This change does not authorize or perform legacy-payment repairs.

## Reconciliation command

```bash
npm run tournaments:pending-payments:reconcile
```

The report lists only masked phones, hashed transaction identifiers and a fingerprint of each
pre-correction pending record. Every row must be verified against the exact Viva transaction before
an apply decision is prepared:

- `PROVIDER_CREATE_PENDING` means the local attempt was saved but no provider POST claim was
  durably recorded; the normal request path may claim and continue this exact attempt once.
- `PROVIDER_RESULT_UNKNOWN` means a provider POST may have happened. Never repeat the POST. If a
  `providerTransactionId` was captured, reconcile that exact transaction; otherwise use an
  authoritative Viva search approved for the incident or leave the attempt unresolved.
- Viva transaction-create non-2xx responses are `UNKNOWN` unless a provider contract proves that a
  specific machine-readable rejection means no transaction was created. HTTP status alone is not
  retry-safe and must not release the attempt for a new POST.
- A decision for `PROVIDER_RESULT_UNKNOWN` must include the exact local `transactionId`,
  `currentState`, stored `providerTransactionId`, phone and record fingerprint. `PROVIDER_BOUND`
  requires a complete still-payable provider result; `PAID_BOUND` requires exact paid evidence
  whose `operationId` equals the separate `providerTransactionId`. Attempts without a captured
  provider identity cannot be applied by this tool and remain unresolved.

- `PAID_BOUND` requires a complete replacement with tournament/exercise/studio/widget/product,
  amount/currency, eligibility snapshot, and exact `verifiedPayment` evidence.

Apply is a separate destructive data gate and requires an explicit JSON decisions file:

```bash
npm run tournaments:pending-payments:reconcile -- \
  --decisions /absolute/path/reviewed-decisions.json \
  --apply
```

The script validates the entire plan before writing and each decision again on apply.
It checks the approved element fingerprint, rejects duplicate matching elements,
and atomically matches the document ID plus the complete pending-array preimage.
Concurrent field edits, sibling insertion/removal or reordering cause a CAS failure;
their state is not overwritten. A stopped batch may have applied earlier decisions:
retain its plan and reconcile readback before preparing a new one; it is not an
all-or-nothing batch transaction.
It stops on a changed or already reconciled record. It does not infer paid state, delete
records, or release a potentially paid seat.
`BOOKING_CREATION_IN_PROGRESS` is a valid capacity-holding subscription recovery state. Resolve it
only from exact Viva booking evidence; neither this tool nor an automatic retry replays the provider write.
The same fail-closed rule applies to `PROVIDER_RESULT_UNKNOWN`: it continues to reserve capacity until
authoritative provider evidence resolves the attempt.
`UNPAID` is not treated as terminal: without a proven provider terminal-state contract, neither the
request path nor this tool expires the attempt or permits a replacement provider POST.

Once provisioned and physically verified, the sparse unique index
`tournament_pending_provider_transaction_uq` is intended to reject duplicate
`providerTransactionId` values across tournament documents. Production application startup is
verify-only for Mongo indexes: provision and duplicate-check this index through a separately
authorized operator step before deploying this code. Before approval, run the replica-set test that
covers duplicate rejection and mixed array elements. Sparse indexing is required here so unresolved
array elements without a provider identity do not produce a conflicting `null` key. This PR does
not create or change any live Mongo index.
## Report interpretation and unresolved active records

The report now inventories every retained pending entry, including active states,
terminal entries still retained in the array, malformed records and non-array
pending storage. `count` is the number of reported rows, not a deployment gate or
a number of payable/retryable transactions. `readyForDeployment` is always false:
even an empty report cannot attest target identity, indexes, durability or acceptance.

`ACTIVE_PAYMENT_BINDING_INCOMPLETE` means that a `PENDING_PAYMENT` entry lacks
binding fields required for review. It is visible but deliberately not accepted by
`--apply`: capture its exact protected preimage and independently attribute provider
evidence, then prepare a separately reviewed record-specific repair. Without that
evidence leave it explicitly unresolved and holding capacity. Never convert it to
FAILED/EXPIRED or issue a replacement POST merely to clear the report. This command
does not provide a generic malformed-active-state repair or an operator UI.

After any apply, rerun dry-run and verify each approved transition and unchanged
unresolved attempt; finalize paid replacements through the normal idempotent path.
An owner must review the retained active/recovery queue independently of installation.
Use `reasonCode`, `state`, masked phone and hashed local/provider IDs to triage;
protected raw identifiers must come from authorized readback, not a public report.

LOCAL/CI regression includes target refusal before connection, malformed-active
reporting, successful physical Mongo apply, replay rejection, concurrent nested-field
change, concurrent sibling insertion and duplicate-element rejection. Run the physical
test only against an explicitly owned disposable replica set via
`RECONCILIATION_MONGODB_TEST_URI`; it creates and drops a randomly named synthetic DB.
Live inspection, index provisioning, actual repair and provider evidence remain
separate operational actions. These tests do not establish them.
