import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { buildEventRegistrationsExport } from '../src/communities/event-registrations-export';
import { CommunitiesService } from '../src/communities/communities.service';
import { Role } from '../src/common/rbac/role.enum';
import { RequestUser } from '../src/common/rbac/request-user.interface';

const NOW = '2026-11-12T12:00:00.000Z';
const EFFECTIVE_AT = '2026-11-11T09:44:59.648Z';
const POLICY = {
  version: 'event-registration-v1' as const,
  responsibleName: 'Synthetic Responsible',
  contactEmail: 'privacy@example.invalid',
  startsAt: '2026-11-11T14:58:55.000Z',
  endsAt: '2026-11-13T21:00:00.000Z',
  retentionYears: 1 as const
};
const entry = (overrides: Record<string, unknown> = {}) => ({
  playerId: 'synthetic-player-1',
  epoch: EFFECTIVE_AT,
  policyRevision: 2,
  policyVersion: 'event-registration-v1',
  registeredAt: '2026-11-11T15:18:24.978Z',
  retentionUntil: '2027-11-11T15:18:24.978Z',
  retentionMode: 'submitted-year-v1',
  fullName: 'Козлова Дарья',
  company: 'Синтетическая компания',
  email: 'Synthetic@Example.invalid',
  ...overrides
});
const source = (overrides: Record<string, unknown> = {}) => ({
  communityId: 'community-synthetic-event',
  communityName: 'Синтетическое событие',
  communityType: 'EVENT',
  typeSettings: { registrationPolicy: POLICY, gameIds: ['padel-jump'] },
  typeSettingsRevision: 2,
  typeSettingsEffectiveAt: EFFECTIVE_AT,
  stationId: 'synthetic-station',
  eventEntries: [entry()],
  ...overrides
});
const user = (overrides: Partial<RequestUser> = {}): RequestUser => ({
  id: 'synthetic-owner', login: 'owner', title: 'Owner', roles: [Role.MANAGER],
  stationIds: [], connectorRoutes: [], ...overrides
});

function fakeService(options: { source?: unknown; audit?: () => Promise<void>; auditEnabled?: boolean } = {}) {
  const audits: Array<Record<string, unknown>> = [];
  const persistence = {
    isEnabled: () => true,
    readEventRegistrationsSource: async () => ('source' in options ? options.source : source())
  };
  const auditStore = {
    isEnabled: () => options.auditEnabled !== false,
    appendAudit: async (record: Record<string, unknown>) => {
      audits.push(record);
      if (options.audit) await options.audit();
    }
  };
  const service = new CommunitiesService(
    {} as never,
    persistence as never,
    auditStore as never
  );
  return { service, audits };
}

