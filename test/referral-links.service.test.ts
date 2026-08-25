import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, GoneException, ServiceUnavailableException } from '@nestjs/common';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { Role } from '../src/common/rbac/role.enum';
import { CreateReferralLinkDto } from '../src/referral-links/dto/create-referral-link.dto';
import { ReferralLinksRepository } from '../src/referral-links/referral-links.repository';
import { ReferralLinksAdminController } from '../src/referral-links/referral-links.controller';
import { ReferralLinksService } from '../src/referral-links/referral-links.service';
import {
  ReferralOpenEvent,
  ReferralSaleSnapshot,
  StoredReferralLink
} from '../src/referral-links/referral-links.types';

class InMemoryReferralLinksRepository {
  readonly links: StoredReferralLink[] = [];
  readonly events: ReferralOpenEvent[] = [];
  readonly sales: ReferralSaleSnapshot[] = [];

  isDuplicateKey(): boolean { return false; }

  async findLinkByIdempotency(actorId: string, key: string): Promise<StoredReferralLink | null> {
    return this.links.find((link) => link.idempotency?.actorId === actorId && link.idempotency.key === key) ?? null;
  }

  async insertLink(link: StoredReferralLink): Promise<void> {
    (link as StoredReferralLink & { _id?: string })._id = 'synthetic-mongo-object-id';
    this.links.push(structuredClone(link));
  }

  async findLinkById(linkId: string): Promise<StoredReferralLink | null> {
    return this.links.find((link) => link.linkId === linkId) ?? null;
  }

  async findLinkByToken(publicToken: string): Promise<StoredReferralLink | null> {
    return this.links.find((link) => link.publicToken === publicToken) ?? null;
  }

  async listLinks(): Promise<StoredReferralLink[]> {
    return structuredClone(this.links);
  }

  async updateLink(linkId: string, expectedRevision: number, set: Partial<StoredReferralLink>, unset: string[] = []): Promise<StoredReferralLink | null> {
    const index = this.links.findIndex((link) => link.linkId === linkId && link.revision === expectedRevision);
    if (index < 0) return null;
    this.links[index] = { ...this.links[index], ...set, revision: expectedRevision + 1 };
    for (const field of unset) delete (this.links[index] as unknown as Record<string, unknown>)[field];
    return structuredClone(this.links[index]);
  }

  async recordOpen(event: ReferralOpenEvent): Promise<boolean> {
    this.events.push(structuredClone(event));
    return true;
  }

  async listOpenEvents(link: StoredReferralLink, from: string, to: string): Promise<ReferralOpenEvent[]> {
    return this.events.filter((event) => event.linkId === link.linkId && event.occurredAt >= from && event.occurredAt <= to);
  }

  async listSales(_link: StoredReferralLink, from: string, to: string): Promise<ReferralSaleSnapshot[]> {
    return this.sales.filter((sale) => (
      Boolean(sale.createdAt && sale.createdAt >= from && sale.createdAt <= to)
      || Boolean(sale.paidAt && sale.paidAt >= from && sale.paidAt <= to)
    ));
  }
}

const admin: RequestUser = {
  id: 'admin:referrals',
  roles: [Role.SUPER_ADMIN],
  permissions: ['*'],
  stationIds: [],
  connectorRoutes: []
};

function draft(overrides: Partial<CreateReferralLinkDto> = {}): CreateReferralLinkDto {
  return {
    campaignName: 'Годовая подписка — тренеры',
    recipientName: 'Иван Петров',
    targetUrl: 'https://padlhub.ru/annual',
    validFrom: '2026-08-01T00:00:00.000Z',
    validTo: '2026-09-30T23:59:59.999Z',
    timezone: 'Europe/Moscow',
    status: 'ACTIVE',
    ...overrides
  };
}

