"""Local-only e2e. Requires nginx with http_realip_module; no application credentials/services.
Run: python3 test/traffic-nginx.test.py /absolute/path/to/nginx
"""
import datetime as dt
import http.client
import http.server
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('traffic', ROOT / 'scripts/traffic-edge.py')
traffic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(traffic)
replica_spec = importlib.util.spec_from_file_location('replica', ROOT / 'scripts/traffic-replica.py')
replica = importlib.util.module_from_spec(replica_spec)
replica_spec.loader.exec_module(replica)


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); return sock.getsockname()[1]


def main(binary):
    received = []
    class Upstream(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            received.append((self.command, self.path)); self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', 'https://fixture.invalid')
            self.end_headers(); self.wfile.write(b'ok')
        do_HEAD = do_POST = do_OPTIONS = do_PUT = do_PATCH = do_DELETE = do_GET
        def log_message(self, *args): pass
    upstream = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='traffic-nginx-') as temp:
        root = Path(temp); root.chmod(0o755); (root / 'logs').mkdir(); listen, probe_port, reserve_port = port(), port(), port()
        target, policy, log = root / 'policy.conf', root / 'policy.json', root / 'access.jsonl'
        empty = {'version': 1, 'revision': 0, 'rules': []}
        target.write_text(traffic.render_policy(empty)[0]); policy.write_text(json.dumps(empty))
        http_config = (ROOT / 'deploy/traffic/http.conf').read_text().replace('/etc/nginx/phab-traffic/policy.conf', str(target)).replace('127.0.0.1:18147', '127.0.0.1:' + str(probe_port))
        server_config = (ROOT / 'deploy/traffic/server.conf').read_text().replace('/var/log/nginx/phab-traffic.jsonl', str(log))
        quarantine_config = server_config
        primary_log = root / 'primary-hops.log'
        server_config += '\naccess_log ' + str(primary_log) + ' fixture_hops;\n'
        exported = root / 'export.json'; exported.write_text('{"minimal":"fixture"}')
        source_config = (ROOT / 'deploy/traffic/replication-source.conf').read_text().replace('/var/lib/phab-traffic-export/policy.json', str(exported))
        reserve_config = (ROOT / 'deploy/traffic/replication-reserve.conf').read_text()
        # Fixture-only ingress identity, then the same mandatory local quarantine
        # include used on the primary. Never add this header trust to production.
        reserve_config = ('set_real_ip_from 127.0.0.1; real_ip_header X-Fixture-IP;\n' +
                          quarantine_config + '\n' + reserve_config)
        config = root / 'nginx.conf'
        # Only this fixture trusts its local test client as an ingress proxy.
        temp_paths = 'log_format fixture_hops "$request_id";\naccess_log off; open_file_cache max=100 inactive=10m; open_file_cache_valid 10m;\n' + ''.join(f'{module}_temp_path {root / module};\n' for module in ['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'])
        config.write_text('daemon off; worker_processes 1; error_log ' + str(root/'error.log') + '; pid ' + str(root/'nginx.pid') + ';\nevents {worker_connections 128;}\nhttp {\n' + temp_paths + http_config + '\nserver { listen 127.0.0.1:' + str(listen) + '; set_real_ip_from 127.0.0.1; real_ip_header X-Fixture-IP;\n' + server_config + '\nadd_header X-Fixture-Policy $phab_traffic_policy_digest always;\n' + source_config + '\nlocation / { proxy_pass http://127.0.0.1:' + str(upstream.server_port) + '; } }\nserver { listen 127.0.0.1:' + str(reserve_port) + ';\n' + reserve_config + '\nlocation / { proxy_set_header X-Fixture-IP 89.108.64.209; proxy_pass http://127.0.0.1:' + str(listen) + '; } } }')
        base = [binary, '-p', temp, '-c', str(config)]
        checked = subprocess.run(base + ['-t'], capture_output=True, text=True)
        assert checked.returncode == 0, checked.stderr  # Fixture paths/data only, no live configuration.
        proc = subprocess.Popen(base, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        blocked_responses = 0
        last_identity = None
        last_headers = {}
        last_body = None
        def request(path, ip='203.0.113.9', method='GET', destination=None):
            nonlocal blocked_responses, last_identity
            nonlocal last_headers, last_body
            last_identity = None
            conn = http.client.HTTPConnection('127.0.0.1', destination or listen, timeout=2)
            try:
                conn.request(method, path, headers={'X-Fixture-IP': ip, 'X-Forwarded-For': '89.108.64.209', 'X-Real-IP': '188.127.235.140'})
                response = conn.getresponse(); last_identity = response.getheader('X-Fixture-Policy')
                last_headers = dict(response.getheaders()); last_body = response.read(); return response.status
            except http.client.RemoteDisconnected:
                blocked_responses += 1
                return 444
            finally: conn.close()
        def await_public_policy(expected, digest):
            # The digest probe proves that a new worker loaded the policy. Nginx
            # gracefully retires old listeners; do not pretend it is a drain barrier.
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                status = request('/lk/games?public=true')
                if status == expected and (expected == 444 or last_identity == digest): return
                time.sleep(0.05)
            raise AssertionError(f'Public policy did not converge: expected {expected}, last {status}, identity {last_identity}')
        def probe(digest):
            for _ in range(30):
                conn = http.client.HTTPConnection('127.0.0.1', probe_port, timeout=1)
                try:
                    conn.request('GET', '/traffic-policy'); got = conn.getresponse().read().decode()
                    if got == digest: return
                finally: conn.close()
                time.sleep(0.1)
            raise RuntimeError('fixture readback mismatch')
        def worker_pids():
            # This fixture's master spawns only workers. Rosetta/QEMU can hide
            # nginx's process title, so use parentage, not an args-prefix match.
            rows = subprocess.check_output(['ps', '-axo', 'pid=,ppid='], text=True).splitlines()
            return {int(parts[0]) for row in rows if len(parts := row.split()) == 2
                    and parts[1] == str(proc.pid)}
        def runner(args):
            retiring = worker_pids() if args[-2:] == ['-s', 'reload'] else set()
            if args[-2:] == ['-s', 'reload']:
                assert retiring, 'Fixture reload must observe a real worker generation'
            subprocess.run(base + args[1:], check=True, capture_output=True)
            if retiring:
                # Reload acknowledgement/digest does not drain the previous listener.
                # This isolated fixture closes every connection, so wait for its old
                # workers to exit before asserting that every new request is blocked.
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    current = worker_pids()
                    if current and not (current & retiring): return
                    time.sleep(0.05)
                raise AssertionError('Previous fixture nginx workers did not retire')
        def assert_scope(path, expected, method='GET'):
            conn = http.client.HTTPConnection('127.0.0.1', probe_port, timeout=2)
            try:
                conn.request(method, path, headers={'Connection': 'close'})
                response = conn.getresponse(); response.read()
                assert response.status == 404
                assert response.getheader('X-Phab-Traffic-Scope') == 'community-reads-v1'
                assert response.getheader('X-Phab-Traffic-Public-Read') == str(expected), (method, path)
            finally: conn.close()
        try:
            for _ in range(30):
                try:
                    if request('/health') == 200: break
                except OSError: time.sleep(0.1)
            assert request('/__phab_traffic_policy') == 403, 'Spoofed forwarding headers bypassed source ACL'
            assert request('/__phab_traffic_policy', ip='89.108.64.209') == 200
            assert last_headers.get('Cache-Control') == 'no-store'
            assert last_body == b'{"minimal":"fixture"}'
            traffic.atomic_write(exported, '{"minimal":"replaced"}', 0o644)
            assert request('/__phab_traffic_policy', ip='89.108.64.209') == 200
            assert last_body == b'{"minimal":"replaced"}', 'Nginx served an old snapshot inode'
            assert request('/__phab_traffic_policy', ip='89.108.64.209', method='HEAD') == 200
            assert last_body == b''
            assert request('/__phab_traffic_policy', ip='89.108.64.209', method='POST') == 403
            for path in ['/__phab_traffic_policy', '/__phab_traffic_policy?x=1', '/%5f_phab_traffic_policy', '/lk/../__phab_traffic_policy']:
                assert request(path, destination=reserve_port) == 404, 'Reserve exposed source snapshot: ' + path
            blocked = {'version': 1, 'revision': 1, 'rules': [{'ip': '203.0.113.9', 'expiresAt': (dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=1)).isoformat()}]}
            policy.write_text(json.dumps(blocked))
            receipt = traffic.sync_policy(policy, target, root, binary, runner, probe)
            assert receipt['appliedRevision'] == 1
            await_public_policy(444, receipt['appliedHash'])
            cases = ['/lk/games?public=true', '/lk/games?available=yes', '/lk/games?find=available',
                     '/lk/games/by-phone?public=true', '/lk/games?public=%74rue', '/lk/games?publ%69c=%31',
                     '/lk/games?p%75blic=%20%54%52%55%45%20', '/lk/games?public[]=true',
                     '/lk/games?public%5B0%5D=true', '/lk/games?public=%E2%80%83true%E2%80%83',
                     '/lk/tournaments', '/lk/tournaments/americano/history?tournamentId=synthetic',
                     '/lk/tournaments/participants?exerciseId=synthetic', '/lk/games/synthetic/participants']
            before = len(received)
            for path in cases: assert request(path) == 444, path
            assert request('/lk/tournaments/americano/history', method='HEAD') == 444
            assert len(received) == before, 'Blocked requests reached upstream'
            community_cases = [
                '/lk/communities', '/lk/communities/?view=all', '/lk/communities/synthetic',
                '/lk/communities/synthetic/feed?limit=50&beforeTs=synthetic',
                '/lk/communities/synthetic/feed/post/thread', '/lk/communities/synthetic/ranking',
                '/lk/communities/synthetic/rating', '/communities/synthetic/rating',
                '/lk/communities/synthetic/players/player/rating',
                '/communities/synthetic/players/player/rating',
                '/api/communities/public', '/api/communities/public/list',
                '/api/communities/public/feed', '/api/communities/public/feed/list',
                '/lk/communities/synthetic/feed/', '/LK/COMMUNITIES/synthetic/FEED',
                '/lk/commun%69ties/synthetic/%66eed', '/lk/communities/synthetic%2Ffeed',
                '/lk//communities/synthetic/feed', '/lk/communities/other/../synthetic/feed',
                '/lk/communities/synthetic/feed?public=false&clientId=synthetic',
                '/communities/synthetic/players/player/rating/?public=false',
                '/API/COMMUNITIES/PUBLIC/FEED/LIST/?limit=1',
            ]
            before = len(received)
            for path in community_cases:
                for method in ['GET', 'HEAD']:
                    assert request(path, method=method) == 444, (method, path)
                    assert_scope(path, 1, method)
            assert len(received) == before, 'Quarantined community reads reached upstream'
            primary_before = len(primary_log.read_text().splitlines())
            backend_before = len(received)
            for path in cases + community_cases:
                for method in ['GET', 'HEAD']:
                    assert request(path, method=method, destination=reserve_port) == 444, ('reserve', method, path)
            assert len(primary_log.read_text().splitlines()) == primary_before, 'Reserve-blocked requests reached primary'
            assert len(received) == backend_before, 'Reserve-blocked requests reached backend'
            community_allowed = [
                '/lk/communities/synthetic/messages', '/lk/communities/synthetic/messages/',
                '/lk/communities/synthetic/messages/read', '/lk/communities/synthetic/feed/post/comments',
                '/lk/communities/synthetic/feed/post/reaction', '/lk/communities/synthetic/feed/post/archive',
                '/lk/communities/synthetic/members/manage', '/lk/communities/synthetic/feed-extra',
                '/lk/communities-extra/synthetic/feed', '/lk/communities/synthetic/feed/post/thread-extra',
                '/communities/synthetic/rating-extra', '/communities/synthetic/players/player/rating-extra',
                '/api/communities', '/api/communities/synthetic', '/api/communities/publicity',
                '/api/communities/public/showcase', '/api/communities/public/feed/showcase',
                '/api/communities/public/feed/list-extra', '/api/communities/public/feed/list/extra',
                '/lk/media/community-logo/synthetic/thumb', '/lk/chats/by-phone?clientId=synthetic',
                '/api/messenger/dialogs', '/lk/auth', '/api/payment/fixture',
            ]
            for path in community_allowed:
                for method in ['GET', 'HEAD']:
                    assert request(path, method=method) == 200, (method, path)
                    assert_scope(path, 0, method)
                    assert request(path, method=method, destination=reserve_port) == 200, ('reserve', method, path)
            for path in community_cases:
                for method in ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']:
                    assert request(path, method=method) == 200, (method, path)
                    assert_scope(path, 0, method)
                    assert request(path, method=method, destination=reserve_port) == 200, ('reserve', method, path)
                for ip in ['188.127.235.140', '203.0.113.10']:
                    assert request(path, ip=ip) == 200, (ip, path)
                    assert request(path, ip=ip, destination=reserve_port) == 200, ('reserve', ip, path)
            for path in ['/lk/games?phone=%2B79990000000', '/lk/games/by-phone?clientId=synthetic',
                         '/lk/games?public=false&clientId=synthetic', '/lk/games/pay_fixture/result/state', '/api/health']:
                assert request(path) == 200, path
            assert request('/lk/games?public=true', method='POST') == 200
            assert request('/lk/games?public=true', method='OPTIONS') == 200
            assert last_headers.get('Access-Control-Allow-Origin') == 'https://fixture.invalid'
            assert request('/lk/games?public=true', method='OPTIONS', destination=reserve_port) == 200
            assert last_headers.get('Access-Control-Allow-Origin') == 'https://fixture.invalid'
            for path in ['/lk/chats', '/lk/subscription-bookings', '/api/payment/fixture']:
                assert request(path, method='POST') == 200
            assert request('/lk/games?public=true', ip='188.127.235.140') == 200
            assert request('/lk/games?public=true', ip='203.0.113.10') == 200
            policy.write_text(json.dumps({**empty, 'revision': 2}))
            receipt = traffic.sync_policy(policy, target, root, binary, runner, probe)
            await_public_policy(200, receipt['appliedHash'])
            for path in community_cases: assert request(path) == 200, path
            for path in cases + community_cases:
                assert request(path, destination=reserve_port) == 200, ('reserve removal', path)
            # Exercise later generations with the same effective empty/blocked lists.
            # Each sync must acknowledge that revision, not an earlier matching list.
            for revision in range(3, 9):
                current = {**(blocked if revision % 2 else empty), 'revision': revision}
                policy.write_text(json.dumps(current))
                receipt = traffic.sync_policy(policy, target, root, binary, runner, probe)
                assert receipt['appliedRevision'] == revision
                assert receipt['appliedHash'] == traffic.render_policy(current)[2]
                await_public_policy(444 if revision % 2 else 200, receipt['appliedHash'])
                assert request('/lk/communities/synthetic/feed') == (444 if revision % 2 else 200)
            # Rehearse removing the route scope while an IP remains quarantined.
            # Policy digest is unchanged; scope probes identify the config generation.
            active = {**blocked, 'revision': 9}
            policy.write_text(json.dumps(active))
            receipt = traffic.sync_policy(policy, target, root, binary, runner, probe)
            await_public_policy(444, receipt['appliedHash'])
            candidate = config.read_text()
            previous = '\n'.join(line for line in candidate.splitlines()
                                 if not ('~*^(GET|HEAD)' in line and 'communities' in line)
                                 and 'add_header X-Phab-Traffic-' not in line)
            config.write_text(previous)
            runner([binary, '-t']); runner([binary, '-s', 'reload']); probe(receipt['appliedHash'])
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                if request('/lk/communities/synthetic/feed') == 200: break
                time.sleep(0.05)
            else: raise AssertionError('Previous community scope did not return after rollback')
            assert request('/lk/games?public=true') == 444, 'Rollback removed existing quarantine'
            config.write_text(candidate)
            runner([binary, '-t']); runner([binary, '-s', 'reload']); probe(receipt['appliedHash'])
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                if request('/lk/communities/synthetic/feed') == 444: break
                time.sleep(0.05)
            else: raise AssertionError('Community scope did not return after reapplication')
            assert_scope('/lk/communities/synthetic/feed', 1)
            # Preserve reserve receipt coverage after the community rollback/reapply.
            policy.unlink()  # Start the independently monotonic replica store.
            snapshot = {**blocked, 'revision': 10, 'sourceGeneratedAt': dt.datetime.now(dt.timezone.utc).isoformat()}
            receipt = replica.replica_sync(policy, target, root, fetch=lambda: json.dumps(snapshot).encode(),
                sync=lambda *args: traffic.sync_policy(*args, binary, runner, probe))
            assert receipt['receivedRevision'] == receipt['appliedRevision'] == 10
            await_public_policy(444, receipt['appliedHash'])
            assert request('/lk/communities/synthetic/feed') == 444
            # A genuinely unreachable next hop must not affect reserve drops.
            candidate = config.read_text()
            hop = 'proxy_pass http://127.0.0.1:' + str(listen) + ';'
            assert candidate.count(hop) == 1
            config.write_text(candidate.replace(hop, 'proxy_pass http://127.0.0.1:' + str(port()) + ';'))
            runner([binary, '-t']); runner([binary, '-s', 'reload']); probe(receipt['appliedHash'])
            assert request('/health', destination=reserve_port) == 502, 'Offline primary was not exercised'
            primary_before = len(primary_log.read_text().splitlines())
            backend_before = len(received)
            for path in ['/lk/games?public=true', '/lk/communities/synthetic/feed']:
                for method in ['GET', 'HEAD']:
                    assert request(path, method=method, destination=reserve_port) == 444
            assert len(primary_log.read_text().splitlines()) == primary_before
            assert len(received) == backend_before
            config.write_text(candidate)
            runner([binary, '-t']); runner([binary, '-s', 'reload']); probe(receipt['appliedHash'])
            # Advance only the isolated policy clock; a failed transfer must still
            # expire the last accepted rules and reload actual nginx on both hops.
            original_render = traffic.render_policy
            after_expiry = dt.datetime.fromisoformat(blocked['rules'][0]['expiresAt']) + dt.timedelta(seconds=1)
            def unavailable_source(): raise OSError('fixture source unavailable')
            with patch.object(traffic, 'render_policy', side_effect=lambda value, now=None: original_render(value, after_expiry)):
                try:
                    replica.replica_sync(policy, target, root, fetch=unavailable_source,
                        sync=lambda *args: traffic.sync_policy(*args, binary, runner, probe))
                except RuntimeError as error:
                    assert str(error) == 'replica_failed_check_receipts'
                else:
                    raise AssertionError('Fetch failure was hidden')
            expired = json.loads((root / 'replica-status.json').read_text())
            assert expired['receivedRevision'] == expired['appliedRevision'] == 10
            assert expired['fetchError'] == 'replica_fetch_failed' and expired['applyError'] is None
            assert json.loads(policy.read_text()) == snapshot, 'Failure changed the accepted watermark'
            for destination in [listen, reserve_port]:
                for path in ['/lk/games?public=true', '/lk/communities/synthetic/feed']:
                    assert request(path, destination=destination) == 200, ('expiry', destination, path)
        finally:
            subprocess.run(base + ['-s', 'quit'], check=False, capture_output=True)
            proc.wait(timeout=10); upstream.shutdown()
        lines = [json.loads(line) for line in log.read_text().splitlines()]
        assert blocked_responses >= len(cases) + 4
        assert sum(e['blocked'] == 1 and e['status'] == 444 for e in lines) == blocked_responses
        assert all(set(e) == {'id','ts','ip','method','route','status','bytes','blocked'} for e in lines)
        assert '79990000000' not in log.read_text()
        db = traffic.open_database(root / 'stats.sqlite'); traffic.ingest(db, [log])
        day = dt.datetime.now(traffic.MSK).date().isoformat(); report = traffic.report_day(db, day)
        assert report['blocked'] == blocked_responses
        assert report['quarantined']['203.0.113.9']['blocked'] == blocked_responses
        db.close()
        print('nginx e2e passed: primary/reserve zero-hop drops, community scope, ACL/CORS/mutations, offline primary, replica receipt/expiry under failed transfer, scope rollback, sanitized logs and collector')


if __name__ == '__main__': main(sys.argv[1])
