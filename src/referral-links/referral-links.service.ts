import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { RequestUser } from '../common/rbac/request-user.interface';
import { CreateReferralLinkDto } from './dto/create-referral-link.dto';
import { UpdateReferralLinkDto } from './dto/update-referral-link.dto';
import { ReferralLinksRepository } from './referral-links.repository';
import {
  ReferralLinkAnalytics,
  ReferralLinkDailyMetrics,
  ReferralLinkJourney,
  ReferralLinkListResponse,
  ReferralLinkRedirect,
  ReferralLinkTotals,
  ReferralLinkView,
  ReferralOpenEvent,
  ReferralSaleSnapshot,
  StoredReferralLink
} from './referral-links.types';

interface CommandContext {
  idempotencyKey?: string;
}

interface CreateResult {
  item: ReferralLinkView;
  replayed: boolean;
}

@Injectable()
export class ReferralLinksService {
  private static readonly ATTRIBUTION_WINDOW_MS = 30 * 86_400_000;
  private readonly publicBaseUrl = this.normalizeBaseUrl(
    process.env.REFERRAL_LINKS_PUBLIC_BASE_URL ?? process.env.PHAB_PUBLIC_BASE_URL ?? 'https://padlhub.su'
  );
  private readonly allowedOrigins = this.readAllowedOrigins();

  constructor(private readonly repository: ReferralLinksRepository) {}

  async create(
    dto: CreateReferralLinkDto,
    command: CommandContext,
    user?: RequestUser
  ): Promise<CreateResult> {
    const actorId = this.requireActor(user);
    const idempotencyKey = this.requireIdempotencyKey(command.idempotencyKey);
    const validFrom = this.normalizeIso(dto.validFrom);
    const validTo = this.normalizeIso(dto.validTo);
    this.assertPeriod(validFrom, validTo);
    const timezone = this.validateTimezone(dto.timezone ?? 'Europe/Moscow');
    const targetUrl = this.validateTargetUrl(dto.targetUrl);
    const recipientExternalRef = this.optionalString(dto.recipientExternalRef);
    const legacyAttributionKey = this.optionalString(dto.legacyAttributionKey);
    const intentHash = createHash('sha256').update(JSON.stringify({
      campaignName: dto.campaignName.trim(),
      recipientName: dto.recipientName.trim(),
      recipientExternalRef: recipientExternalRef ?? null,
      targetUrl,
      validFrom,
      validTo,
      timezone,
      status: dto.status ?? 'ACTIVE',
      legacyAttributionKey: legacyAttributionKey ?? null
    })).digest('hex');
    const replay = await this.repository.findLinkByIdempotency(actorId, idempotencyKey);
    if (replay) {
      if (replay.idempotency?.intentHash !== intentHash) {
        throw new ConflictException({
          code: 'REFERRAL_LINK_IDEMPOTENCY_CONFLICT',
          message: 'Idempotency-Key уже использован для другой реферальной ссылки.'
        });
      }
      return { item: this.toView(replay), replayed: true };
    }
    const now = new Date().toISOString();
    const link: StoredReferralLink = {
      linkId: randomUUID(),
      publicToken: randomBytes(24).toString('base64url'),
      campaignName: dto.campaignName.trim(),
      recipientName: dto.recipientName.trim(),
      ...(recipientExternalRef ? { recipientExternalRef } : {}),
      targetUrl,
      validFrom,
      validTo,
      timezone,
      status: dto.status ?? 'ACTIVE',
      ...(legacyAttributionKey ? { legacyAttributionKey } : {}),
      revision: 1,
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
      idempotency: { actorId, key: idempotencyKey, intentHash }
    };
    try {
      await this.repository.insertLink(link);
    } catch (error) {
      const concurrentReplay = await this.repository.findLinkByIdempotency(actorId, idempotencyKey);
      if (concurrentReplay?.idempotency?.intentHash === intentHash) {
        return { item: this.toView(concurrentReplay), replayed: true };
      }
      if (concurrentReplay) {
        throw new ConflictException({
          code: 'REFERRAL_LINK_IDEMPOTENCY_CONFLICT',
          message: 'Idempotency-Key уже использован для другой реферальной ссылки.'
        });
      }
      if (this.repository.isDuplicateKey(error)) {
        throw new ConflictException({
          code: 'REFERRAL_LINK_UNIQUE_CONFLICT',
          message: 'Такая реферальная ссылка или legacy-код уже существует.'
        });
      }
      throw error;
    }
    return { item: this.toView(link), replayed: false };
  }

