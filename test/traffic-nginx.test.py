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

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('traffic', ROOT / 'scripts/traffic-edge.py')
traffic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(traffic)


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); return sock.getsockname()[1]


def main(binary):
    received = []
    class Upstream(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            received.append((self.command, self.path)); self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
        do_HEAD = do_POST = do_OPTIONS = do_GET
        def log_message(self, *args): pass
    upstream = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='traffic-nginx-') as temp:
        root = Path(temp); (root / 'logs').mkdir(); listen, probe_port = port(), port()
        target, policy, log = root / 'policy.conf', root / 'policy.json', root / 'access.jsonl'
        empty = {'version': 1, 'revision': 0, 'rules': []}
        target.write_text(traffic.render_policy(empty)[0]); policy.write_text(json.dumps(empty))
        http_config = (ROOT / 'deploy/traffic/http.conf').read_text().replace('/etc/nginx/phab-traffic/policy.conf', str(target)).replace('127.0.0.1:18147', '127.0.0.1:' + str(probe_port))
        server_config = (ROOT / 'deploy/traffic/server.conf').read_text().replace('/var/log/nginx/phab-traffic.jsonl', str(log))
        config = root / 'nginx.conf'
        # Only this fixture trusts its local test client as an ingress proxy.
        config.write_text('daemon off; worker_processes 1; error_log ' + str(root/'error.log') + '; pid ' + str(root/'nginx.pid') + ';\nevents {worker_connections 128;}\nhttp {\n' + http_config + '\nserver { listen 127.0.0.1:' + str(listen) + '; set_real_ip_from 127.0.0.1; real_ip_header X-Fixture-IP;\n' + server_config + '\nlocation / { proxy_pass http://127.0.0.1:' + str(upstream.server_port) + '; } } }')
        base = [binary, '-p', temp, '-c', str(config)]
        subprocess.run(base + ['-t'], check=True, capture_output=True)
        proc = subprocess.Popen(base, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        def request(path, ip='203.0.113.9', method='GET'):
            conn = http.client.HTTPConnection('127.0.0.1', listen, timeout=2)
            try:
                conn.request(method, path, headers={'X-Fixture-IP': ip, 'X-Forwarded-For': '188.127.235.140'})
                response = conn.getresponse(); response.read(); return response.status
            except http.client.RemoteDisconnected:
                return 444
            finally: conn.close()
        def probe(digest):
            for _ in range(30):
                conn = http.client.HTTPConnection('127.0.0.1', probe_port, timeout=1)
                try:
                    conn.request('GET', '/traffic-policy'); got = conn.getresponse().read().decode()
                    if got == digest: return
                finally: conn.close()
                time.sleep(0.1)
            raise RuntimeError('fixture readback mismatch')
        def runner(args): subprocess.run(base + args[1:], check=True, capture_output=True)
        try:
            for _ in range(30):
                try:
                    if request('/health') == 200: break
                except OSError: time.sleep(0.1)
            blocked = {'version': 1, 'revision': 1, 'rules': [{'ip': '203.0.113.9', 'expiresAt': (dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=1)).isoformat()}]}
            policy.write_text(json.dumps(blocked))
            receipt = traffic.sync_policy(policy, target, root, binary, runner, probe)
            assert receipt['appliedRevision'] == 1
            cases = ['/lk/games?public=true', '/lk/games?available=yes', '/lk/games?find=available',
                     '/lk/games/by-phone?public=true', '/lk/games?public=%74rue', '/lk/games?publ%69c=%31',
                     '/lk/games?p%75blic=%20%54%52%55%45%20', '/lk/games?public[]=true',
                     '/lk/games?public%5B0%5D=true', '/lk/games?public=%E2%80%83true%E2%80%83',
                     '/lk/tournaments', '/lk/tournaments/americano/history?tournamentId=synthetic',
                     '/lk/tournaments/participants?exerciseId=synthetic', '/lk/games/synthetic/participants']
            before = len(received)
            for path in cases: assert request(path) == 444, path
            assert len(received) == before, 'Blocked requests reached upstream'
            for path in ['/lk/games?phone=%2B79990000000', '/lk/games/by-phone?clientId=synthetic',
                         '/lk/games?public=false&clientId=synthetic', '/lk/games/pay_fixture/result/state', '/api/health']:
                assert request(path) == 200, path
            assert request('/lk/games?public=true', method='POST') == 200
            assert request('/lk/games?public=true', method='OPTIONS') == 200
            assert request('/lk/games?public=true', ip='188.127.235.140') == 200
            assert request('/lk/games?public=true', ip='203.0.113.10') == 200
            policy.write_text(json.dumps({**empty, 'revision': 2}))
            traffic.sync_policy(policy, target, root, binary, runner, probe)
            assert request('/lk/games?public=true') == 200
        finally:
            subprocess.run(base + ['-s', 'quit'], check=False, capture_output=True)
            proc.wait(timeout=10); upstream.shutdown()
        lines = [json.loads(line) for line in log.read_text().splitlines()]
        assert sum(e['blocked'] == 1 and e['status'] == 444 for e in lines) == len(cases)
        assert all(set(e) == {'id','ts','ip','method','route','status','bytes','blocked'} for e in lines)
        assert '79990000000' not in log.read_text()
        db = traffic.open_database(root / 'stats.sqlite'); traffic.ingest(db, [log])
        day = dt.datetime.now(traffic.MSK).date().isoformat(); report = traffic.report_day(db, day)
        assert report['blocked'] == len(cases)
        assert report['quarantined']['203.0.113.9']['blocked'] == len(cases)
        db.close()
        print('nginx e2e passed: aliases/encoded flags, public-only drop, zero upstream calls, protected IP, POST/OPTIONS/private reads, readback/removal, sanitized logs and collector')


if __name__ == '__main__': main(sys.argv[1])
