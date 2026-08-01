import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AdvertisingService } from '../src/advertising/advertising.service';

const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function main(): Promise<void> {
  const service = new AdvertisingService();
  const snapshot = await service.updateCabinetForMeCardSettings(
    {
      rotationEnabled: false,
      repeatEveryCards: 6,
      ads: [
        {
          title: 'Тестовая акция',
          badgeText: '⚡',
          footerText: 'Подробнее',
          href: 'https://padlhub.test/offers/test',
          squareImageDataUrl: tinyPng,
          horizontalImageDataUrl: tinyPng,
          isActive: true
        }
      ]
    },
    'Тестовый оператор',
    'https://cup.padlhub.test'
  );

  const ad = snapshot.ads[0];
  assert.ok(ad);
  assert.ok(ad.squareImageAssetId);
  assert.ok(ad.horizontalImageAssetId);
  assert.notStrictEqual(ad.squareImageAssetId, ad.horizontalImageAssetId);
  assert.match(ad.squareImageUrl ?? '', /\/api\/advertising\/assets\//);
  assert.match(ad.horizontalImageUrl ?? '', /\/api\/advertising\/assets\//);

  const event = {
    placement: 'cabinet_for_me_card' as const,
    adId: ad.id,
    occurredAt: '2026-08-01T12:00:00.000Z'
  };
  await service.recordEngagement({
    ...event,
    eventId: 'impression-0001',
    kind: 'IMPRESSION'
  });
  await service.recordEngagement({
    ...event,
    eventId: 'click-0001',
    kind: 'CLICK',
    phoneE164: '+79990000001'
  });
  const replay = await service.recordEngagement({
    ...event,
    eventId: 'click-0001',
    kind: 'CLICK',
    phoneE164: '+79990000001'
  });
  assert.deepStrictEqual(replay, { accepted: true, replayed: true });

  const insights = await service.getAdminInsights('cabinet_for_me_card');
  assert.deepStrictEqual(insights.ads[0], {
    adId: ad.id,
    impressionCount: 1,
    clickCount: 1,
    clickThroughRate: 100,
    clickedPhones: [
      {
        phoneE164: '+79990000001',
        clickCount: 1,
        lastClickedAt: '2026-08-01T12:00:00.000Z'
      }
    ]
  });
  assert.equal(insights.auditLog[0]?.actor, 'Тестовый оператор');
  assert.equal(insights.auditLog[0]?.action, 'CREATED');

  const secondSnapshot = await service.updateCabinetForMeCardSettings(
    {
      rotationEnabled: false,
      repeatEveryCards: 6,
      ads: [
        {
          id: ad.id,
          title: ad.title,
          badgeText: ad.badgeText,
          footerText: ad.footerText,
          href: ad.href,
          squareImageAssetId: ad.squareImageAssetId,
          horizontalImageAssetId: ad.horizontalImageAssetId,
          isActive: true
        },
        {
          title: 'Вторая тестовая акция',
          badgeText: 'АКЦИЯ',
          footerText: 'Попробовать',
          href: 'https://padlhub.test/offers/second',
          squareImageDataUrl: tinyPng,
          horizontalImageDataUrl: tinyPng,
          isActive: true
        }
      ]
    },
    'Тестовый оператор',
    'https://cup.padlhub.test'
  );

  assert.equal(secondSnapshot.ads.length, 2);
  assert.equal(secondSnapshot.ads[0]?.id, ad.id);
  assert.ok(secondSnapshot.ads[1]?.squareImageAssetId);
  assert.ok(secondSnapshot.ads[1]?.horizontalImageAssetId);

  const clientSdk = readFileSync(
    resolve(__dirname, '../client-sdk/phab-admin-panel.js'),
    'utf8'
  );
  for (const field of [
    'squareImageAssetId',
    'squareImageDataUrl',
    'horizontalImageAssetId',
    'horizontalImageDataUrl'
  ]) {
    assert.match(
      clientSdk,
      new RegExp(`${field}:\\s*\\n?\\s*String\\(item`),
      `CUP request serializer must preserve ${field}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