async function main(): Promise<void> {
  const oldBase = process.env.REFERRAL_LINKS_PUBLIC_BASE_URL;
  const oldOrigins = process.env.REFERRAL_LINKS_ALLOWED_ORIGINS;
  process.env.REFERRAL_LINKS_PUBLIC_BASE_URL = 'https://cup.padlhub.ru';
  process.env.REFERRAL_LINKS_ALLOWED_ORIGINS = 'https://padlhub.ru';
  try {
    const repository = new InMemoryReferralLinksRepository();
    const service = new ReferralLinksService(repository as unknown as ReferralLinksRepository);

    const created = await service.create(draft(), { idempotencyKey: 'referral-create-0001' }, admin);
    assert.equal(created.replayed, false);
    assert.match(created.item.publicUrl, /^https:\/\/cup\.padlhub\.ru\/api\/referral-links\/r\//);
    assert.equal((created.item as unknown as Record<string, unknown>).publicToken, undefined);
    assert.equal((created.item as unknown as Record<string, unknown>)._id, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(repository.links[0], 'legacyAttributionKey'), false);

    const replay = await service.create(draft(), { idempotencyKey: 'referral-create-0001' }, admin);
    assert.equal(replay.replayed, true);
    assert.equal(replay.item.linkId, created.item.linkId);
    assert.equal(repository.links.length, 1);
    await assert.rejects(
      service.create(draft({ recipientName: 'Другой получатель' }), { idempotencyKey: 'referral-create-0001' }, admin),
      ConflictException
    );

    repository.links[0].legacyAttributionKey = 'TR-001';
    const cleared = await service.update(created.item.linkId, {
      expectedRevision: 1,
      legacyAttributionKey: null
    }, admin);
    assert.equal(cleared.legacyAttributionKey, undefined);
    assert.equal(repository.links[0].legacyAttributionKey, undefined);

    await assert.rejects(
      service.create(draft({ targetUrl: 'https://evil.example/collect' }), { idempotencyKey: 'referral-create-0002' }, admin),
      BadRequestException
    );
    await assert.rejects(
      service.create(draft({ validFrom: '2026-10-01T00:00:00.000Z', validTo: '2026-09-01T00:00:00.000Z' }), { idempotencyKey: 'referral-create-0003' }, admin),
      BadRequestException
    );

    const link = repository.links[0];
    const redirect = await service.resolveRedirect(link.publicToken, undefined, 'https://telegram.org/link');
    const target = new URL(redirect.targetUrl);
    assert.equal(target.searchParams.get('ref'), link.publicToken);
    assert.equal(target.searchParams.get('ref_visit'), redirect.visitId);
    assert.equal(repository.events.length, 1);
    assert.equal(repository.events[0].referrerOrigin, 'https://telegram.org');
    repository.events[0].occurredAt = '2026-08-25T08:00:00.000Z';
    repository.events[0].receivedAt = '2026-08-25T08:00:00.000Z';
    repository.events[0].dayKey = '2026-08-25';

    repository.sales.push({
      paymentRef: 'pay-1',
      visitId: redirect.visitId,
      clientPhone: '+79990001122',
      clientName: ' \t=WEBSERVICE("https://evil.example")',
      productName: 'Годовая подписка',
      amountMinor: 12000000,
      status: 'PAID',
      createdAt: '2026-08-25T10:00:00.000Z',
      paidAt: '2026-08-25T10:02:00.000Z',
      updatedAt: '2026-08-25T10:02:00.000Z'
    }, {
      paymentRef: 'pay-2',
      visitId: 'visit-open-only-0001',
      clientPhone: '+79990003344',
      productName: 'Годовая подписка',
      amountMinor: 12000000,
      status: 'PAYMENT_PENDING',
      createdAt: '2026-08-25T11:00:00.000Z'
    }, {
      paymentRef: 'pay-spoofed',
      visitId: 'visit-never-opened-0001',
      clientPhone: '+79990005566',
      productName: 'Годовая подписка',
      amountMinor: 12000000,
      status: 'PAID',
      createdAt: '2026-08-25T12:00:00.000Z',
      paidAt: '2026-08-25T12:02:00.000Z'
    });
    repository.events.push({
      eventId: 'event-open-only', linkId: link.linkId, publicToken: link.publicToken,
      visitId: 'visit-open-only-0001', kind: 'OPEN', occurredAt: '2026-08-25T09:00:00.000Z',
      receivedAt: '2026-08-25T09:00:00.000Z', dayKey: '2026-08-25'
    });

    const analytics = await service.analytics(link.linkId, '2026-08-25', '2026-08-25');
    assert.deepEqual(analytics.period, {
      from: '2026-08-24T21:00:00.000Z',
      to: '2026-08-25T20:59:59.999Z'
    });
    assert.deepEqual(analytics.totals, {
      opens: 2,
      uniqueVisits: 2,
      checkoutStarts: 2,
      paidPurchases: 1,
      uniqueBuyers: 1,
      checkoutNotPaid: 1,
      visitToCheckoutPercent: 100,
      checkoutToPaidPercent: 50,
      visitToPaidPercent: 50
    });
    const paidJourney = analytics.journeys.find((journey) => journey.status === 'PAID');
    assert.equal(paidJourney?.clientPhoneMasked, '+7***1122');
    assert.equal(paidJourney?.clientPhone, undefined);
    assert.equal(paidJourney?.clientName, undefined);
    assert.equal(paidJourney?.clientId, undefined);
    assert.equal(paidJourney?.paymentRef, undefined);

    const csv = await service.exportCsv(link.linkId, '2026-08-25', '2026-08-25');
    assert.match(csv, /\+79990001122/);
    assert.match(csv, /' \t=WEBSERVICE/);
    assert.doesNotMatch(csv, /" \t=WEBSERVICE/);
    assert.doesNotMatch(csv, /pay-spoofed/);

    const auditResponse = {
      sent: false,
      setHeader() { return undefined; },
      send() { this.sent = true; }
    };
    const exportService = { exportCsv: async () => 'sensitive-csv' } as unknown as ReferralLinksService;
    const disabledAuditController = new ReferralLinksAdminController(exportService, {
      isEnabled: () => false,
      appendAudit: async () => undefined
    } as never);
    await assert.rejects(
      disabledAuditController.exportCsv(link.linkId, undefined, undefined, admin, auditResponse as never),
      ServiceUnavailableException
    );
    assert.equal(auditResponse.sent, false);
    const failingAuditController = new ReferralLinksAdminController(exportService, {
      isEnabled: () => true,
      appendAudit: async () => { throw new Error('audit unavailable'); }
    } as never);
    await assert.rejects(
      failingAuditController.exportCsv(link.linkId, undefined, undefined, admin, auditResponse as never),
      /audit unavailable/
    );
    assert.equal(auditResponse.sent, false);

    const boundaryRepository = new InMemoryReferralLinksRepository();
    const boundaryService = new ReferralLinksService(boundaryRepository as unknown as ReferralLinksRepository);
    const boundaryCreated = await boundaryService.create(
      draft({ legacyAttributionKey: 'TR-001' }),
      { idempotencyKey: 'referral-boundary-0001' },
      admin
    );
    const boundaryLink = boundaryRepository.links[0];
    boundaryRepository.events.push({
      eventId: 'event-boundary-valid', linkId: boundaryLink.linkId, publicToken: boundaryLink.publicToken,
      visitId: 'visit-boundary-valid', kind: 'OPEN', occurredAt: '2026-07-06T10:00:00.000Z',
      receivedAt: '2026-07-06T10:00:00.000Z', dayKey: '2026-07-06'
    }, {
      eventId: 'event-boundary-expired', linkId: boundaryLink.linkId, publicToken: boundaryLink.publicToken,
      visitId: 'visit-boundary-expired', kind: 'OPEN', occurredAt: '2026-07-06T09:59:59.999Z',
      receivedAt: '2026-07-06T09:59:59.999Z', dayKey: '2026-07-06'
    });
    boundaryRepository.sales.push({
      paymentRef: 'pay-boundary-valid', visitId: 'visit-boundary-valid', status: 'PAID',
      createdAt: '2026-08-05T10:00:00.000Z', paidAt: '2026-08-25T10:00:00.000Z'
    }, {
      paymentRef: 'pay-boundary-expired', visitId: 'visit-boundary-expired', status: 'PAID',
      createdAt: '2026-08-05T10:00:00.000Z', paidAt: '2026-08-25T10:00:00.000Z'
    }, {
      paymentRef: 'pay-legacy', trainerQrCode: 'TR-001', status: 'PAID',
      createdAt: '2026-08-25T12:00:00.000Z', paidAt: '2026-08-25T12:01:00.000Z'
    });
    const boundaryAnalytics = await boundaryService.analytics(
      boundaryCreated.item.linkId,
      '2026-08-25',
      '2026-08-25'
    );
    assert.equal(boundaryAnalytics.totals.paidPurchases, 2);
    assert.equal(boundaryAnalytics.journeys.some((row) => row.visitId === 'visit-boundary-valid'), true);
    assert.equal(boundaryAnalytics.journeys.some((row) => row.visitId === 'visit-boundary-expired'), false);

    link.validTo = '2026-08-24T00:00:00.000Z';
    await assert.rejects(service.resolveRedirect(link.publicToken), GoneException);
    console.log('Referral links service tests passed.');
  } finally {
    if (oldBase === undefined) delete process.env.REFERRAL_LINKS_PUBLIC_BASE_URL;
    else process.env.REFERRAL_LINKS_PUBLIC_BASE_URL = oldBase;
    if (oldOrigins === undefined) delete process.env.REFERRAL_LINKS_ALLOWED_ORIGINS;
    else process.env.REFERRAL_LINKS_ALLOWED_ORIGINS = oldOrigins;
  }
}

void main();
