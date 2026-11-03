# CUP83 diagnostic snapshot normalization

`normalizeCup83MaxSnapshot(inputs, expected)` in
`scripts/lib/cup-legacy-max-snapshot.mjs` converts the existing CUP83 diagnostic
capture into private **draft** artifacts accepted by the existing snapshot
validator. It is a pure offline function: no CLI, filesystem, environment,
application initialization, Inspector, database, provider or import call.

The caller supplies five byte buffers (`raw`, `operation`, `intent`, `captured`,
`terminal`) and a separately trusted expected context. The context contains the
SHA256 of every input, the exact eight-field diagnostic identity, the complete
six-field importer source identity, and an explicit target fingerprint. These
hashes must come from the reviewed owner capture package; hashing arbitrary
input files and calling that result trusted is not attestation. The function
does not discover a target or verify its existence, indexes or permissions.

The raw export is the exact `SYNTHETIC_MAX_MAP_EXPORT_V1` payload plus one LF.
The format name is historical; it does not classify future rows as synthetic.
The helper bound is32MiB plus that one LF. SHA precedes strict UTF-8/JSON parsing.
Export/journals must retain the operator's compact serialization; the operation
manifest may also use its existing two-space indentation. Duplicate JSON keys,
changed byte representations, identity/receipt substitutions and count mismatch
are rejected. Source is fixed to83b1c17/treecfffdce; runtime inventory digest is
bound through the trusted operation context and is not a manifest-file hash.

Every command retains payload, status, attempts, lease, targets and metadata.
The tuple key must match its unique ID. MAX connector/status and existing
importer constraints are checked. A snapshot `SENT` remains source evidence;
normalization cannot create a durable or provider ACK. The existing held
importer separately decides how to preserve it.

`performance.timeOrigin` (`identity.start`) is checked as part of the capture
identity, and is never substituted for Linux `processStartTicks`. Raw export
has no capture timestamp: `capturedAt` uses the bound CAPTURED journal's `at`,
meaning **capture acknowledgment time**, not an invented exact snapshot time.
Historical capture expiry grants no current import authority.

Undefined object properties remain absent. Their original `undefinedPaths`
sidecar is checked using own-property traversal and preserved separately; it
is never restored as null or injected into the strict importer envelope. The
original raw file must remain retained privately by the caller. Returned
buffers contain sensitive queue content and must stay outside Git/logs in
owner-protected storage; this function neither writes nor publishes them.

Outputs are `snapshot`, `importManifest`, `undefinedPaths`, and `receipt`
buffers. The manifest binds the final snapshot bytes and uses the existing
`PHAB_LEGACY_MAX_CUSTODY_IMPORT_V1` shape. Store it as a draft, not an approved
execution request. Empty MAX input returns null snapshot/manifest and
`NO_IMPORTABLE_COMMANDS`, retaining evidence without a fabricated command.
The receipt binds every input/output hash and expected context, records SUCCESS
or UNKNOWN Inspector provenance, and always states:

- `scope: MAP_ONLY`
- `drainProven: false`
- `durableInventoryIncluded: false`
- `targetVerified: false`
- `importAuthorized: false`

UNKNOWN capture closure never becomes Inspector-closed proof. Even SUCCESS
does not prove a sole client or a queue drain. Mongo-only records, old late
writes, sender admission, target mapping/indexes, recovery compatibility and
explicit approval remain separate prerequisites. No code calls the importer
automatically, and no current production restart is admitted by these files.

## Isolated-namespace restart union

`buildCup83MaxRestartUnion(mapInputs, mapExpected, durableInputs, expected)` reuses
that exact normalizer and binds one to three independently collected old Mongo
inventories. Each inventory is a compact JSON+LF envelope with schema
`PHAB_CUP83_MAX_DURABLE_INVENTORY_V1`, the same six-field source identity,
`targetFingerprint`, canonical `capturedAt`, and `commands` containing the original
Mongo documents. Only `_id` is omitted from importer commands; original input bytes
must remain private and retained. Inventory capture timestamps cannot precede the
Map capture acknowledgment. This ordering check does not prove a freeze or a
consistent database snapshot.

The separately reviewed expected context pins the entire mapExpected digest and
ordered `{sha256,targetFingerprint}` inventory list. Old namespace fingerprints
must be distinct and must not equal the new destination. The function cannot
prove that this list covers every actual backend. The operator must attest that
coverage, including primary/web namespaces that historical hydration can scan.

The union includes every input ID. Same-ID differences are allowed only in
`status`, `attempts`, `leasedUntil` and `lastError`; conflicting connector, payload,
metadata or identity fails closed. The first pinned Map is the representative when present;
otherwise the first pinned inventory is used. This selection is never a delivery
judgment: the existing importer must hold every old ID in the fresh namespace.
All source versions remain in the retained inventories, and the private provenance
artifact maps every ID to its Map/durable input positions and batch. Preserve it,
the undefined-property sidecar and all input bytes for UNKNOWN reconciliation.

Sorted IDs form deterministic, disjoint batches of at most5000 commands and32MiB,
compatible with the unchanged held importer. No truncation or partial subset is
returned. The helper bounds total input bytes128MiB, raw rows100000 and unique
commands50000. A single oversized command fails closed. All batches must be
imported and majority-readback verified before candidate or safe recovery may
lease. The two runtimes must share the same fresh collection and durable hold
barrier; stock83 rollback is forbidden after this transition.

Outputs are private draft `batches`, `provenance`, `undefinedPaths` and `receipt`.
The receipt explicitly leaves freeze, namespace completeness, target verification,
provider delivery and import authorization false. No live collector, fence,
restart, database write, provider send or recovery executor is introduced here.

### Preserve pre-drain and final snapshots

The optional fifth argument accepts at most two additional `{inputs, expected}`
Map bundles, each validated through the same five-artifact normalizer. The expected
union context must then contain the exact ordered `additionalMapContextSha256`
list. All snapshots must share the exact process/source identity and destination;
capture times must be nondecreasing, and every durable inventory must be captured
after the last Map acknowledgment. No input is replaced by a later snapshot.

Multiple Maps emit explicit V2 union receipt/provenance schemas. Provenance retains
each additional bundle's five hashes, normalization receipt, undefined-property
evidence and per-command input position. Single-Map callers retain the V1 output.
Original private files remain mandatory; V2 is not a new import authorization.

For the installed83 first restart, a final Map alone is insufficient: an active
hydration can clear a Map-only accepted command. Before starting a drain, the
bounded operator must synchronously require persistence sync inactive, disable
future sync and both Support timers, and capture the pre-drain Map without yielding.
An already active sync must refuse this admission before mutations. The later HTTP
drain/final capture and old-process stop remain separate reviewed operations. This
helper preserves the supplied known-ID union; it cannot recover a historical ID
already absent from every retained Map and durable namespace.
