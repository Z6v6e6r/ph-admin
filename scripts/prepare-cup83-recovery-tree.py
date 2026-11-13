"""Offline preparation only. Never installs, starts, or admits a recovery runtime."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tarfile

BASELINE = '83b1c17bc4c5edaec65387b25b5695e48337c3cf'
DERIVED = 'e34e7802fd6cc82eb72530afe4a28eeb2fa27010'
PATCH = '14acb6b3212283c26c008ebd6d6de455d90a023f806cf942a76e3f2b79fee9be'
PREIMAGES = {
    'dist/support/legacy-max-custody.js': None,
    'dist/support/support-persistence.service.js': '8cb4aec8e0c2f36d394b695090fbaa0e5e67a2c3796d0691429fa86aa6acc905',
    'dist/support/support.service.js': '6bd4f367f163459384810823e271c3598ecf4a43de8f10a5ae22c45d79405c87',
}
METADATA = {'release-manifest.json', 'release-attestation.json'}


def require(value, code):
    if not value:
        raise ValueError(code)


def digest(body):
    return hashlib.sha256(body).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def unique_pairs(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, 'DUPLICATE_JSON_KEY')
        value[key] = item
    return value


def document(body, expected_hash):
    require(digest(body) == expected_hash, 'INPUT_HASH_MISMATCH')
    return json.loads(body, object_pairs_hook=unique_pairs)


def safe_path(name):
    require(isinstance(name, str) and name and '\\' not in name, 'UNSAFE_PATH')
    p = PurePosixPath(name)
    require(not p.is_absolute() and str(p) == name and all(x not in ('..', '.') for x in p.parts), 'UNSAFE_PATH')
    require(not any(x.startswith('.env') for x in p.parts), 'ENV_FILE_FORBIDDEN')
    return name


def read_regular(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, 'UNSAFE_FILE')
        require(not before.st_mode & 0o7022, 'WRITABLE_OR_SPECIAL_MODE_FILE')
        body = stream.read()
        after = os.fstat(stream.fileno())
        require(all(getattr(after, key) == getattr(before, key) for key in
                    ('st_dev', 'st_ino', 'st_size', 'st_mode', 'st_mtime_ns', 'st_ctime_ns')), 'FILE_CHANGED')
        return body, stat.S_IMODE(before.st_mode)


def inventory(root):
    require(root.is_dir() and not root.is_symlink(), 'UNSAFE_ROOT')
    result = []
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            p = Path(directory) / name
            rel = safe_path(p.relative_to(root).as_posix())
            s = p.lstat()
            require(not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o7022, 'UNSAFE_TREE_ENTRY')
            require(stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode), 'SPECIAL_FILE')
            if stat.S_ISREG(s.st_mode):
                body, mode = read_regular(p)
                if rel not in METADATA:
                    result.append({'path': rel, 'bytes': len(body), 'sha256': digest(body), 'mode': mode})
    return sorted(result, key=lambda row: row['path'])


def overlay(manifest_bytes, archive_bytes, manifest_hash, archive_hash):
    m = document(manifest_bytes, manifest_hash)
    require(digest(archive_bytes) == archive_hash, 'ARCHIVE_HASH_MISMATCH')
    require(m['schema'] == 'PHAB_CUP_LEGACY_MAX_SAFE_RECOVERY_V1'
            and m['baselineCommit'] == BASELINE and m['derivedSourceTree'] == DERIVED
            and m['patchSha256'] == PATCH and m['nodeVersion'] == 'v22.13.1', 'RECOVERY_PROFILE_MISMATCH')
    require(m['maxOutboxMode'] == 'legacy' and type(m['persistenceSyncIntervalMs']) is int
            and m['persistenceSyncIntervalMs'] == 0 and m['automaticHydrationAllowed'] is False
            and m['firstRestartCustodyProven'] is False, 'RECOVERY_SCOPE_MISMATCH')
    rows = m['delta']
    require(isinstance(rows, list) and len(rows) == 3, 'DELTA_SIZE')
    expected = {safe_path(row['path']): row for row in rows}
    require(set(expected) == set(PREIMAGES), 'DELTA_PATH_SET')
    for name, row in expected.items():
        require(row['expectedPreviousSha256'] == PREIMAGES[name], 'PREIMAGE_CONTRACT')
        require(type(row['bytes']) is int and 0 < row['bytes'] <= 1_000_000, 'DELTA_BYTES')
    files, seen = {}, set()
    with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode='r:gz') as archive:
        for member in archive:
            name = safe_path(member.name.rstrip('/') if member.isdir() else member.name)
            require(name not in seen, 'DUPLICATE_TAR_MEMBER')
            seen.add(name)
            if member.isdir():
                require(name in ('dist', 'dist/support'), 'UNEXPECTED_DIRECTORY')
                continue
            require(member.isfile() and name in expected and not member.linkname, 'UNSAFE_TAR_MEMBER')
            require(member.size == expected[name]['bytes'], 'TAR_SIZE_MISMATCH')
            require(not member.mode & 0o7022, 'TAR_MODE_UNSAFE')
            body = archive.extractfile(member).read()
            require(digest(body) == expected[name]['sha256'], 'TAR_HASH_MISMATCH')
            files[name] = body
    require(set(files) == set(expected), 'MISSING_DELTA_FILE')
    return m, files


def prepare(baseline, output, baseline_inventory_bytes, baseline_inventory_hash,
            manifest_bytes, manifest_hash, archive_bytes, archive_hash):
    """Only caller-owned local directories; independently trusted hashes are mandatory.

    An interrupted/failed output is retained without a success attestation. It must
    never be installed or resumed automatically. No systemd, DB, provider or SSH use.
    """
    baseline, output = Path(baseline).absolute(), Path(output).absolute()
    require(baseline.resolve() == baseline and output.parent.resolve() == output.parent, 'PATH_ANCESTOR_SYMLINK')
    require(not output.is_relative_to(baseline) and not baseline.is_relative_to(output), 'PATH_OVERLAP')
    require(not os.path.lexists(output), 'OUTPUT_EXISTS')
    expected = document(baseline_inventory_bytes, baseline_inventory_hash)
    before = inventory(baseline)
    require(before == expected, 'BASELINE_INVENTORY_MISMATCH')
    manifest, files = overlay(manifest_bytes, archive_bytes, manifest_hash, archive_hash)
    by_path = {row['path']: row for row in before}
    require('runtime/node' in by_path, 'RETAINED_NODE_REQUIRED')
    for name, old_hash in PREIMAGES.items():
        if old_hash is None:
            require(not os.path.lexists(baseline / name), 'NEW_FILE_ALREADY_EXISTS')
        else:
            require(by_path.get(name, {}).get('sha256') == old_hash, 'BASELINE_PREIMAGE_MISMATCH')
    output.mkdir(mode=0o700)
    for row in before:
        body, mode = read_regular(baseline / row['path'])
        require(digest(body) == row['sha256'] and mode == row['mode'], 'BASELINE_COPY_DRIFT')
        target = output / row['path']
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        with target.open('xb') as stream:
            stream.write(files.get(row['path'], body))
        target.chmod(mode)
    for name in set(files) - set(by_path):
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        with target.open('xb') as stream:
            stream.write(files[name])
        target.chmod(0o644)
    after = inventory(output)
    planned = {row['path']: dict(row) for row in before}
    for name, body in files.items():
        planned[name] = {'path': name, 'bytes': len(body), 'sha256': digest(body),
                         'mode': by_path.get(name, {}).get('mode', 0o644)}
    require(after == sorted(planned.values(), key=lambda row: row['path']), 'RECOVERY_INVENTORY_MISMATCH')
    require(inventory(baseline) == before, 'BASELINE_CHANGED_DURING_COPY')
    receipt = {'schema': 'PHAB_CUP_LOCAL_CUSTODY_RECOVERY_TREE_V1', 'kind': 'baseline83-with-custody-overlay',
               'baselineCommit': BASELINE, 'derivedSourceTree': DERIVED, 'patchSha256': PATCH,
               'publisherSourceCommit': manifest['sourceCommit'], 'publisherSourceTree': manifest['sourceTree'],
               'manifestSha256': manifest_hash, 'archiveSha256': archive_hash,
               'baselineInventorySha256': baseline_inventory_hash, 'runtimeInventory': after,
               'runtimeInventorySha256': digest(encoded(after)), 'retainedNodeSha256': by_path['runtime/node']['sha256'],
               'firstRestartCustodyProven': False, 'installationAuthorized': False, 'evidence': 'LOCAL'}
    # The historical installed manifests would describe the wrong executable tree.
    # Replace them with explicitly local provenance only after all validations pass.
    for name in sorted(METADATA):
        with (output / name).open('xb') as stream:
            stream.write(encoded(receipt))
    return receipt
