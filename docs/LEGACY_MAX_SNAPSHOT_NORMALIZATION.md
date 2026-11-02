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