  async update(linkId: string, dto: UpdateReferralLinkDto, user?: RequestUser): Promise<ReferralLinkView> {
    const actorId = this.requireActor(user);
    const current = await this.requireLink(linkId);
    const validFrom = dto.validFrom ? this.normalizeIso(dto.validFrom) : current.validFrom;
    const validTo = dto.validTo ? this.normalizeIso(dto.validTo) : current.validTo;
    this.assertPeriod(validFrom, validTo);
    const unset: Array<'recipientExternalRef' | 'legacyAttributionKey'> = [];
    if (dto.recipientExternalRef === null) unset.push('recipientExternalRef');
    if (dto.legacyAttributionKey === null) unset.push('legacyAttributionKey');
    const update: Partial<StoredReferralLink> = {
      ...(dto.campaignName !== undefined ? { campaignName: dto.campaignName.trim() } : {}),
      ...(dto.recipientName !== undefined ? { recipientName: dto.recipientName.trim() } : {}),
      ...(dto.recipientExternalRef !== undefined && dto.recipientExternalRef !== null
        ? { recipientExternalRef: this.optionalString(dto.recipientExternalRef) }
        : {}),
      ...(dto.targetUrl !== undefined ? { targetUrl: this.validateTargetUrl(dto.targetUrl) } : {}),
      ...(dto.validFrom !== undefined ? { validFrom } : {}),
      ...(dto.validTo !== undefined ? { validTo } : {}),
      ...(dto.timezone !== undefined ? { timezone: this.validateTimezone(dto.timezone) } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.legacyAttributionKey !== undefined && dto.legacyAttributionKey !== null
        ? { legacyAttributionKey: this.optionalString(dto.legacyAttributionKey) }
        : {}),
      updatedAt: new Date().toISOString(),
      updatedBy: actorId
    };
    let updated: StoredReferralLink | null;
    try {
      updated = await this.repository.updateLink(linkId, dto.expectedRevision, update, unset);
    } catch (error) {
      if (this.repository.isDuplicateKey(error)) {
        throw new ConflictException({
          code: 'REFERRAL_LINK_UNIQUE_CONFLICT',
          message: 'Такой legacy-код уже назначен другой ссылке.'
        });
      }
      throw error;
    }
    if (!updated) {
      throw new ConflictException({
        code: 'REFERRAL_LINK_REVISION_CONFLICT',
        message: 'Ссылка была изменена другим пользователем. Обновите страницу.'
      });
    }
    return this.toView(updated);
  }

  async list(fromInput?: string, toInput?: string): Promise<ReferralLinkListResponse> {
    const period = this.resolvePeriod(fromInput, toInput);
    const links = await this.repository.listLinks();
    const items: ReferralLinkListResponse['items'] = [];
    for (let index = 0; index < links.length; index += 10) {
      const batch = await Promise.all(links.slice(index, index + 10).map(async (link) => {
        const analytics = await this.buildAnalytics(link, period.from, period.to, false, false);
        return { ...analytics.link, totals: analytics.totals };
      }));
      items.push(...batch);
    }
    return { items, period, persistence: 'MONGODB' };
  }

  async analytics(linkId: string, fromInput?: string, toInput?: string): Promise<ReferralLinkAnalytics> {
    const link = await this.requireLink(linkId);
    const period = this.resolvePeriod(fromInput, toInput);
    return this.buildAnalytics(link, period.from, period.to, false);
  }

