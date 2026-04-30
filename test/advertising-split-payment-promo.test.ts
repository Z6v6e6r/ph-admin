import { strict as assert } from 'assert';
import { AdvertisingService } from '../src/advertising/advertising.service';
import { UpdateSplitPaymentPromoDto } from '../src/advertising/dto/update-split-payment-promo.dto';

async function main(): Promise<void> {
  const service = new AdvertisingService();
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
        id: 'promo-1',
        title: 'Акция 1',
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

  const firstPromoSnapshot = await service.getSplitPaymentPromoPublicSnapshot(
    '2026-05-01T04:00:00.000Z',
    {
      stationId: '6a7a9edc-6869-40ad-a5a1-8a1cdfb746a1',
      stationName: 'Терехово',
      roomName: 'new Корт №1'
    }
  );
  assert.strictEqual(firstPromoSnapshot.shareAmounts.fourPlayers, 250);
  assert.strictEqual(firstPromoSnapshot.baseShareAmount, 2000);

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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
