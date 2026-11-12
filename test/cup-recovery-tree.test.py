"""Synthetic filesystem/archive failure cases; no runtime, DB or provider calls."""
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('recovery', Path(__file__).parents[1] / 'scripts/prepare-cup83-recovery-tree.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.base = self.root / 'baseline'
        self.base.mkdir()
        self.out = self.root / 'prepared'
        self.old = {name: (None if digest is None else ('old:' + name).encode()) for name, digest in r.PREIMAGES.items()}
        self.new = {name: ('new:' + name).encode() for name in self.old}
        self.write('runtime/node', b'synthetic-node-not-executable', 0o755)
        self.write('client-sdk/unchanged.js', b'retain SDK bytes')
        self.write('node_modules/retained/index.js', b'retain dependency bytes')
        self.write('release-manifest.json', b'old provenance')
        self.write('release-attestation.json', b'old provenance')
        for name, body in self.old.items():
            if body is not None:
                self.write(name, body)
        fixture_preimages = {name: None if body is None else r.digest(body) for name, body in self.old.items()}
        self.patcher = patch.object(r, 'PREIMAGES', fixture_preimages)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.manifest = {'schema': 'PHAB_CUP_LEGACY_MAX_SAFE_RECOVERY_V1', 'baselineCommit': r.BASELINE,
                         'derivedSourceTree': r.DERIVED, 'patchSha256': r.PATCH, 'nodeVersion': 'v22.13.1',
                         'sourceCommit': 'a' * 40, 'sourceTree': 'b' * 40, 'maxOutboxMode': 'legacy',
                         'persistenceSyncIntervalMs': 0, 'automaticHydrationAllowed': False,
                         'firstRestartCustodyProven': False,
                         'delta': [{'path': name, 'bytes': len(body), 'sha256': r.digest(body),
                                    'expectedPreviousSha256': fixture_preimages[name]} for name, body in self.new.items()]}

    def write(self, name, body, mode=0o644):
        p = self.base / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(body)
        p.chmod(mode)

    def archive(self, extra=None, omit=None):
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w:gz') as tar:
            for name, body in self.new.items():
                if name == omit:
                    continue
                member = tarfile.TarInfo(name)
                member.size = len(body)
                member.mode = 0o644
                tar.addfile(member, io.BytesIO(body))
            if extra:
                tar.addfile(*extra)
        return stream.getvalue()

    def inputs(self):
        inventory = r.encoded(r.inventory(self.base))
        manifest = r.encoded(self.manifest)
        archive = self.archive()
        return dict(baseline=self.base, output=self.out, baseline_inventory_bytes=inventory,
                    baseline_inventory_hash=r.digest(inventory), manifest_bytes=manifest,
                    manifest_hash=r.digest(manifest), archive_bytes=archive, archive_hash=r.digest(archive))

    def test_exact_tree_retains_node_dependencies_sdk_and_replaces_provenance(self):
        before = r.inventory(self.base)
        receipt = r.prepare(**self.inputs())
        self.assertEqual(r.inventory(self.base), before)
        for name, body in self.new.items():
            self.assertEqual((self.out / name).read_bytes(), body)
        for name in ('runtime/node', 'client-sdk/unchanged.js', 'node_modules/retained/index.js'):
            self.assertEqual((self.out / name).read_bytes(), (self.base / name).read_bytes())
        self.assertEqual((self.out / 'runtime/node').stat().st_mode & 0o777, 0o755)
        self.assertEqual(receipt['runtimeInventory'], r.inventory(self.out))
        self.assertFalse(receipt['installationAuthorized'])
        self.assertFalse(receipt['firstRestartCustodyProven'])
        for name in r.METADATA:
            self.assertEqual(json.loads((self.out / name).read_bytes()), receipt)

    def test_wrong_missing_preimage_and_occupied_new_path(self):
        name = 'dist/support/support.service.js'
        self.write(name, b'wrong old executable')
        with self.assertRaisesRegex(ValueError, 'PREIMAGE'):
            r.prepare(**self.inputs())
        (self.base / name).unlink()
        with self.assertRaisesRegex(ValueError, 'PREIMAGE'):
            r.prepare(**self.inputs())
        self.write(name, self.old[name])
        self.write('dist/support/legacy-max-custody.js', b'already here')
        with self.assertRaisesRegex(ValueError, 'ALREADY_EXISTS'):
            r.prepare(**self.inputs())
        self.assertFalse(self.out.exists())

    def test_schema_scope_and_duplicate_delta_rejected(self):
        for key, value in [('schema', 'PHAB_CUP_PAYMENT_SAFE_RECOVERY_V1'), ('baselineCommit', '0' * 40),
                           ('firstRestartCustodyProven', True), ('persistenceSyncIntervalMs', False),
                           ('automaticHydrationAllowed', True), ('delta', [self.manifest['delta'][0]] * 3)]:
            with self.subTest(key=key), patch.dict(self.manifest, {key: value}):
                with self.assertRaises(ValueError):
                    r.prepare(**self.inputs())
        self.assertFalse(self.out.exists())

    def test_traversal_duplicate_link_device_and_extra_member_rejected(self):
        for name, kind in [('../escape', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE),
                           ('dist/support/support.service.js', tarfile.REGTYPE),
                           ('extra', tarfile.REGTYPE), ('dist/link', tarfile.SYMTYPE),
                           ('dist/hardlink', tarfile.LNKTYPE), ('dist/device', tarfile.CHRTYPE)]:
            with self.subTest(name=name):
                member = tarfile.TarInfo(name)
                member.type = kind
                member.linkname = 'outside' if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE) else ''
                archive = self.archive((member, io.BytesIO(b'')))
                args = self.inputs()
                args.update(archive_bytes=archive, archive_hash=r.digest(archive))
                with self.assertRaises(ValueError):
                    r.prepare(**args)
        self.assertFalse((self.root / 'escape').exists())
        self.assertFalse(self.out.exists())

    def test_missing_file_bad_size_and_bad_hash_rejected(self):
        args = self.inputs()
        archive = self.archive(omit=next(iter(self.new)))
        args.update(archive_bytes=archive, archive_hash=r.digest(archive))
        with self.assertRaisesRegex(ValueError, 'MISSING_DELTA'):
            r.prepare(**args)
        for key, value in [('bytes', 999), ('sha256', '0' * 64)]:
            with patch.dict(self.manifest['delta'][0], {key: value}):
                with self.assertRaises(ValueError):
                    r.prepare(**self.inputs())

    def test_independent_hashes_and_inventory_drift_rejected(self):
        for key in ('manifest_hash', 'archive_hash', 'baseline_inventory_hash'):
            args = self.inputs()
            args[key] = '0' * 64
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'HASH_MISMATCH'):
                r.prepare(**args)
        args = self.inputs()
        self.write('client-sdk/unchanged.js', b'changed after inventory')
        with self.assertRaisesRegex(ValueError, 'INVENTORY_MISMATCH'):
            r.prepare(**args)

    def test_symlink_env_special_mode_and_occupied_output_rejected(self):
        link = self.base / 'dist/support/legacy-max-custody.js'
        link.symlink_to(self.root / 'absent')
        with self.assertRaises(ValueError):
            self.inputs()
        link.unlink()
        self.write('.env.private', b'synthetic only')
        with self.assertRaisesRegex(ValueError, 'ENV_FILE'):
            self.inputs()
        (self.base / '.env.private').unlink()
        (self.base / 'runtime/node').chmod(0o777)
        with self.assertRaises(ValueError):
            self.inputs()
        (self.base / 'runtime/node').chmod(0o755)
        self.out.symlink_to(self.root / 'absent')
        with self.assertRaisesRegex(ValueError, 'OUTPUT_EXISTS'):
            r.prepare(**self.inputs())

    def test_partial_copy_failure_never_emits_success_provenance(self):
        args = self.inputs()
        real_read = r.read_regular
        def fail_copy(path):
            if self.out.exists() and str(path).endswith('runtime/node'):
                raise OSError('synthetic disk failure')
            return real_read(path)
        with patch.object(r, 'read_regular', side_effect=fail_copy):
            with self.assertRaisesRegex(OSError, 'synthetic disk failure'):
                r.prepare(**args)
        self.assertTrue(self.out.exists())
        self.assertTrue(all(not (self.out / name).exists() for name in r.METADATA))
        self.assertEqual(r.encoded(r.inventory(self.base)), args['baseline_inventory_bytes'])

    def test_duplicate_json_key_rejected_even_with_matching_hash(self):
        args = self.inputs()
        args['manifest_bytes'] = b'{"schema":1,"schema":2}'
        args['manifest_hash'] = r.digest(args['manifest_bytes'])
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_JSON_KEY'):
            r.prepare(**args)


