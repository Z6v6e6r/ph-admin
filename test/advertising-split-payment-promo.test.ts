import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../src/auth/auth.service';
import { AdvertisingController } from '../src/advertising/advertising.controller';
import { AdvertisingService } from '../src/advertising/advertising.service';
import { UpdateSplitPaymentPromoDto } from '../src/advertising/dto/update-split-payment-promo.dto';
import { PERMISSIONS_KEY } from '../src/common/rbac/permissions.decorator';
import { Role } from '../src/common/rbac/role.enum';
import { RolesGuard } from '../src/common/rbac/roles.guard';

type ClientPermissionCheck = (
  cfg: { roles?: string[]; permissions?: string[]; permissionsAuthoritative?: boolean },
  permission: string
) => boolean;

function loadClientPermissionCheck(source: string): ClientPermissionCheck {
  const start = source.indexOf('  function hasRole(cfg, role)');
  const end = source.indexOf('  function canAccessSettings(cfg)', start);
  assert.ok(start >= 0 && end > start, 'client permission helpers must remain extractable');
  return new Function(`${source.slice(start, end)}\nreturn hasPermission;`)() as ClientPermissionCheck;
}

function createGuard(
  handler: (...args: never[]) => unknown,
  roles: Role[],
  permissions: string[]
): { guard: RolesGuard; context: ExecutionContext } {
  const request = { headers: {} };
  const authService = {
    resolveUserFromRequest: async () => ({
      source: 'token' as const,
      user: {
        id: 'admin:advertising-test',
        roles,
        permissions,
        stationIds: [],
        connectorRoutes: []
      }
    }),
    shouldRequireStaffToken: () => false,
    hasStaffRole: () => true
  } as unknown as AuthService;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => AdvertisingController
  } as unknown as ExecutionContext;
  return { guard: new RolesGuard(new Reflector(), authService), context };
}

