# Legacy MAX restart custody

This change covers only `MAX_BOT` and `MAX_ACADEMY_BOT` in legacy mode. The
receipt-v1 protocol and other connectors retain their existing paths. No new
index, dependency, release flag, HTTP import route or startup import is added.

Accepted enqueue, lease, ACK and fail wait for a majority durable write and an
exact primary/majority readback. Each lease has a unique internal claim ID;
concurrent requests cannot both return the same claim. The guarantee is per
outbox ID/transition; it is not logical-reply idempotency across fresh UUIDs.
An ambiguous write is not automatically retried by this path. Expired legacy
leases are held as existing
`FAILED` rows with private `meta.legacyMaxRestartCustody` evidence; they are not
automatically resent. An unclassified legacy failure (including `requeue=true`)
is also held: that body cannot prove a provider send failed. Ordinary ACK/fail
cannot reopen held custody. Metadata
reconciliation updates only client/dialog fields and cannot overwrite delivery
state. An HTTP acceptance receipt proves queue custody, not provider delivery.

An enqueue can persist `PENDING` and then fail its readback: that original is
retained in Mongo but never installed in the dispatchable Map. A fresh UI reply
retry can create a different outbox ID; this packet does not deduplicate that
logical action. Keep the admitted target at sync interval zero. Enabling full
sync or calling `hydrateFromPersistence` as recovery can expose the retained
original and is prohibited for this packet. Reconcile it only through the exact
approved held import below. Stable logical-reply/request identity is a separate
residual finding, not a completed guarantee of this release.

The existing staff-only `GET /api/support/debug/runtime` adds
`legacyMaxCustody.states`, `held`, `pendingWrites` and `writeFailures`. No message,
recipient, ID or credential is included. Counters are observations, not an
admission lock: the owner must close new enqueue/pull admission and finish
in-flight send/ACK work before using them as drain evidence. Persistence close
awaits tracked writes, but this does not add a graceful-shutdown contract to an
already running older process.

## Explicit recovery import

`SupportPersistenceService.importLegacyMaxCustody(bytes, manifest)` is an
unexposed source/operator API, not deployment or live-mutation authorization.
Never call it automatically on startup or replace it with full Mongo hydration.
The approved snapshot is bounded to 1–5000 commands and 32 MiB and has exact keys:

```
schema: PHAB_LEGACY_MAX_CUSTODY_SNAPSHOT_V1
capturedAt: canonical UTC timestamp
source: { pid, bootId, startTicks, sourceCommit, sourceTree, runtimeInventorySha256 }
targetFingerprint: SHA256 of { hosts, db, collection } using the verified Mongo driver
commands: exact private MAX command snapshots
```

The separately reviewed manifest has schema
`PHAB_LEGACY_MAX_CUSTODY_IMPORT_V1`, exact snapshot-byte SHA256,
`targetFingerprint` and the same complete `source` identity. Every source field
must match; PID alone is insufficient. The importer compares the actual queue
target before any write. Invalid bodies/duplicates/receipt-v1 markers fail
closed. Raw artifacts remain private, outside Git and logs. Partial import is
resumed only with the identical approved snapshot; conflicting bytes are not
silently replaced.

Import never produces a send ACK: an already durable `SENT` remains `SENT`;
otherwise the row is held. Both snapshot and durable status/lease/attempt
evidence are retained in the private marker, including a snapshot `SENT` that
disagrees with Mongo. Imported rows are not made dispatchable or loaded into
the live Map. Reconciliation/reopening is a separate approved operation. Once
held custody exists, do not revert to an older writer that does not enforce
these barriers.

## First-restart boundary

The old process with sync interval zero cannot expose Map status counts or
pending-write completion through its existing diagnostics. Installing this
change by restarting that process first does not recover its Map. The owner
must separately provide and review a cooperative old-runtime export/drain
bridge, bind boot/start/source/runtime/target identity, and retain the original
process until durable custody is verified.
The bridge inventory must cover both the old Map and independently observed
durable-only unknown Mongo records. A Map export cannot capture an original
enqueue that never entered the Map; `pendingWrites=0` alone is not drain proof.
`outbox/pull` is a mutating lease/attempt operation, hides active leases and can
sweep attempt limits; it is
neither a read-only exporter nor a complete handoff proof. Do not use heap or
credential bypass, invent `ACK=SENT`, replay uncertain sends, or infer a drain
from historical Mongo counts. This source change alone does not authorize or
prove that first production restart.

## Recovery artifact for the installed83 runtime

`scripts/prepare-cup-runtime-release.mjs` also builds a distinct recovery overlay
from `83b1c17bc4c5edaec65387b25b5695e48337c3cf` and the exact five-module
`deploy/recovery/legacy-max-custody-83.patch`. The output is
`legacy-max-recovery-manifest.json` plus `legacy-max-recovery-runtime-delta.tgz`,
covered by the artifact's `SHA256SUMS`. Its schema is
`PHAB_CUP_LEGACY_MAX_SAFE_RECOVERY_V2`. The offline preparer retains a separately pinned historical V1 profile; it cannot treat its three-module payload as V2. The earlier8a tournament-only recovery
artifact remains separate and does not establish MAX custody compatibility.

The manifest distinguishes the publishing source from the derived recovery
tree. The builder compares baseline and patched compilation, permits exactly
five executable JS changes, and requires those five JS files to equal the
candidate's compiled custody modules. Only those five modules and their own declarations/maps may
change locally; declarations/maps are not included in the executable overlay.
No dependency, SDK, configuration or other baseline runtime file is replaced.
The three existing JS files require exact previous hashes. The new
`dist/support/legacy-max-custody.js` and `dist/support/max-generation.js` each have `expectedPreviousSha256: null`, which
means **the destination must be absent**, never an unchecked replacement.

The builder tests the actual derived83 compiled modules against an owned
loopback Mongo fixture: concurrent claims, committed writes with lost ACK or
failed readback, stale metadata, held snapshot import/replay/conflict, sync0
restart and non-MAX/receipt-v1 delegation compatibility. These are LOCAL/CI
checks, not provider or production acceptance.

This overlay only establishes a recovery writer that respects custody. It
does not prove the first restart, old-writer drain, target mapping or a live
rollback. It requires legacy mode, sync interval zero and no full hydration.
An executor must explicitly support this schema, preserve the approved queue
mapping, attest the exact installed83 preimages and apply all five files as
one recovery runtime. The historical executor's receipt-v1-only index check
does not detect `meta.legacyMaxRestartCustody`; do not use that check to admit
an old writer after held import. No automatic deployment consumes this new
artifact.

The V2 recovery carries the same generation module/controller/auth/claim barriers as the candidate. Its manifest records `generationFenceSupported:true` and `generationActivationProven:false`; it does not establish live control provisioning, existing Map custody or graph acceptance. An old V1 recovery writer must not be used after generation activation.