  async exportCsv(linkId: string, fromInput?: string, toInput?: string): Promise<string> {
    const link = await this.requireLink(linkId);
    const period = this.resolvePeriod(fromInput, toInput);
    const analytics = await this.buildAnalytics(link, period.from, period.to, true);
    const columns: (keyof ReferralLinkJourney)[] = [
      'status', 'openedAt', 'visitId', 'checkoutAt', 'paidAt', 'paymentRef', 'transactionId',
      'clientPhone', 'clientId', 'clientName', 'productId', 'productName', 'planKey',
      'amountMinor', 'paymentStatus'
    ];
    const rows = [columns.map((value) => this.csvCell(value)).join(',')];
    for (const journey of analytics.journeys) {
      rows.push(columns.map((column) => this.csvCell(journey[column])).join(','));
    }
    return `\uFEFF${rows.join('\r\n')}\r\n`;
  }

  async resolveRedirect(
    publicToken: string,
    existingVisitId?: string,
    referrer?: string
  ): Promise<ReferralLinkRedirect> {
    const link = await this.repository.findLinkByToken(publicToken);
    if (!link) throw new NotFoundException('Реферальная ссылка не найдена');
    const now = new Date();
    if (
      link.status !== 'ACTIVE'
      || now.getTime() < Date.parse(link.validFrom)
      || now.getTime() > Date.parse(link.validTo)
    ) {
      throw new GoneException('Срок действия реферальной ссылки завершён или ссылка приостановлена');
    }
    const visitId = this.validVisitId(existingVisitId) ? String(existingVisitId) : randomUUID();
    const occurredAt = now.toISOString();
    const event: ReferralOpenEvent = {
      eventId: randomUUID(),
      linkId: link.linkId,
      publicToken: link.publicToken,
      visitId,
      kind: 'OPEN',
      occurredAt,
      receivedAt: occurredAt,
      dayKey: this.dayKey(occurredAt, link.timezone),
      referrerOrigin: this.referrerOrigin(referrer)
    };
    await this.repository.recordOpen(event);
    const target = new URL(this.validateTargetUrl(link.targetUrl));
    target.searchParams.set('ref', link.publicToken);
    target.searchParams.set('ref_visit', visitId);
    if (!target.searchParams.has('utm_source')) target.searchParams.set('utm_source', 'referral');
    if (!target.searchParams.has('utm_campaign')) target.searchParams.set('utm_campaign', link.campaignName);
    return {
      targetUrl: target.toString(),
      visitId,
      cookieName: this.cookieName(publicToken),
      cookieMaxAgeSeconds: Math.max(60, Math.floor((Date.parse(link.validTo) - now.getTime()) / 1000))
    };
  }

