import datetime as dt
import importlib.util
import http.server
import json
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location('replica', Path(__file__).parents[1] / 'scripts/traffic-replica.py')
replica = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replica)


class ReplicaTest(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime.now(dt.timezone.utc)
        self.policy = {'version': 1, 'revision': 1, 'rules': [
            {'ip': '203.0.113.9', 'expiresAt': (self.now + dt.timedelta(days=1)).isoformat()}]}

    def raw(self, **changes):
        return json.dumps({**self.policy, 'sourceGeneratedAt': self.now.isoformat(), **changes}).encode()

    def test_export_strips_private_fields_and_validates_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp) / 'source', Path(tmp) / 'export'
            source.write_text(json.dumps({**self.policy, 'audit': [{'actorId': 'private-actor'}],
                'rules': [{**self.policy['rules'][0], 'reason': 'private-reason', 'createdBy': 'private-actor'}]}))
            out = replica.export_policy(source, target, self.now)
            self.assertEqual(set(out), {'version', 'revision', 'rules', 'sourceGeneratedAt'})
            self.assertNotIn('private-', target.read_text())
            self.assertEqual(target.stat().st_mode & 0o777, 0o644)
            before = target.read_bytes()
            source.write_text(json.dumps({**self.policy, 'revision': 0}))
            with self.assertRaisesRegex(ValueError, 'revision_regression'):
                replica.export_policy(source, target, self.now)
            self.assertEqual(target.read_bytes(), before)

    def test_invalid_inputs_leave_accepted_snapshot_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'policy'
            replica.receive(self.raw(), path, self.now)
            before = path.read_bytes()
            bad = [b'{', b'x' * (replica.MAX_BYTES + 1), b'{"version":1,"version":1}',
                   self.raw(version=True), self.raw(revision=True), self.raw(revision=-1),
                   self.raw(rules=None), self.raw(rules=[self.policy['rules'][0]] * 2),
                   self.raw(rules=[self.policy['rules'][0]] * 1001), self.raw(extra='unexpected'),
                   self.raw(sourceGeneratedAt='2026-09-25'), self.raw(sourceGeneratedAt=None),
                   self.raw(sourceGeneratedAt=(self.now-dt.timedelta(seconds=181)).isoformat()),
                   self.raw(sourceGeneratedAt=(self.now+dt.timedelta(seconds=61)).isoformat())]
            for ip in ['188.127.235.140', '::ffff:188.127.235.140', '147.45.103.3', '89.108.64.209',
                       '127.0.0.1', '10.0.0.1', '2001:db8::1%eth0', '192.0.2.0/24', 'host.example', '1.2.3.4;']:
                bad.append(self.raw(rules=[{**self.policy['rules'][0], 'ip': ip}]))
            bad += [self.raw(rules=[{**self.policy['rules'][0], 'expiresAt': value}])
                    for value in [None, 9, 'bad', '2026-09-25T12:00:00']]
            bad.append(self.raw(rules=[{**self.policy['rules'][0], 'reason': 'must-not-transfer'}]))
            for raw in bad:
                with self.subTest(raw=raw[:120]), self.assertRaises((ValueError, TypeError, KeyError)):
                    replica.receive(raw, path, self.now)
                self.assertEqual(path.read_bytes(), before)

    def test_received_watermark_survives_failed_apply_and_replays(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); policy = root / 'policy'
            def fail(*_):
                raise RuntimeError('nginx failed')
            with self.assertRaises(RuntimeError):
                replica.replica_sync(policy, root / 'target', root, fetch=lambda: self.raw(revision=3), sync=fail)
            before = policy.read_bytes()
            for raw in [self.raw(revision=2), self.raw(revision=3, rules=[]),
                        self.raw(revision=3, sourceGeneratedAt=(self.now-dt.timedelta(seconds=1)).isoformat())]:
                with self.assertRaises(ValueError):
                    replica.receive(raw, policy, self.now)
                self.assertEqual(policy.read_bytes(), before)
            accepted = replica.receive(self.raw(revision=4, rules=[]), policy, self.now)
            self.assertEqual(accepted['rules'], [])

    def test_outage_still_expires_locally_and_keeps_source_heartbeat(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); policy = root / 'policy'; target = root / 'target'
            expired = {**self.policy, 'rules': [{**self.policy['rules'][0],
                'expiresAt': (self.now-dt.timedelta(seconds=1)).isoformat()}], 'sourceGeneratedAt': self.now.isoformat()}
            replica.receive(json.dumps(expired).encode(), policy, self.now)
            target.write_text('old active config')
            receipt = root / 'replica-status.json'
            receipt.write_text(json.dumps({'sourceFetchedAt': 'previous-heartbeat'}))
            def fail():
                raise TimeoutError('unavailable')
            calls = []
            def sync(*args):
                return replica.edge.sync_policy(*args, runner=calls.append, probe=lambda _: None)
            with self.assertRaises(RuntimeError):
                replica.replica_sync(policy, target, root, fetch=fail, sync=sync)
            status = json.loads(receipt.read_text())
            self.assertEqual(status['sourceFetchedAt'], 'previous-heartbeat')
            self.assertEqual(status['fetchError'], 'replica_fetch_failed')
            self.assertIsNone(status['applyError'])
            self.assertEqual(json.loads((root / 'edge-status.json').read_text())['activeIps'], [])
            self.assertNotIn('203.0.113.9', target.read_text())
            self.assertEqual(len(calls), 2)
            receipt.write_text('{')
            with self.assertRaises(RuntimeError):
                replica.replica_sync(policy, target, root, fetch=fail, sync=sync)
            self.assertEqual(json.loads(receipt.read_text())['appliedRevision'], 1)

    def test_fetch_rejects_wrong_response_and_disables_redirect_proxy(self):
        opener = MagicMock()
        response = opener.open.return_value.__enter__.return_value
        response.status = 200
        response.geturl.return_value = replica.SOURCE_URL
        response.read.return_value = self.raw()
        with patch.object(replica.urllib.request, 'build_opener', return_value=opener) as build:
            self.assertEqual(replica.fetch_snapshot(), self.raw())
            self.assertEqual(build.call_args.args[0].proxies, {})
            self.assertIsInstance(build.call_args.args[1], replica.edge.NoRedirect)
            self.assertEqual(opener.open.call_args.kwargs['timeout'], 8)
            response.read.assert_called_with(replica.MAX_BYTES + 1)
            response.geturl.return_value = 'https://elsewhere.invalid/'
            with self.assertRaises(ValueError):
                replica.fetch_snapshot()
            response.geturl.return_value = replica.SOURCE_URL
            response.status = 304
            with self.assertRaises(ValueError):
                replica.fetch_snapshot()

    def test_success_and_expired_export_freshness(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); policy = root / 'policy'; target = root / 'target'
            target.write_text(replica.edge.render_policy({'version': 1, 'revision': 0, 'rules': []})[0])
            def sync(*args):
                return replica.edge.sync_policy(*args, runner=lambda _: None, probe=lambda _: None)
            out = replica.replica_sync(policy, target, root, fetch=self.raw, sync=sync)
            self.assertEqual(out['receivedRevision'], out['appliedRevision'])
            self.assertIsNone(out['fetchError'])
            before = policy.read_bytes()
            with self.assertRaisesRegex(ValueError, 'stale_or_future'):
                replica.receive(self.raw(), policy, self.now + dt.timedelta(seconds=181))
            self.assertEqual(policy.read_bytes(), before)

    def test_real_transport_failures_preserve_policy_and_run_local_sync(self):
        visited = []
        class Server(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                visited.append(self.path)
                if self.path == '/redirect':
                    self.send_response(302)
                    self.send_header('Location', '/must-not-follow')
                    self.end_headers()
                else:
                    self.send_response(200)
                    self.send_header('Content-Length', '100000')
                    self.end_headers()
                    try:
                        for _ in range(150):
                            self.wfile.write(b'x'); self.wfile.flush(); time.sleep(0.1)
                    except (BrokenPipeError, ConnectionResetError):
                        pass
            def log_message(self, *_):
                pass
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); policy = root / 'policy'
            replica.receive(self.raw(), policy, self.now)
            before = policy.read_bytes()
            certificate, key = root / 'cert.pem', root / 'key.pem'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                '-subj', '/CN=localhost', '-keyout', str(key), '-out', str(certificate)],
                check=True, capture_output=True, timeout=20)
            servers = [http.server.ThreadingHTTPServer(('127.0.0.1', 0), Server) for _ in range(2)]
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(certificate, key)
            servers[0].socket = context.wrap_socket(servers[0].socket, server_side=True)
            for server in servers:
                threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                urls = [f'https://127.0.0.1:{servers[0].server_port}/tls-untrusted',
                        f'http://127.0.0.1:{servers[1].server_port}/redirect',
                        f'http://127.0.0.1:{servers[1].server_port}/trickle']
                for url in urls:
                    local = MagicMock(return_value={'appliedRevision': 1, 'appliedHash': 'fixture'})
                    started = time.monotonic()
                    with self.subTest(url=url), patch.object(replica, 'SOURCE_URL', url):
                        with self.assertRaises(RuntimeError):
                            replica.replica_sync(policy, root / 'target', root, sync=local)
                    local.assert_called_once()
                    self.assertEqual(policy.read_bytes(), before)
                    self.assertLess(time.monotonic() - started, 15)
                self.assertEqual(visited, ['/redirect', '/trickle'])
            finally:
                for server in servers:
                    server.shutdown(); server.server_close()


if __name__ == '__main__':
    unittest.main()
