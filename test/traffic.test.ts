import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TrafficService, normalizeIp, isProtectedIp } from '../src/traffic/traffic.service';
import { requireTrafficAccess, TrafficController } from '../src/traffic/traffic.controller';
import { RequestWithUser } from '../src/common/rbac/request-user.interface';
import { Role } from '../src/common/rbac/role.enum';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/common/rbac/permissions';
import { PERMISSIONS_KEY } from '../src/common/rbac/permissions.decorator';

async function main() {
  const dir = await fs.mkdtemp(join(tmpdir(), 'traffic-test-'));
  process.env.TRAFFIC_ADMIN_ENABLED = 'true';
  process.env.TRAFFIC_POLICY_FILE = join(dir, 'quarantine.json');
  process.env.TRAFFIC_REPORT_DIR = dir;
  process.env.TRAFFIC_ADMIN_ORIGIN = 'https://admin.example.test';
  const service = new TrafficService();
  const initial = { version: 1, revision: 0, rules: [], audit: [] };
  const request = (overrides: any = {}) => ({ authSource: 'token', headers: { origin: 'https://admin.example.test' },
    user: { id: 'operator', roles: [Role.SUPER_ADMIN], permissions: ['*'], stationIds: [], connectorRoutes: [] },
    ...overrides }) as unknown as RequestWithUser;
  try {
    assert.equal(requireTrafficAccess(request(), 'traffic:write', true), 'operator');
    assert.throws(() => requireTrafficAccess(request({ authSource: 'headers' }), 'traffic:read'));
    assert.throws(() => requireTrafficAccess(request({ headers: { origin: 'https://evil.test' } }), 'traffic:write', true));
    assert.throws(() => requireTrafficAccess(request({ headers: {} }), 'traffic:write', true));
    assert.throws(() => requireTrafficAccess(request({ user: { ...request().user, stationIds: ['station'] } }), 'traffic:write', true));
    assert.throws(() => requireTrafficAccess(request({ user: { ...request().user, permissionStationScopes: { 'traffic:write': [] } } }), 'traffic:write', true));
    assert.throws(() => requireTrafficAccess(request({ user: undefined }), 'traffic:read'));
    assert.throws(() => requireTrafficAccess(request({ user: { ...request().user, permissions: [] } }), 'traffic:read'));
    assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, TrafficController.prototype.overview), ['traffic:read']);
    assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, TrafficController.prototype.mutate), ['traffic:write']);
    assert.ok(!DEFAULT_ROLE_PERMISSIONS[Role.MANAGER].includes('traffic:write'));
    assert.equal(normalizeIp('::ffff:188.127.235.140'), '188.127.235.140');
    assert.equal(normalizeIp('2001:0DB8:0:0:0:0:0:1'), '2001:db8::1');
    assert.ok(isProtectedIp(normalizeIp('::ffff:188.127.235.140')));
    for (const bad of ['1.2.3.4/24', 'example.com', '1.2.3.4; return 200', 'fe80::1%en0', '01.2.3.4']) assert.throws(() => normalizeIp(bad));
    await assert.rejects(service.overview('2026-02-30'));
    await assert.rejects(service.overview('../../secret'));
    await assert.rejects(service.overview('2026-09-24')); // Missing policy must not become an empty allow policy.
    await fs.writeFile(process.env.TRAFFIC_POLICY_FILE!, JSON.stringify(initial));
    const dto = { action: 'add', revision: 0, ip: '203.0.113.9', reason: 'Synthetic scan', expiresAt: new Date(Date.now() + 86400000).toISOString() };
    for (const ip of ['188.127.235.140', '::ffff:188.127.235.140', '127.0.0.1', '10.0.0.1']) {
      await assert.rejects(service.mutate({ ...dto, ip }, 'operator'));
    }
    await assert.rejects(service.mutate({ ...dto, reason: '' }, 'operator'));
    await assert.rejects(service.mutate({ ...dto, expiresAt: '2020-01-01' }, 'operator'));
    const race = await Promise.allSettled([service.mutate(dto, 'operator'), service.mutate({ ...dto, ip: '203.0.113.10' }, 'operator-2')]);
    assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
    const saved = JSON.parse(await fs.readFile(process.env.TRAFFIC_POLICY_FILE!, 'utf8'));
    assert.equal(saved.revision, 1); assert.equal(saved.rules.length, 1); assert.equal(saved.audit.length, 1);
    assert.equal(saved.audit[0].reason, 'Synthetic scan');
    await assert.rejects(service.mutate(dto, 'operator')); // Stale edit cannot replace committed rule.
    let view: any = await service.overview('2026-09-24');
    assert.equal(view.applied, false); assert.equal(view.report, null);
    await fs.writeFile(join(dir, 'edge-status.json'), JSON.stringify({ appliedRevision: 1, checkedAt: new Date().toISOString(), error: null }));
    view = await service.overview('2026-09-24'); assert.equal(view.applied, true);
    await fs.writeFile(join(dir, 'edge-status.json'), JSON.stringify({ appliedRevision: 1, checkedAt: '2020-01-01', error: null }));
    view = await service.overview('2026-09-24'); assert.equal(view.applied, false);
    await service.mutate({ action: 'remove', revision: 1, ip: saved.rules[0].ip, reason: 'Synthetic release' }, 'operator');
    view = await service.overview('2026-09-24'); assert.equal(view.policy.rules.length, 0); assert.equal(view.policy.audit.length, 2);
    await fs.writeFile(process.env.TRAFFIC_POLICY_FILE!, '{broken');
    await assert.rejects(service.overview('2026-09-24'));
    console.log('Traffic: RBAC/session/CSRF, normalization/protection, durable CAS/race, missing/corrupt state, stale edge and date tests passed');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
