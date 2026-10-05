#!/usr/bin/env python3
"""Single-host nginx quarantine controller and incremental, privacy-preserving traffic reports.

No network/DB credentials. Root-owned deployment settings, never command strings from CUP.
The sync command changes nginx ONLY when explicitly provisioned/enabled by an operator.
"""
import argparse
import datetime as dt
import fcntl
import glob
import gzip
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time
import urllib.request

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None

MSK = dt.timezone(dt.timedelta(hours=3))
PROTECTED = {'188.127.235.140'}
ROUTES = {'schedule', 'history', 'tournaments', 'participants', 'other'}


def iso_now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def normalize_ip(value):
    if not isinstance(value, str) or value != value.strip() or '%' in value:
        raise ValueError('invalid_ip')
    ip = ipaddress.ip_address(value)
    return str(ip.ipv4_mapped if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped else ip)


def protected(ip):
    address = ipaddress.ip_address(ip)
    nets = ['0.0.0.0/8', '10.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16',
            '172.16.0.0/12', '192.168.0.0/16', '::/128', '::1/128', 'fc00::/7', 'fe80::/10']
    return ip in PROTECTED or any(address in ipaddress.ip_network(n) for n in nets)


def atomic_write(path, value, mode=0o640):
    path = Path(path)
    fd, tmp = tempfile.mkstemp(prefix='.traffic-', dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'w') as out:
            out.write(value)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def render_policy(policy, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    if policy.get('version') != 1 or type(policy.get('revision')) is not int or policy['revision'] < 0:
        raise ValueError('invalid_policy')
    rules = policy.get('rules')
    if not isinstance(rules, list) or len(rules) > 1000:
        raise ValueError('invalid_rules')
    seen, active = set(), []
    for rule in rules:
        ip = normalize_ip(rule['ip'])
        if ip != rule['ip'] or protected(ip) or ip in seen:
            raise ValueError('invalid_or_protected_ip')
        seen.add(ip)
        expires = dt.datetime.fromisoformat(rule['expiresAt'].replace('Z', '+00:00'))
        if expires.tzinfo is None:
            raise ValueError('missing_timezone')
        if expires > now:
            active.append(ip)
    rules_text = ''.join(f'{ip} 1;\n' for ip in sorted(active))
    # A later empty policy must not match a still-draining worker's earlier empty
    # policy (ABA). Active IPs also belong in the identity: expiry changes nginx
    # behavior without advancing the administrator's revision.
    identity = json.dumps({'protocol': 2, 'revision': policy['revision'], 'active': sorted(active)},
                          sort_keys=True, separators=(',', ':'))
    digest = hashlib.sha256(identity.encode()).hexdigest()
    config = 'geo $remote_addr $phab_quarantined {\ndefault 0;\n' + rules_text + '}\n'
    config += 'map $host $phab_traffic_policy_digest { default "' + digest + '"; }\n'
    return config, sorted(active), digest


def run_checked(command):
    # Suppress config/error output: it may contain unrelated deployment details.
    subprocess.run(command, check=True, capture_output=True, timeout=20)


def readback(digest):
    for _ in range(30):
        try:
            # Fixed loopback URL, no redirects, no proxy env, no credential forwarding.
            request = urllib.request.Request('http://127.0.0.1:18147/traffic-policy', headers={'Connection': 'close'})
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
            with opener.open(request, timeout=1) as response:
                if response.geturl() == request.full_url and response.read(100).decode() == digest:
                    return
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise RuntimeError('policy_readback_failed')


def sync_policy(policy_path, target, reports, nginx='/usr/sbin/nginx', runner=run_checked, probe=readback):
    reports = Path(reports)
    status_file = reports / 'edge-status.json'
    previous = json.loads(status_file.read_text()) if status_file.exists() else {}
    status = {**previous, 'checkedAt': iso_now(), 'error': None}
    try:
        path = Path(policy_path)
        if path.stat().st_size > 2_000_000:
            raise ValueError('oversize_policy')
        policy = json.loads(path.read_text())
        desired, active, digest = render_policy(policy)
        if policy['revision'] < previous.get('appliedRevision', 0):
            raise ValueError('revision_regression')
        status['desiredRevision'] = policy['revision']
        # Target must be provisioned by root, outside CUP-writable directories.
        target = Path(target)
        before = target.read_text()
        changed = before != desired
        # Missing/mismatching receipt cannot prove an existing file was actually loaded.
        needs_reload = changed or previous.get('appliedHash') != digest or previous.get('error')
        if needs_reload:
            if changed:
                atomic_write(target, desired, 0o644)
            try:
                runner([nginx, '-t'])
                runner([nginx, '-s', 'reload'])
                probe(digest)
            except Exception:
                if changed:
                    atomic_write(target, before, 0o644)
                    runner([nginx, '-t'])
                    runner([nginx, '-s', 'reload'])
                raise
        else:
            probe(digest)
        status.update(appliedRevision=policy['revision'], appliedHash=digest,
                      appliedAt=iso_now(), activeIps=active)
    except Exception:
        # Never acknowledge an untested revision; retain the previous confirmed snapshot.
        status['error'] = 'sync_failed_check_service_journal'
    atomic_write(status_file, json.dumps(status))
    if status['error']:
        raise RuntimeError(status['error'])
    return status


def open_database(path):
    db = sqlite3.connect(path)
    db.execute('PRAGMA journal_mode=WAL')
    db.executescript('''
      CREATE TABLE IF NOT EXISTS cursors (id TEXT PRIMARY KEY, offset INTEGER, size INTEGER, mtime INTEGER);
      CREATE TABLE IF NOT EXISTS counts (
        day TEXT, ip TEXT, route TEXT, requests INTEGER, blocked INTEGER, errors INTEGER,
        bytes INTEGER, options INTEGER, first TEXT, last TEXT, PRIMARY KEY(day,ip,route));
      CREATE TABLE IF NOT EXISTS minutes (day TEXT, ip TEXT, minute TEXT, n INTEGER, PRIMARY KEY(day,ip,minute));
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS pending_reports (day TEXT PRIMARY KEY);
    ''')
    return db


def parse_event(line):
    raw = json.loads(line)
    stamp = dt.datetime.fromisoformat(raw['ts'].replace('Z', '+00:00'))
    if stamp.tzinfo is None:
        raise ValueError('timezone_missing')
    stamp = stamp.astimezone(MSK)
    ip = normalize_ip(raw['ip'])
    method = raw['method']
    if method not in {'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE', 'CONNECT', 'TRACE', 'OTHER'}:
        raise ValueError('method_invalid')
    route = raw['route']
    if route not in ROUTES or type(raw['status']) is not int or not 100 <= raw['status'] <= 599:
        raise ValueError('route_or_status_invalid')
    if type(raw['bytes']) is not int or raw['bytes'] < 0 or raw['blocked'] not in (0, 1):
        raise ValueError('counters_invalid')
    # A map match alone does not prove rejection. Count actual nginx 444 outcomes.
    blocked = int(raw['blocked'] == 1 and raw['status'] == 444)
    return stamp, ip, route, int(method != 'OPTIONS'), blocked, int(raw['status'] >= 500), raw['bytes'], int(method == 'OPTIONS')


def ingest(db, paths):
    touched = set()
    rejected = 0
    cutoff = (dt.datetime.now(MSK) - dt.timedelta(days=90)).date().isoformat()
    for path in sorted(set(map(str, paths))):
        st = os.stat(path)
        compressed = path.endswith('.gz')
        with (gzip.open(path, 'rb') if compressed else open(path, 'rb')) as log:
            first = log.readline(16385)
            if len(first) > 16384:
                raise RuntimeError('oversize_log_line')
            if not first.endswith(b'\n'):
                continue
            # The dedicated single log stream keeps identity through rename AND gzip;
            # copies/replayed rotations are the same stream, not new requests.
            identity = hashlib.sha256(first).hexdigest()
            row = db.execute('SELECT offset,size,mtime FROM cursors WHERE id=?', (identity,)).fetchone()
            if row and row[1:] == (st.st_size, st.st_mtime_ns):
                continue
            offset = row[0] if row else 0
            if not compressed and st.st_size < offset:
                raise RuntimeError('copytruncate_not_supported')
            log.seek(offset)
            batch_lines = 0
            with db:
                while True:
                    line = log.readline(16385)
                    if not line:
                        break
                    if not line.endswith(b'\n'):
                        if len(line) > 16384:
                            raise RuntimeError('oversize_log_line')
                        break  # Leave incomplete tail for the next run.
                    offset = log.tell()
                    batch_lines += 1
                    try:
                        stamp, ip, route, count, blocked, errors, size, options = parse_event(line)
                    except (ValueError, KeyError, TypeError):
                        rejected += 1
                        continue
                    day = stamp.date().isoformat()
                    if day < cutoff:
                        continue
                    touched.add(day)
                    db.execute('INSERT OR IGNORE INTO pending_reports VALUES(?)', (day,))
                    db.execute('''INSERT INTO metadata VALUES('coverageStart',?) ON CONFLICT(key)
                      DO UPDATE SET value=MIN(value,excluded.value)''', (stamp.isoformat(),))
                    db.execute('''INSERT INTO counts VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(day,ip,route)
                      DO UPDATE SET requests=requests+excluded.requests, blocked=blocked+excluded.blocked,
                      errors=errors+excluded.errors, bytes=bytes+excluded.bytes, options=options+excluded.options,
                      first=MIN(first,excluded.first),last=MAX(last,excluded.last)''',
                               (day, ip, route, count, blocked, errors, size, options, stamp.isoformat(), stamp.isoformat()))
                    if count:
                        db.execute('''INSERT INTO minutes VALUES(?,?,?,1) ON CONFLICT(day,ip,minute)
                          DO UPDATE SET n=n+1''', (day, ip, stamp.isoformat()[:16]))
                    if batch_lines >= 10000:
                        # An interrupted large backlog resumes from the committed offset;
                        # size=-1 prevents mistaking a partial checkpoint for a finished file.
                        db.execute('INSERT OR REPLACE INTO cursors VALUES(?,?,?,?)', (identity, offset, -1, st.st_mtime_ns))
                        db.commit()
                        batch_lines = 0
                db.execute('INSERT OR REPLACE INTO cursors VALUES(?,?,?,?)', (identity, offset, st.st_size, st.st_mtime_ns))
    with db:
        db.execute('DELETE FROM counts WHERE day<?', (cutoff,))
        db.execute('DELETE FROM minutes WHERE day<?', (cutoff,))
        old_rejected = db.execute("SELECT value FROM metadata WHERE key='rejected'").fetchone()
        db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)', ('rejected', str(rejected + int(old_rejected[0] if old_rejected else 0))))
    return touched


