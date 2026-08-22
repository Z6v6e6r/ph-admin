# Managed annual subscriptions: production backup tool

Status: **ISOLATED CANDIDATE / NOT RUN IN PRODUCTION**.

The one-shot tool exports only the eleven managed subscription collections and
their index metadata. It never changes MongoDB, calls Viva, publishes a policy,
enables a feature flag or restores data. A production run is a separate
operations gate.

## Safety contract

- `--target-fingerprint` performs no network or file operation and prints only
  the credential-free Mongo scheme/hosts/database fingerprint.
- `--check` verifies the pinned target, writable primary, current collection
  counts and index counts. It creates no file.
- `--create` requires root, `SUBSCRIPTIONS_BACKUP_CREATE=CONFIRM`, an exact
  database name, the reviewed target fingerprint, source release SHA/unit/path
  and an existing non-symlink backup root that is not group/world writable.
- Documents are read in one Mongo snapshot transaction and encoded as canonical
  Extended JSON. Index metadata is captured separately before the transaction.
- Every document/index file is SHA-256 pinned in `manifest.json`. The archive is
  completed atomically, with directory mode `0700` and archive mode `0600`.
- Default caps are 100,000 documents and 512 MiB. Exceeding either cap removes
  only the incomplete paths created by that invocation and fails closed.
- URI, credentials and document bodies are never printed. CLI failures expose
  only stable error codes.

The archive is a recovery artifact, not a restore authorization. There is no
automatic restore command. Any restore needs a separately reviewed procedure,
target attestation, dry run and explicit production approval.

## Preparation commands

Run from the exact immutable release directory. Keep the URI only in the
existing root-owned environment file; never put it in shell arguments or chat.

```bash
export SUBSCRIPTIONS_BACKUP_ROOT=/root/backups
export SUBSCRIPTIONS_BACKUP_EXPECTED_DB=dialog
export SUBSCRIPTIONS_BACKUP_SOURCE_SHA=<exact-release-sha>
export SUBSCRIPTIONS_BACKUP_SOURCE_UNIT=<exact-systemd-unit.service>
export SUBSCRIPTIONS_BACKUP_SOURCE_RELEASE_DIR=<exact-release-directory>

node --env-file=/opt/ph-admin/.env \
  scripts/managed-subscriptions-backup.mjs --target-fingerprint
```

Review the credential-free output out of band, then pin it without changing
the application service environment:

```bash
export SUBSCRIPTIONS_BACKUP_TARGET_SHA256=<reviewed-sha256>
node --env-file=/opt/ph-admin/.env \
  scripts/managed-subscriptions-backup.mjs --check
```

The check output may be retained only as collection names, counts, index counts,
database name, target fingerprint and `primaryVerified`. It must contain no URI
or documents.

## Separately approved creation gate

Do not run this merely because check mode passed. After explicit approval:

```bash
export SUBSCRIPTIONS_BACKUP_CREATE=CONFIRM
node --env-file=/opt/ph-admin/.env \
  scripts/managed-subscriptions-backup.mjs --create
```

Verify the returned archive SHA-256, root ownership/modes, manifest collection
set, per-file hashes and current counts before using it as the Gate B recovery
reference. Only after that separate acceptance may the read-only
`subscriptions:indexes:check` be considered.
