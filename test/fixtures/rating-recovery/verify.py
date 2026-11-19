"""Verify the published snapshot, pinned checkouts and CUP build."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent
manifest = json.loads((root / "manifest.json").read_text())
parser = argparse.ArgumentParser()
parser.add_argument("--builds", action="store_true", help="Check the three Git sources and compiled CUP JS")
options = parser.parse_args()


def verify(file, expected_hash, size=None):
    data = file.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected_hash or (size is not None and len(data) != size):
        raise SystemExit(f"Unexpected artifact: {file}")


for name, expected in manifest["artifacts"].items():
    verify(root / name, expected["sha256"], expected["bytes"])
router = json.loads((root / "lk1-router.json").read_text())
if hashlib.sha256(router["func"].encode()).hexdigest() != manifest["lk1Router"]["functionSha256"]:
    raise SystemExit("Unexpected LK1 router function")

if options.builds:
    for component, expected in manifest["sources"].items():
        checkout = Path(os.environ[expected["sourceEnv"]])
        sha, tree = subprocess.check_output(
            ["git", "-C", str(checkout), "log", "-1", "--format=%H %T"], text=True
        ).split()
        if (sha, tree) != (expected["commit"], expected["tree"]):
            raise SystemExit(f"Unexpected {component} checkout: {sha} {tree}")
        if subprocess.run(["git", "-C", str(checkout), "diff", "--quiet", "HEAD", "--"]).returncode:
            raise SystemExit(f"Tracked changes in {component}: {checkout}")
        if component == "cup":
            dist = Path(os.environ.get("RATING_CUP_DIST", checkout / "dist"))
            for line in (root / "cup-dist.sha256").read_text().splitlines():
                digest, name = line.split("  ", 1)
                verify(dist / name.removeprefix("dist/"), digest)

print("PASS: pinned snapshot and fixture hashes" + ("; three source revisions and 350 CUP JS files" if options.builds else ""))