  private async buildAnalytics(
    link: StoredReferralLink,
    from: string,
    to: string,
    includePii: boolean,
    includeJourneys = true
  ): Promise<ReferralLinkAnalytics> {
    const rawSales = await this.repository.listSales(link, from, to);
    const candidateSales = this.latestSales(rawSales);
    const earliestSaleAt = candidateSales.reduce((earliest, sale) => {
      const saleAt = Date.parse(String(sale.createdAt ?? sale.paidAt ?? sale.updatedAt ?? ''));
      return Number.isFinite(saleAt) ? Math.min(earliest, saleAt) : earliest;
    }, Date.parse(from));
    const attributionFrom = new Date(
      earliestSaleAt - ReferralLinksService.ATTRIBUTION_WINDOW_MS
    ).toISOString();
    const attributionOpens = await this.repository.listOpenEvents(link, attributionFrom, to);
    const opens = attributionOpens.filter((event) => this.inPeriod(event.occurredAt, from, to));
    const verifiableOpens = attributionOpens.filter((event) => (
      !event.eventId.startsWith('legacy:')
      && event.linkId === link.linkId
      && event.publicToken === link.publicToken
    ));
    const sales = candidateSales.filter((sale) => (
      this.isAttributedSale(link, sale, verifiableOpens)
    ));
    const checkoutSales = sales.filter((sale) => this.inPeriod(sale.createdAt, from, to));
    const paidSales = sales.filter((sale) => {
      if (!(sale.status === 'PAID' || sale.paidAt)) return false;
      return this.inPeriod(sale.paidAt ?? sale.updatedAt ?? sale.createdAt, from, to);
    });
    const dailyMap = this.makeDailyMap(from, to, link.timezone);
    const openByVisit = new Map<string, string>();
    for (const event of opens) {
      const current = openByVisit.get(event.visitId);
      if (!current || event.occurredAt < current) openByVisit.set(event.visitId, event.occurredAt);
      const row = dailyMap.get(this.dayKey(event.occurredAt, link.timezone));
      if (row) row.opens += 1;
    }
    for (const [visitId, openedAt] of openByVisit) {
      const row = dailyMap.get(this.dayKey(openedAt, link.timezone));
      if (row && visitId) row.uniqueVisits += 1;
    }
    const journeys: ReferralLinkJourney[] = [];
    const saleVisitIds = new Set<string>();
    for (const sale of sales) {
      if (sale.visitId) saleVisitIds.add(sale.visitId);
      const paid = paidSales.includes(sale);
      const checkoutAt = sale.createdAt;
      if (checkoutSales.includes(sale)) {
        const row = checkoutAt ? dailyMap.get(this.dayKey(checkoutAt, link.timezone)) : undefined;
        if (row) row.checkoutStarts += 1;
      }
      if (paid) {
        const paidRow = dailyMap.get(this.dayKey(sale.paidAt ?? sale.updatedAt ?? sale.createdAt ?? '', link.timezone));
        if (paidRow) paidRow.paidPurchases += 1;
      }
      if (includeJourneys) journeys.push(this.saleJourney(sale, openByVisit.get(sale.visitId ?? ''), includePii));
    }
    for (const [visitId, openedAt] of openByVisit) {
      if (includeJourneys && !saleVisitIds.has(visitId)) journeys.push({ visitId, openedAt, status: 'OPEN_ONLY' });
    }
    const buyers = new Set(
      paidSales
        .map((sale) => sale.clientId || sale.clientPhone || sale.paymentRef)
        .filter(Boolean)
    );
    for (const row of dailyMap.values()) {
      const dayBuyers = new Set(
        paidSales.filter((sale) =>
          this.dayKey(sale.paidAt ?? sale.updatedAt ?? sale.createdAt ?? '', link.timezone) === row.date)
          .map((sale) => sale.clientId || sale.clientPhone || sale.paymentRef)
          .filter(Boolean)
      );
      row.uniqueBuyers = dayBuyers.size;
    }
    const paidPurchases = paidSales.length;
    const totals: ReferralLinkTotals = {
      opens: opens.length,
      uniqueVisits: openByVisit.size,
      checkoutStarts: checkoutSales.length,
      paidPurchases,
      uniqueBuyers: buyers.size,
      checkoutNotPaid: checkoutSales.filter((sale) => !(sale.status === 'PAID' || sale.paidAt)).length,
      visitToCheckoutPercent: this.percent(checkoutSales.length, openByVisit.size),
      checkoutToPaidPercent: this.percent(paidPurchases, checkoutSales.length),
      visitToPaidPercent: this.percent(paidPurchases, openByVisit.size)
    };
    if (includeJourneys) journeys.sort((a, b) => this.journeyTime(b).localeCompare(this.journeyTime(a)));
    return {
      link: this.toView(link),
      period: { from, to },
      totals,
      daily: [...dailyMap.values()],
      journeys: journeys.slice(0, includePii ? 100_000 : 1_000)
    };
  }

  private latestSales(rows: ReferralSaleSnapshot[]): ReferralSaleSnapshot[] {
    const byPayment = new Map<string, ReferralSaleSnapshot>();
    for (const row of rows) {
      const previous = byPayment.get(row.paymentRef);
      if (!previous || String(row.updatedAt ?? row.createdAt ?? '') >= String(previous.updatedAt ?? previous.createdAt ?? '')) {
        byPayment.set(row.paymentRef, row);
      }
    }
    return [...byPayment.values()];
  }

