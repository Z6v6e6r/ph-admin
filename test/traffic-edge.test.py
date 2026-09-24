import datetime as dt
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys

spec = importlib.util.spec_from_file_location('traffic', Path(__file__).parents[1] / 'scripts/traffic-edge.py')
traffic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(traffic)


class TrafficTest(unittest.TestCase):
    def policy(self, ip='203.0.113.9', revision=1):
        return {'version': 1, 'revision': revision, 'rules': [{'ip': ip, 'expiresAt': (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)).isoformat()}]}

    def test_normalization_and_protected_sources(self):
        self.assertEqual(traffic.normalize_ip('::ffff:188.127.235.140'), '188.127.235.140')
        for ip in ['188.127.235.140', '::ffff:188.127.235.140', '127.0.0.1', '10.0.0.1', 'bad; return 200', '1.2.3.4/24', '2001:db8::1%zone;\n0.0.0.0']:
            with self.assertRaises(ValueError): traffic.render_policy(self.policy(ip))
        p = self.policy(); p['rules'][0]['expiresAt'] = '2020-01-01T00:00:00Z'
        self.assertEqual(traffic.render_policy(p)[1], [])

    def test_sync_rollback_and_readback(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); policy = root / 'policy.json'; target = root / 'policy.conf'
            old = traffic.render_policy({'version': 1, 'revision': 0, 'rules': []})[0]
            target.write_text(old); policy.write_text(json.dumps(self.policy()))
            calls = []
            def runner(command): calls.append(command)
            def fail_probe(digest): raise RuntimeError('new worker not serving policy')
            with self.assertRaises(RuntimeError): traffic.sync_policy(policy, target, root, runner=runner, probe=fail_probe)
            self.assertEqual(target.read_text(), old)
            self.assertNotIn('appliedRevision', json.loads((root / 'edge-status.json').read_text()))
            status = traffic.sync_policy(policy, target, root, runner=runner, probe=lambda digest: None)
            self.assertEqual(status['appliedRevision'], 1)
            p = self.policy('188.127.235.140', 2); policy.write_text(json.dumps(p)); before = target.read_text()
            with self.assertRaises(RuntimeError): traffic.sync_policy(policy, target, root, runner=runner, probe=lambda digest: None)
            self.assertEqual(target.read_text(), before)
            self.assertEqual(json.loads((root / 'edge-status.json').read_text())['appliedRevision'], 1)

    def test_rotation_replay_partial_tail_midnight_and_top20(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); db = traffic.open_database(root / 'db.sqlite'); log = root / 'access'
            today = dt.datetime.now(traffic.MSK).date()
            stamp = dt.datetime.combine(today, dt.time(0, 0), traffic.MSK).astimezone(dt.timezone.utc)
            def event(seconds, ip='203.0.113.9', **kw):
                e = dict(id=str(seconds), ts=(stamp + dt.timedelta(seconds=seconds)).isoformat(), ip=ip,
                         method='GET', route='history', status=200, bytes=100, blocked=0)
                e.update(kw); return json.dumps(e).encode() + b'\n'
            first = event(-1) + event(0, blocked=1, status=444) + event(1, method='OPTIONS')
            partial = event(2); log.write_bytes(first + partial[:20])
            traffic.ingest(db, [log]); self.assertEqual(traffic.report_day(db, today.isoformat())['requests'], 1)
            with log.open('ab') as out: out.write(partial[20:])
            traffic.ingest(db, [log]); traffic.ingest(db, [log])
            report = traffic.report_day(db, today.isoformat())
            self.assertEqual((report['requests'], report['blocked'], report['options']), (2, 1, 1))
            self.assertEqual(report['top'][0]['peakPerMinute'], 2)
            self.assertEqual(traffic.report_day(db, (today-dt.timedelta(days=1)).isoformat())['requests'], 1)
            rotated = root / 'access.1'; log.rename(rotated)
            traffic.ingest(db, [rotated])
            with gzip.open(root / 'access.1.gz', 'wb') as out: out.write(rotated.read_bytes())
            traffic.ingest(db, [root / 'access.1.gz'])
            log.write_bytes(b''.join(event(i+20, ip='203.0.113.'+str(i+20)) for i in range(25)))
            traffic.ingest(db, [log, rotated, root / 'access.1.gz'])
            report = traffic.report_day(db, today.isoformat())
            self.assertEqual(report['requests'], 27); self.assertEqual(len(report['top']), 20)
            self.assertEqual(report['top'][0]['ip'], '203.0.113.9')
            self.assertNotIn('phone', json.dumps(report)); self.assertNotIn('query', json.dumps(report))
            db.close()

    def test_pending_report_survives_crash_after_database_commit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); log = root / 'access'; db_path = root / 'stats.sqlite'
            day = (dt.datetime.now(traffic.MSK) - dt.timedelta(days=3)).date().isoformat()
            log.write_text(json.dumps(dict(id='old-fixture', ts=day+'T12:00:00+03:00', ip='203.0.113.8', method='GET', route='schedule', status=200, bytes=20, blocked=0))+'\n')
            db = traffic.open_database(db_path); traffic.ingest(db, [log]); db.close()
            self.assertFalse((root / (day+'.json')).exists())  # Simulated crash before publishing reports.
            result = subprocess.run([sys.executable, str(Path(__file__).parents[1] / 'scripts/traffic-edge.py'), 'collect',
                                     '--database', str(db_path), '--reports', str(root), '--logs', str(log)], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(json.loads((root / (day+'.json')).read_text())['requests'], 1)


if __name__ == '__main__': unittest.main()
