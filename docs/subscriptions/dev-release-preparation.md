# Subscriptions DEV release preparation

Status: source-only candidate; not an installation or activation command.

## Compatibility and identity

The default `production` builder profile keeps the existing v1 target, manifest
and archive name. `--profile subscriptions-dev` is an explicit opt-in with a
different, closed target and manifest schema. Cross-profile targets, unknown
profiles, duplicate options and incomplete options fail closed.

The DEV target binds `lk-reserve-89`, `phab-subscriptions-dev.service`, the
`/opt/phab-subscriptions-dev/releases` root, its sibling `current` link and the
loopback API `http://127.0.0.1:3036`. It is not the production unit and must never
be substituted into a production archive after building. Its canonical target
digest, builder source commit and `activationAuthorized: false` are included in
the manifest. The DEV builder and tracked target must belong to the attested
runtime source commit; new tooling cannot claim an older main as its provenance.

Target metadata expresses the intended installation, not live isolation proof.
It neither selects nor changes Mongo databases, service environment or flags.
No installer, service restart, routing, index operation or provider call is added.

## Candidate build

Use Node 22.13.1/npm 11.1.0 and a clean detached checkout. Output must be a new
directory outside the checkout, under a private operator-owned parent. The
existing build guards, runtime dependency inventory, secret/PII scan, checksum
and deterministic tar/gzip packaging apply to both profiles.

```text
npm run backend:release-attestation:build -- \
  --profile subscriptions-dev \
  --source <absolute-clean-detached-checkout> \
  --output <new-private-output-directory> \
  --expected-head <exact-commit> \
  --expected-tree <exact-tree> \
  --trusted-ref HEAD
```

Repeat into a second fresh output directory and compare archive and manifest
bytes. CI exercises both profiles twice. A task-head artifact remains a candidate:
it is not exact-current-main. After separately approved merge, fresh-fetch main,
check its exact CI, use `--trusted-ref refs/remotes/origin/main`, and rebuild.
Do not rename or relabel the task-head artifact as an exact-main release.

## Backup preparation and privacy boundary

The discovered reserve DEV uses a dedicated loopback Mongo process with a separate
data directory, but it is standalone. The existing managed backup tool uses a
snapshot transaction. A successful `hello` or `isWritablePrimary` does not prove
transaction support. A consistent Mongo backup remains `NOT_RUN`; do not tar a
running WiredTiger data directory or treat a concurrent logical export as a snapshot.

Only a partial filesystem preservation is possible under the current gate:

1. Re-freeze host, unit/PID, resolved current release and manifest; compare every
   runtime file/hash against an explicit inventory. Reject extra files, unsafe
   names, links, special files, mount crossings and writable parents.
2. Archive only that release into a **new** same-host root-owned `0700` directory,
   with `0600` files. Extract privately and verify every inventory hash. Do not
   execute code from the extraction.
3. The original Branch E request explicitly authorizes an opaque service-env
   backup. For this narrow exception only, copy the exact DEV env to a separate
   private file on the same host using `O_NOFOLLOW`, regular-file/nlink/owner/mode
   and pre/post descriptor checks. Never print, download, publish, or include its
   contents or digest in a public receipt. This is not permission to inspect keys.
4. Do not reuse the old backup tree, its credentials artifact, logs, uploads or
   database files. Keep partial outputs private, with manual retention review;
   perform no automatic deletion. Quarantine failed outputs as unusable.
5. Record `DEV_BACKUP=PARTIAL`, `MONGO_BACKUP=NOT_RUN`,
   `RESTORE_PATH_PROVEN=NO`. Release/env preservation cannot open the deploy gate.

Mongo recovery needs a separately approved, reviewed consistent snapshot method
(for example bounded quiescence or a supported storage snapshot), then a restore
rehearsal on a disposable isolated target. Do not change the existing standalone
to a replica set or provision a new fixture database implicitly.

## Remaining live gates

- Fresh exact-main CI and two identical DEV builds after merge.
- Verified complete DEV backup and recovery procedure.
- A separately reviewed install/cutover that validates the DEV manifest and
  actual unit/path/listener/Mongo custody; an HTTP health response is not SHA proof.
- Current canary guards require development/test, a `dev-*`/`test-*` database,
  single loopback `rs0`, and fixture sentinel. The existing standalone DEV does
  not satisfy these requirements. No guard is weakened here.
- Exact two secure IDs, private tester-ownership evidence and approved V1/V2
  business payloads; no enumeration, invented policies or provider writes.
- Runtime contracts/context, entitlement lifecycle, activation and deadline
  worker stay OFF; LK allowlist unchanged. Only a separate activation gate may
  alter them.