  private isAttributedSale(
    link: StoredReferralLink,
    sale: ReferralSaleSnapshot,
    opens: ReferralOpenEvent[]
  ): boolean {
    if (link.legacyAttributionKey && sale.trainerQrCode === link.legacyAttributionKey) return true;
    if (!sale.visitId) return false;
    const saleAt = Date.parse(String(sale.createdAt ?? sale.paidAt ?? sale.updatedAt ?? ''));
    if (!Number.isFinite(saleAt)) return false;
    return opens.some((event) => {
      if (event.visitId !== sale.visitId) return false;
      const openedAt = Date.parse(event.occurredAt);
      return Number.isFinite(openedAt)
        && openedAt <= saleAt
        && saleAt - openedAt <= ReferralLinksService.ATTRIBUTION_WINDOW_MS;
    });
  }

  private saleJourney(sale: ReferralSaleSnapshot, openedAt: string | undefined, includePii: boolean): ReferralLinkJourney {
    const paid = sale.status === 'PAID' || Boolean(sale.paidAt);
    return {
      visitId: sale.visitId,
      openedAt,
      ...(includePii ? { paymentRef: sale.paymentRef, transactionId: sale.transactionId } : {}),
      clientPhoneMasked: this.maskPhone(sale.clientPhone),
      ...(includePii ? { clientPhone: sale.clientPhone } : {}),
      ...(includePii ? { clientId: sale.clientId, clientName: sale.clientName } : {}),
      checkoutAt: sale.createdAt,
      paidAt: sale.paidAt,
      productId: sale.productId,
      productName: sale.productName,
      planKey: sale.planKey,
      amountMinor: sale.amountMinor ?? sale.toPayMinor,
      status: paid ? 'PAID' : 'CHECKOUT_NOT_PAID',
      paymentStatus: sale.status
    };
  }

  private makeDailyMap(from: string, to: string, timezone: string): Map<string, ReferralLinkDailyMetrics> {
    const result = new Map<string, ReferralLinkDailyMetrics>();
    const cursor = new Date(`${this.dayKey(from, timezone)}T12:00:00.000Z`);
    const end = new Date(`${this.dayKey(to, timezone)}T12:00:00.000Z`);
    while (cursor <= end) {
      const date = this.dayKey(cursor.toISOString(), timezone);
      result.set(date, { date, opens: 0, uniqueVisits: 0, checkoutStarts: 0, paidPurchases: 0, uniqueBuyers: 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return result;
  }

  private resolvePeriod(fromInput?: string, toInput?: string): { from: string; to: string } {
    const now = new Date();
    const to = toInput ? this.endOfDay(toInput) : now.toISOString();
    const defaultFrom = this.dayKey(new Date(Date.parse(to) - 29 * 86_400_000).toISOString(), 'Europe/Moscow');
    const from = fromInput ? this.startOfDay(fromInput) : this.startOfDay(defaultFrom);
    this.assertPeriod(from, to);
    if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) {
      throw new BadRequestException('Период статистики не может превышать 366 дней');
    }
    return { from, to };
  }

  private startOfDay(value: string): string {
    const date = this.requireDateInput(value, 'начала');
    const timestamp = Date.parse(`${date}T00:00:00.000+03:00`);
    if (!Number.isFinite(timestamp)) throw new BadRequestException('Некорректная дата начала периода');
    return new Date(timestamp).toISOString();
  }

  private endOfDay(value: string): string {
    const date = this.requireDateInput(value, 'конца');
    const timestamp = Date.parse(`${date}T23:59:59.999+03:00`);
    if (!Number.isFinite(timestamp)) throw new BadRequestException('Некорректная дата конца периода');
    return new Date(timestamp).toISOString();
  }

  private requireDateInput(value: string, label: string): string {
    const date = String(value ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException(`Дата ${label} периода должна быть в формате YYYY-MM-DD`);
    }
    return date;
  }

  private async requireLink(linkId: string): Promise<StoredReferralLink> {
    const link = await this.repository.findLinkById(linkId);
    if (!link) throw new NotFoundException('Реферальная ссылка не найдена');
    return link;
  }

  private toView(link: StoredReferralLink): ReferralLinkView {
    const {
      publicToken,
      idempotency: _idempotency,
      _id: _mongoId,
      ...view
    } = link as StoredReferralLink & { _id?: unknown };
    return { ...view, publicUrl: `${this.publicBaseUrl}/api/referral-links/r/${publicToken}` };
  }

  private validateTargetUrl(value: string): string {
    let url: URL;
    try { url = new URL(value); } catch { throw new BadRequestException('Некорректная целевая ссылка'); }
    if (url.protocol !== 'https:' || !this.allowedOrigins.has(url.origin.toLowerCase())) {
      throw new BadRequestException('Домен целевой страницы не входит в разрешённый список');
    }
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString();
  }

  private readAllowedOrigins(): Set<string> {
    const raw = process.env.REFERRAL_LINKS_ALLOWED_ORIGINS ?? 'https://padlhub.ru,https://www.padlhub.ru,https://padlhub.su';
    const origins = raw.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
      try { return new URL(item).origin.toLowerCase(); } catch { return ''; }
    }).filter(Boolean);
    return new Set(origins);
  }

