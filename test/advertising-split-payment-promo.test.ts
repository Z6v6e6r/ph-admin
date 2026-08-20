import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AdvertisingService } from '../src/advertising/advertising.service';
import { UpdateSplitPaymentPromoDto } from '../src/advertising/dto/update-split-payment-promo.dto';

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
  assert.match(adminUiSource, /Суммы задаются за одного участника за час/);
  assert.match(adminUiSource, /Полная оплата всегда остаётся по цене слота Viva/);
  assert.match(adminUiSource, /Цена участника при делении на 4 игроков, ₽\/час/);
  assert.match(adminUiSource, /splitPromoSecondActiveFromInput/);
  assert.match(adminUiSource, /buildGameDateBoundaryFromDateInput/);
  assert.doesNotMatch(adminUiSource, /buildStartOfDayIsoFromDateInput/);
  assert.match(adminUiSource, /Object\.prototype\.hasOwnProperty\.call\(source, 'stationIds'\)/);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