def report_day(db, day):
    fields = ['ip', 'requests', 'blocked', 'errors', 'bytes', 'options', 'first', 'last']
    top = [dict(zip(fields, row)) for row in db.execute('''SELECT ip,SUM(requests),SUM(blocked),SUM(errors),SUM(bytes),SUM(options),MIN(first),MAX(last)
      FROM counts WHERE day=? GROUP BY ip HAVING SUM(requests)>0 ORDER BY SUM(requests) DESC,ip LIMIT 20''', (day,))]
    for item in top:
        item['routes'] = dict(db.execute('SELECT route,requests FROM counts WHERE day=? AND ip=?', (day, item['ip'])))
        item['peakPerMinute'] = db.execute('SELECT MAX(n) FROM minutes WHERE day=? AND ip=?', (day, item['ip'])).fetchone()[0] or 0
        item['protected'] = item['ip'] in PROTECTED
    totals = db.execute('SELECT COALESCE(SUM(requests),0),COALESCE(SUM(blocked),0),COALESCE(SUM(options),0),MAX(last) FROM counts WHERE day=?', (day,)).fetchone()
    rejected = db.execute("SELECT value FROM metadata WHERE key='rejected'").fetchone()
    start = db.execute("SELECT value FROM metadata WHERE key='coverageStart'").fetchone()
    quarantined = {row[0]: dict(blocked=row[1], first=row[2], last=row[3]) for row in db.execute('''
      SELECT ip,SUM(blocked),MIN(first),MAX(last) FROM counts WHERE day=? GROUP BY ip HAVING SUM(blocked)>0
      ORDER BY SUM(blocked) DESC,ip LIMIT 1000''', (day,))}
    return dict(version=1, day=day, timezone='Europe/Moscow', generatedAt=iso_now(), top=top,
                requests=totals[0], blocked=totals[1], options=totals[2], lastEventAt=totals[3],
                quarantined=quarantined, coverageStartedAt=start[0] if start else None,
                partialDay=not start or day <= start[0][:10] or day >= dt.datetime.now(MSK).date().isoformat(),
                rejectedLinesTotal=int(rejected[0] if rejected else 0),
                coverage='Since collector initialization; HTTP except OPTIONS; one dedicated nginx stream')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['sync', 'collect'])
    parser.add_argument('--policy', default='/var/lib/ph-admin/traffic/quarantine.json')
    parser.add_argument('--target', default='/etc/nginx/phab-traffic/policy.conf')
    parser.add_argument('--reports', default='/var/lib/phab-traffic/reports')
    parser.add_argument('--database', default='/var/lib/phab-traffic/traffic.sqlite')
    parser.add_argument('--logs', default='/var/log/nginx/phab-traffic.jsonl*')
    args = parser.parse_args()
    os.umask(0o027)
    # Separate locks: a slow collector cannot delay removal/expiry of a quarantine rule.
    with open(Path(args.reports) / f'.{args.command}.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.command == 'sync':
            sync_policy(args.policy, args.target, args.reports)
        else:
            paths = glob.glob(args.logs)
            if not paths:
                raise RuntimeError('no_traffic_logs')
            db = open_database(args.database)
            try:
                days = ingest(db, paths)
                days.update(row[0] for row in db.execute('SELECT day FROM pending_reports'))
                today = dt.datetime.now(MSK).date()
                days.update([today.isoformat(), (today - dt.timedelta(days=1)).isoformat()])
                for day in days:
                    atomic_write(Path(args.reports) / f'{day}.json', json.dumps(report_day(db, day)))
                    with db:
                        db.execute('DELETE FROM pending_reports WHERE day=?', (day,))
                for old in Path(args.reports).glob('????-??-??.json'):
                    if old.stem < (today - dt.timedelta(days=90)).isoformat():
                        old.unlink()
            finally:
                db.close()


if __name__ == '__main__':
    main()