  private normalizeBaseUrl(value: string): string {
    try { return new URL(String(value).trim()).origin; } catch { return 'https://padlhub.su'; }
  }

  private normalizeIso(value: string): string {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) throw new BadRequestException('Некорректная дата');
    return new Date(timestamp).toISOString();
  }

  private assertPeriod(from: string, to: string): void {
    if (Date.parse(from) > Date.parse(to)) throw new BadRequestException('Дата начала должна быть раньше даты окончания');
  }

  private validateTimezone(timezone: string): string {
    const normalized = timezone.trim();
    if (normalized !== 'Europe/Moscow') throw new BadRequestException('Поддерживается часовой пояс Europe/Moscow');
    try { new Intl.DateTimeFormat('ru-RU', { timeZone: normalized }).format(new Date()); }
    catch { throw new BadRequestException('Некорректный часовой пояс'); }
    return normalized;
  }

  private dayKey(value: string, timezone: string): string {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(timestamp));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  private percent(numerator: number, denominator: number): number {
    return denominator ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
  }

  private inPeriod(value: string | undefined, from: string, to: string): boolean {
    const timestamp = Date.parse(String(value ?? ''));
    return Number.isFinite(timestamp) && timestamp >= Date.parse(from) && timestamp <= Date.parse(to);
  }

  private requireActor(user?: RequestUser): string {
    const actorId = String(user?.id ?? '').trim();
    if (!actorId) throw new BadRequestException('Не удалось определить пользователя ЦУП');
    return actorId;
  }

  private requireIdempotencyKey(value?: string): string {
    const key = String(value ?? '').trim();
    if (key.length < 8 || key.length > 200) throw new BadRequestException('Idempotency-Key должен содержать от 8 до 200 символов');
    return key;
  }

  private validVisitId(value?: string): boolean {
    return /^[A-Za-z0-9_-]{8,100}$/.test(String(value ?? ''));
  }

  cookieName(publicToken: string): string {
    return `phab_ref_${createHash('sha256').update(publicToken).digest('hex').slice(0, 16)}`;
  }

  private referrerOrigin(value?: string): string | undefined {
    if (!value) return undefined;
    try { return new URL(value).origin.slice(0, 300); } catch { return undefined; }
  }

  private maskPhone(value?: string): string | undefined {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return undefined;
    if (digits.length < 7) return `***${digits.slice(-2)}`;
    return `+${digits.slice(0, 1)}***${digits.slice(-4)}`;
  }

  private optionalString(value?: string | null): string | undefined {
    const normalized = String(value ?? '').trim();
    return normalized || undefined;
  }

  private csvCell(value: unknown): string {
    let text = value === undefined || value === null ? '' : String(value);
    if (/^[\t\r\n]/.test(text) || /^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  private journeyTime(journey: ReferralLinkJourney): string {
    return journey.paidAt ?? journey.checkoutAt ?? journey.openedAt ?? '';
  }
}