class GenerationRecoveryTests(RecoveryTests):
    def setUp(self):
        super().setUp()
        self.old = {name: (None if value is None else ('old:' + name).encode())
                    for name, value in r.GENERATION_PREIMAGES.items()}
        self.new = {name: ('new:' + name).encode() for name in self.old}
        for name, body in self.old.items():
            if body is not None:
                self.write(name, body)
        fixture_preimages = {name: None if body is None else r.digest(body) for name, body in self.old.items()}
        generation_patch = patch.object(r, 'GENERATION_PREIMAGES', fixture_preimages)
        generation_patch.start()
        self.addCleanup(generation_patch.stop)
        self.manifest.update(schema='PHAB_CUP_LEGACY_MAX_SAFE_RECOVERY_V2',
                             derivedSourceTree=r.GENERATION_DERIVED, patchSha256=r.GENERATION_PATCH,
                             generationFenceSupported=True, generationActivationProven=False,
                             delta=[{'path': name, 'bytes': len(body), 'sha256': r.digest(body),
                                     'expectedPreviousSha256': fixture_preimages[name]} for name, body in self.new.items()])

    def test_generation_scope_profile_and_new_module_absence(self):
        for values in [{'generationFenceSupported': False}, {'generationFenceSupported': 1},
                       {'generationActivationProven': True}, {'generationActivationProven': 0},
                       {'derivedSourceTree': r.DERIVED}, {'patchSha256': r.PATCH},
                       {'schema': 'PHAB_CUP_LEGACY_MAX_SAFE_RECOVERY_V1',
                        'derivedSourceTree': r.DERIVED, 'patchSha256': r.PATCH}]:
            with self.subTest(values=values), patch.dict(self.manifest, values), self.assertRaises(ValueError):
                r.prepare(**self.inputs())
        self.write('dist/support/max-generation.js', b'occupied module')
        with self.assertRaisesRegex(ValueError, 'ALREADY_EXISTS'):
            r.prepare(**self.inputs())
        self.assertFalse(self.out.exists())

    def test_generation_receipt_binds_the_new_profile_without_live_claims(self):
        receipt = r.prepare(**self.inputs())
        self.assertEqual(receipt['schema'], 'PHAB_CUP_LOCAL_CUSTODY_RECOVERY_TREE_V2')
        self.assertEqual(receipt['derivedSourceTree'], r.GENERATION_DERIVED)
        self.assertEqual(receipt['patchSha256'], r.GENERATION_PATCH)
        self.assertTrue(receipt['generationFenceSupported'])
        self.assertFalse(receipt['generationActivationProven'])
        self.assertFalse(receipt['firstRestartCustodyProven'])
        self.assertFalse(receipt['installationAuthorized'])


if __name__ == '__main__':
    unittest.main()
