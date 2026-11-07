# Local CUP83 custody recovery tree

`scripts/prepare-cup83-recovery-tree.py` provides `prepare(...)` for an exclusively
owned local rehearsal directory. It does not expose a deploy command. Do not run
it on a live host or a shared directory, or treat its output as restart admission.

Inputs are the retained83 runtime directory, a fresh output path, and bytes plus
independently trusted SHA256 values for the baseline inventory, recovery manifest,
and recovery archive. Obtain the trusted hashes from the reviewed artifact/custody
record before calling the helper. Hashing arbitrary new input is not attestation.
The inventory contains sorted `{path, bytes, sha256, mode}` rows and excludes only
the two historical root release metadata files. This extended inventory is distinct
from the older installed inventory, which did not include mode.

The helper accepts only `PHAB_CUP_LEGACY_MAX_SAFE_RECOVERY_V1`, baseline83,
the reviewed derived source tree and patch, and exactly three support JS paths.
Two old executable hashes must match; the added module must be absent, including
dangling symlinks. It rejects duplicate JSON/tar entries, escaping paths, links,
special files, environment files, writable or special file modes, missing files,
and size/hash mismatches. Node, dependencies, SDK and every other runtime file
retain their content and mode. The original baseline is checked again after copy.

The output keeps the83 source lineage plus the custody overlay. Its two replacement
metadata files identify the publisher source separately and explicitly set
`evidence: LOCAL`, `firstRestartCustodyProven: false` and
`installationAuthorized: false`. They are not the live installed-runtime schema.
No old source metadata is copied as if it described the modified executable tree.

An error retains any partial output for inspection. Do not resume it automatically:
the next attempt needs another fresh output path and newly validated inputs.
There is no atomic live publication, power-loss durability, DB mutation, config
change, systemd command, provider request or automatic rollback in this helper.
It assumes exclusive local ownership; it is not an adversarial concurrent-writer
or live-host filesystem boundary.

Run the disposable fixture tests with:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 test/cup-recovery-tree.test.py -v
```

Fixtures substitute synthetic preimage bytes explicitly; they prove tree assembly
and failure handling, not an installed runtime identity. The existing Linux runtime
workflow separately builds and tests the real compiled recovery behavior with its
owned disposable Mongo fixture. First-restart ingress/sender custody, held import,
physical target identity and a reviewed live executor remain separate prerequisites.
