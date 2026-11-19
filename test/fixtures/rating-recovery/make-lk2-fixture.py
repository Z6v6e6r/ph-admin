"""Derive a restartable test ingress from the pinned LK2 rehearsal script."""
import sys
from pathlib import Path

source = Path(sys.argv[1]).read_text()
changes = {
    "assert.equal(url.port, '25478');": "assert.equal(url.port, '25483');",
    "'/phub_cup_level_probe'": "'/rating_recovery_fixture'",
    "db: 'phub_cup_level_probe'": "db: 'rating_recovery_fixture'",
    "  await withTenantTransaction(admin, tenantId, async (connection) => {": (
        "  if (process.env.RATING_PHASE === 'seed') await withTenantTransaction(admin, tenantId, async (connection) => {"
    ),
    "port: 18078": "port: 18183",
}
for before, after in changes.items():
    if source.count(before) != 1:
        raise SystemExit(f"Unexpected LK2 fixture source: {before!r}")
    source = source.replace(before, after)
print(source, end="")
