#!/usr/bin/env python3
"""Read-only quarantine replica. Fixed HTTPS peer; no credentials or CUP writer.

Export a minimal snapshot on 147; fetch it on 89. Local edge sync always runs,
even after a failed fetch, so an outage never extends a received rule's expiry.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import urllib.request

spec = importlib.util.spec_from_file_location('traffic_edge', Path(__file__).resolve().with_name('traffic-edge.py'))
edge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(edge)

SOURCE_URL = 'https://padlhub.su/__phab_traffic_policy'
MAX_BYTES = 1_000_000
MAX_AGE = 180
PEERS = {'147.45.103.3', '89.108.64.209'}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate_json_key')
        result[key] = value
    return result


def decode(raw, limit=MAX_BYTES):
    if len(raw) > limit:
        raise ValueError('oversize_snapshot')
    return json.loads(raw, object_pairs_hook=unique_object)


def read_limited(path, limit=MAX_BYTES):
    with Path(path).open('rb') as stream:
        return decode(stream.read(limit + 1), limit)


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('invalid_timestamp')
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('missing_timezone')
    return parsed


def project(policy):
    if not isinstance(policy, dict) or type(policy.get('version')) is not int or policy['version'] != 1:
        raise ValueError('invalid_policy')
    rules = policy.get('rules')
    if not isinstance(rules, list) or len(rules) > 1000:
        raise ValueError('invalid_rules')
    minimal = {'version': 1, 'revision': policy.get('revision'), 'rules': []}
    for rule in rules:
        if not isinstance(rule, dict) or rule.get('ip') in PEERS:
            raise ValueError('invalid_rule_or_proxy_ip')
        expires = timestamp(rule.get('expiresAt'))
        minimal['rules'].append({'ip': rule.get('ip'), 'expiresAt': expires.astimezone(dt.timezone.utc).isoformat()})
    edge.render_policy(minimal)  # Exact canonical IPs, protected sources, duplicates, revision.
    minimal['rules'].sort(key=lambda rule: rule['ip'])
    return minimal


def identity(policy):
    return hashlib.sha256(json.dumps(project(policy), sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def snapshot(value):
    if not isinstance(value, dict) or set(value) != {'version', 'revision', 'rules', 'sourceGeneratedAt'}:
        raise ValueError('invalid_snapshot')
    if not isinstance(value['rules'], list) or any(not isinstance(rule, dict) or set(rule) != {'ip', 'expiresAt'} for rule in value['rules']):
        raise ValueError('invalid_snapshot_rule')
    policy = project(value)
    timestamp(value['sourceGeneratedAt'])
    return {**policy, 'sourceGeneratedAt': value['sourceGeneratedAt']}


def monotonic(current, previous):
    if current['revision'] < previous['revision']:
        raise ValueError('revision_regression')
    if current['revision'] == previous['revision'] and identity(current) != identity(previous):
        raise ValueError('same_revision_changed')
    if timestamp(current['sourceGeneratedAt']) < timestamp(previous['sourceGeneratedAt']):
        raise ValueError('source_clock_regression')


def export_policy(source, target, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    current = {**project(read_limited(source, 2_000_000)), 'sourceGeneratedAt': now.isoformat()}
    target = Path(target)
    if target.exists():
        monotonic(current, snapshot(read_limited(target)))
    # Directory is root-owned, readable by nginx; only the sanitized projection is served.
    edge.atomic_write(target, json.dumps(current), 0o644)
    return current


def fetch_snapshot():
    # Default TLS CA + hostname verification, fixed URL, no proxy environment, no redirect.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), edge.NoRedirect())
    request = urllib.request.Request(SOURCE_URL, headers={'Connection': 'close', 'Cache-Control': 'no-cache'})
    def expired(*_):
        raise TimeoutError('source_deadline')
    previous = signal.signal(signal.SIGALRM, expired)
    signal.alarm(12)  # Bound the whole transfer, including a trickling response body.
    try:
        with opener.open(request, timeout=8) as response:
            if response.status != 200 or response.geturl() != SOURCE_URL:
                raise ValueError('unexpected_source_response')
            return response.read(MAX_BYTES + 1)
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)


def receive(raw, path, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    current = snapshot(decode(raw))
    age = (now - timestamp(current['sourceGeneratedAt'])).total_seconds()
    if age > MAX_AGE or age < -60:
        raise ValueError('stale_or_future_source')
    path = Path(path)
    if path.exists():
        monotonic(current, snapshot(read_limited(path)))
    # The accepted file itself is the monotonic watermark, even if nginx apply fails.
    edge.atomic_write(path, json.dumps(current))
    return current


def replica_sync(policy, target, reports, fetch=fetch_snapshot, sync=edge.sync_policy):
    status_path = Path(reports) / 'replica-status.json'
    try:
        previous = read_limited(status_path) if status_path.exists() else {}
        if not isinstance(previous, dict):
            previous = {}
    except (OSError, ValueError):
        previous = {}  # A damaged receipt must not prevent local expiry.
    status = {**previous, 'checkedAt': edge.iso_now(), 'fetchError': None, 'applyError': None}
    try:
        current = receive(fetch(), policy)
        status.update(sourceFetchedAt=edge.iso_now(), sourceGeneratedAt=current['sourceGeneratedAt'],
                      receivedRevision=current['revision'], receivedHash=identity(current))
    except Exception:
        status['fetchError'] = 'replica_fetch_failed'
    # A network failure must never short-circuit expiry/readback of last accepted policy.
    try:
        result = sync(policy, target, reports)
        status.update(appliedRevision=result['appliedRevision'], appliedHash=result['appliedHash'])
    except Exception:
        status['applyError'] = 'replica_apply_failed'
    edge.atomic_write(status_path, json.dumps(status))
    if status['fetchError'] or status['applyError']:
        raise RuntimeError('replica_failed_check_receipts')
    return status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['export', 'sync'])
    args = parser.parse_args()
    os.umask(0o027)
    reports = Path('/var/lib/phab-traffic/reports')
    # Share sync lock with the existing helper. Never run a second writer concurrently.
    lock_path = reports / ('.export.lock' if args.command == 'export' else '.sync.lock')
    with lock_path.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.command == 'export':
            export_policy('/var/lib/ph-admin/traffic/quarantine.json', '/var/lib/phab-traffic-export/policy.json')
        else:
            replica_sync('/var/lib/phab-traffic/replica/policy.json', '/etc/nginx/phab-traffic/policy.conf', reports)


if __name__ == '__main__':
    main()