async function main(): Promise<void> {
  const service = new AdvertisingService();
  const piterStationId = '1ea77cbf-bc36-49a1-96d6-f35c216a409b';
  const payload: UpdateSplitPaymentPromoDto = {
    enabled: true,
    expiresAt: '2026-05-03T20:59:59.999Z',
    stationIds: ['6a7a9edc-6869-40ad-a5a1-8a1cdfb746a1'],
    stationNameIncludes: ['терехово', 'terekhovo'],
    roomIds: [],
    roomNameIncludes: ['new'],
    shareAmounts: {
      twoTeams: 500,
      fourPlayers: 250
    },
    baseShareAmount: 2000,
    vivaDirectionId: 4485,
    vivaExerciseTypeId: 1208,
    promos: [
      {
        id: 'piter-split-250-per-hour-v1',
        title: 'Питер — split 250 ₽/час',
        enabled: true,
        activeFrom: '2026-08-20T00:00:00.000+03:00',
        expiresAt: '2026-09-30T23:59:59.999+03:00',
        pricingMode: 'PER_PARTICIPANT_HOUR',
        currency: 'RUB',
        stationIds: [piterStationId],
        stationNameIncludes: [],
        roomIds: [],
        roomNameIncludes: [],
        shareAmounts: {
          twoTeams: 500,
          fourPlayers: 250
        },
        baseShareAmount: 2000,
        vivaDirectionId: 4485,
        vivaExerciseTypeId: 1208
      },
      {
        id: 'promo-2',
        title: 'Акция 2',
        enabled: true,
        expiresAt: '2026-05-04T20:59:59.999Z',
        stationIds: ['6a7a9edc-6869-40ad-a5a1-8a1cdfb746a1'],
        stationNameIncludes: ['терехово', 'terekhovo'],
        roomIds: ['abfd1c04-2077-43bd-9f25-acf1e2e5b5cf'],
        roomNameIncludes: [],
        shareAmounts: {
          twoTeams: 2000,
          fourPlayers: 1000
        },
        baseShareAmount: 1500,
        vivaDirectionId: 4485,
        vivaExerciseTypeId: 1208
      }
    ]
  };

  await service.updateSplitPaymentPromoSettings(payload, 'test');

  const adminSnapshot = await service.getSplitPaymentPromoAdminSnapshot();
  assert.strictEqual(adminSnapshot.promos[0].activeFrom, '2026-08-20');
  assert.strictEqual(adminSnapshot.promos[0].expiresAt, '2026-09-30');

  const firstPromoSnapshot = await service.getSplitPaymentPromoPublicSnapshot(
    '2026-08-24T04:00:00.000Z',
    {
      stationId: piterStationId,
      stationName: 'Питер',
      roomName: 'Панорамик 1'
    }
  );
  assert.strictEqual(firstPromoSnapshot.shareAmounts.fourPlayers, 250);
  assert.strictEqual(firstPromoSnapshot.baseShareAmount, 2000);
  assert.strictEqual(firstPromoSnapshot.pricingMode, 'PER_PARTICIPANT_HOUR');
  assert.strictEqual(firstPromoSnapshot.currency, 'RUB');
  assert.strictEqual(firstPromoSnapshot.selectedPromoId, 'piter-split-250-per-hour-v1');

  const secondPromoSnapshot = await service.getSplitPaymentPromoPublicSnapshot(
    '2026-05-02T04:00:00.000Z',
    {
      stationId: '6a7a9edc-6869-40ad-a5a1-8a1cdfb746a1',
      stationName: 'Терехово',
      roomId: 'abfd1c04-2077-43bd-9f25-acf1e2e5b5cf',
      roomName: 'Корт №1 панорамик с выбеганиями'
    }
  );
  assert.strictEqual(secondPromoSnapshot.shareAmounts.fourPlayers, 1000);
  assert.strictEqual(secondPromoSnapshot.baseShareAmount, 1500);

  const nonPiterSnapshot = await service.getSplitPaymentPromoPublicSnapshot(
    '2026-08-24T04:00:00.000Z',
    { stationId: 'moscow-station', stationName: 'Москва' }
  );
  assert.strictEqual(nonPiterSnapshot.enabled, false);
  assert.strictEqual(nonPiterSnapshot.selectedPromoId, undefined);

  const beforeStartSnapshot = await service.getSplitPaymentPromoPublicSnapshot(
    '2026-08-19',
    { stationId: piterStationId }
  );
  assert.strictEqual(beforeStartSnapshot.enabled, false);

  const firstActiveDateSnapshot = await service.getSplitPaymentPromoPublicSnapshot(
    '2026-08-20',
    { stationId: piterStationId }
  );
  assert.strictEqual(firstActiveDateSnapshot.enabled, true);

  const afterEndSnapshot = await service.getSplitPaymentPromoPublicSnapshot(
    '2026-10-01T04:00:00.000Z',
    { stationId: piterStationId }
  );
  assert.strictEqual(afterEndSnapshot.enabled, false);

  const defaults = (service as any).createDefaultSplitPaymentPromoCampaign(0);
  const normalizedWithExplicitEmptyFilters = (service as any).normalizeSplitPaymentPromoCampaignRecord(
    {
      ...defaults,
      id: 'empty-filter-regression',
      stationIds: [],
      stationNameIncludes: [],
      roomIds: [],
      roomNameIncludes: []
    },
    defaults,
    0
  );
  assert.deepStrictEqual(normalizedWithExplicitEmptyFilters.stationIds, []);
  assert.deepStrictEqual(normalizedWithExplicitEmptyFilters.stationNameIncludes, []);
  assert.deepStrictEqual(normalizedWithExplicitEmptyFilters.roomIds, []);
  assert.deepStrictEqual(normalizedWithExplicitEmptyFilters.roomNameIncludes, []);

  const adminUiSource = readFileSync(resolve('client-sdk/phab-admin-panel.js'), 'utf8');
  const clientHasPermission = loadClientPermissionCheck(adminUiSource);
  assert.match(adminUiSource, /Суммы задаются за одну долю оплаты в час/);
  assert.match(adminUiSource, /Полная оплата всегда остаётся по цене слота Viva/);
  assert.match(adminUiSource, /Цена команды при делении на 2 команды, ₽\/час/);
  assert.match(adminUiSource, /Цена участника при делении на 4 игроков, ₽\/час/);
  assert.match(
    adminUiSource,
    /formatMoney\(promo\.shareAmounts\.twoTeams\)\s*\+\s*' за команду\/час · 4 игрока: '/
  );
  assert.match(
    adminUiSource,
    /formatMoney\(promo\.shareAmounts\.fourPlayers\)\s*\+\s*' за игрока\/час'/
  );
  assert.doesNotMatch(
    adminUiSource,
    /formatMoney\(promo\.shareAmounts\.(?:twoTeams|fourPlayers)\)\s*\+\s*' ₽\/час'/
  );
  assert.match(
    adminUiSource,
    /splitPromoGrid\.className\s*=\s*'phab-admin-settings-grid phab-admin-split-promo-grid'\s*\+\s*\(canManageAdvertisingSettings\(cfg\) \? '' : ' phab-admin-hidden'\)/
  );
  assert.match(
    adminUiSource,
    /raw && Object\.prototype\.hasOwnProperty\.call\(raw, 'permissions'\)/
  );
  assert.equal(
    clientHasPermission(
      { roles: [Role.MANAGER], permissions: ['advertising:write'], permissionsAuthoritative: true },
      'advertising:write'
    ),
    true
  );
  assert.equal(
    clientHasPermission(
      { roles: [Role.MANAGER], permissions: [], permissionsAuthoritative: true },
      'advertising:write'
    ),
    false,
    'an explicit empty permission set must revoke the legacy MANAGER grant'
  );
  assert.equal(
    clientHasPermission(
      { roles: [Role.STATION_ADMIN], permissions: [], permissionsAuthoritative: true },
      'advertising:write'
    ),
    false
  );
  assert.equal(
    clientHasPermission(
      { roles: [Role.MANAGER], permissions: ['advertising:read'], permissionsAuthoritative: true },
      'advertising:write'
    ),
    false
  );
  assert.equal(
    clientHasPermission(
      { roles: [Role.MANAGER], permissions: [], permissionsAuthoritative: false },
      'advertising:write'
    ),
    true,
    'legacy role fallback must remain available only when permissions are absent'
  );

  for (const handler of [
    AdvertisingController.prototype.getSplitPaymentPromoAdmin,
    AdvertisingController.prototype.updateSplitPaymentPromoAdmin
  ]) {
    assert.deepStrictEqual(Reflect.getMetadata(PERMISSIONS_KEY, handler), ['advertising:write']);
    const writer = createGuard(handler, [Role.MANAGER], ['advertising:write']);
    assert.equal(await writer.guard.canActivate(writer.context), true);
    const revokedManager = createGuard(handler, [Role.MANAGER], []);
    assert.equal(await revokedManager.guard.canActivate(revokedManager.context), false);
    const stationAdmin = createGuard(handler, [Role.STATION_ADMIN], []);
    assert.equal(await stationAdmin.guard.canActivate(stationAdmin.context), false);
    const readOnlyManager = createGuard(handler, [Role.MANAGER], ['advertising:read']);
    assert.equal(await readOnlyManager.guard.canActivate(readOnlyManager.context), false);
  }
  assert.match(adminUiSource, /splitPromoSecondActiveFromInput/);
  assert.match(adminUiSource, /buildGameDateBoundaryFromDateInput/);
  assert.doesNotMatch(adminUiSource, /buildStartOfDayIsoFromDateInput/);
  assert.match(adminUiSource, /Object\.prototype\.hasOwnProperty\.call\(source, 'stationIds'\)/);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