async function main() {
  // Happy path: unexpired questionnaires survive settings revisions, expired contacts do not.
  const expired = entry({ playerId: 'synthetic-player-expired', retentionUntil: '2026-11-11T23:00:00.000Z' });
  const previousPolicy = entry({
    playerId: 'synthetic-player-old', policyRevision: 1, fullName: 'Старая Анкета',
    registeredAt: '2026-11-10T09:00:00.000Z', retentionUntil: '2027-11-10T09:00:00.000Z'
  });
  const notified = entry({
    playerId: 'synthetic-player-2',
    fullName: 'Орлов Глеб',
    company: 'ПадлхАБ',
    email: 'player2@example.invalid',
    phone: '79000000002',
    pushOptIn: true,
    registeredAt: '2026-11-12T08:12:04.992Z',
    retentionUntil: '2027-11-12T08:12:04.992Z'
  });
  const result = buildEventRegistrationsExport(
    source({ eventEntries: [notified, expired, previousPolicy, entry()] }) as never,
    NOW
  );
  assert.equal(result.count, 3);
  assert.deepEqual(result.rows.map((row) => row.fullName), ['Старая Анкета', 'Козлова Дарья', 'Орлов Глеб']);
  assert.equal(result.rows[1].email, 'synthetic@example.invalid');
  assert.equal(result.rows[1].phone, null);
  assert.equal(result.rows[1].receivesResultsPush, false);
  assert.equal(result.rows[2].phone, '79000000002');
  assert.equal(result.rows[2].receivesResultsPush, true);
  assert.equal(result.exportedAt, NOW);
  assert.equal(result.typeSettingsRevision, 2);
  assert.equal(JSON.stringify(result).includes('synthetic-player'), false);

  // A repeated submission keeps the newest questionnaire for the same player.
  const resubmitted = buildEventRegistrationsExport(source({
    eventEntries: [entry({ company: 'Первая компания' }),
      entry({ company: 'Новая компания', registeredAt: '2026-11-12T09:00:00.000Z',
        retentionUntil: '2027-11-12T09:00:00.000Z' })]
  }) as never, NOW);
  assert.equal(resubmitted.count, 1);
  assert.equal(resubmitted.rows[0].company, 'Новая компания');
  // An EVENT community without collected questionnaires is an honest empty export.
  assert.equal(buildEventRegistrationsExport(source({ eventEntries: undefined }) as never, NOW).count, 0);

  // Non-EVENT communities have no questionnaire to export.
  assert.throws(() => buildEventRegistrationsExport(source({ communityType: 'FRIENDS' }) as never, NOW),
    (error: unknown) => error instanceof BadRequestException);
  // Contact data must be absent from logs and audit metadata.
  const { service, audits } = fakeService();
  const exported = await service.getEventRegistrationsExport('community-synthetic-event', user());
  assert.equal(exported.count, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].targetId, 'community-synthetic-event');
  assert.deepEqual(audits[0].metadata, { rows: 1, typeSettingsRevision: 2, communityType: 'EVENT' });
  assert.equal(JSON.stringify(audits[0]).includes('example.invalid'), false);

  // Support and station-scoped staff cannot read the contact questionnaire.
  const { service: supportService, audits: supportAudits } = fakeService();
  await assert.rejects(() => supportService.getEventRegistrationsExport('community-synthetic-event',
    user({ roles: [Role.SUPPORT] })), (error: unknown) => error instanceof ForbiddenException);
  assert.equal(supportAudits.length, 0);
  const { service: scopedService, audits: scopedAudits } = fakeService();
  await assert.rejects(() => scopedService.getEventRegistrationsExport('community-synthetic-event',
    user({ roles: [Role.MANAGER], stationIds: ['other-station'] })),
    (error: unknown) => error instanceof ForbiddenException);
  assert.equal(scopedAudits.length, 0);
  const { service: permissionScopedService, audits: permissionScopedAudits } = fakeService();
  await assert.rejects(() => permissionScopedService.getEventRegistrationsExport('community-synthetic-event',
    user({ roles: [Role.MANAGER], stationIds: [], permissionStationScopes: { 'settings:read': ['other-station'] } })),
    (error: unknown) => error instanceof ForbiddenException);
  assert.equal(permissionScopedAudits.length, 0);
  const { service: stationService } = fakeService();
  assert.equal((await stationService.getEventRegistrationsExport('community-synthetic-event',
    user({ roles: [Role.SUPER_ADMIN], stationIds: ['synthetic-station'] }))).count, 1);

  // Malformed stored contacts fail closed instead of exporting partial data.
  for (const broken of [
    source({ eventEntries: [entry({ fullName: 'Безымянный' })] }),
    source({ eventEntries: [entry({ phone: '+7 900 000-00-02', pushOptIn: true })] }),
    source({ eventEntries: [entry({ email: 'not-an-email' })] }),
    source({ eventEntries: [entry({ playerId: '' })] }),
    source({ typeSettingsRevision: 0 }),
    source({ typeSettingsEffectiveAt: '2026-11-11' }),
    source({ eventEntries: 'unexpected' })
  ]) {
    assert.throws(() => buildEventRegistrationsExport(broken as never, NOW),
      (error: unknown) => error instanceof ServiceUnavailableException);
  }

  // Missing questionnaire is service data, not an authorization failure.
  await assert.rejects(() => fakeService({ source: null }).service
    .getEventRegistrationsExport('community-synthetic-event', user()),
    (error: unknown) => error instanceof NotFoundException);
  // An export that cannot be audited is refused, including an unconnected audit store.
  await assert.rejects(() => fakeService({ audit: async () => { throw new Error('audit down'); } }).service
    .getEventRegistrationsExport('community-synthetic-event', user()),
    (error: unknown) => error instanceof ServiceUnavailableException);
  const { service: unauditedService, audits: unauditedRows } = fakeService({ auditEnabled: false });
  await assert.rejects(() => unauditedService.getEventRegistrationsExport('community-synthetic-event', user()),
    (error: unknown) => error instanceof ServiceUnavailableException);
  assert.equal(unauditedRows.length, 0);

  console.log('event-registrations-export: ok');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
