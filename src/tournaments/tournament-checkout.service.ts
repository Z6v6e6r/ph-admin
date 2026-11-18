import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TournamentsService } from './tournaments.service';
import { TournamentsPersistenceService } from './tournaments-persistence.service';

type Row = Record<string, any>;
const record = (x: unknown): x is Row => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: Row, keys: string[]) => keys.map(k => x?.[k]).find(v => typeof v === 'string' && v.trim())?.trim();
const id = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(x);
const pending = (operation: Row) => ({ operationId: operation.transactionId, state: 'PENDING_CONFIRMATION',
  code: 'TOURNAMENT_CHECKOUT_OUTCOME_UNRESOLVED', message: 'Результат записи уточняется. Повторная оплата заблокирована.' });

/** Same Viva v2 cart as LK1; only authenticated catalog data can supply product fields. */
export function tournamentCheckoutProduct(row: Row, source: string, exerciseId: string): Row {
  const productId = str(row, ['id', 'productId', 'subscriptionId', 'clientSubscriptionId', 'oneTimeId', 'clientOneTimeId', 'uuid']);
  if (!id(productId)) throw new ConflictException({ code: 'TOURNAMENT_CHECKOUT_PRODUCT_UNAVAILABLE' });
  const rawType = String(str(row, ['productType', 'type']) ?? '').toUpperCase();
  const type = ['SERVICE', 'GOODS', 'INSTANT_SUB_SERVICE', 'ADVANCE_SUB_SERVICE', 'COMMISSION',
    'FULL_PAYMENT_SERVICE', 'SUBSCRIPTION', 'DEPOSIT'].includes(rawType) ? rawType
    : source === 'subscription' ? 'SUBSCRIPTION' : 'SERVICE';
  const product: Row = { id: productId, name: str(row, ['name', 'title', 'displayName']) ?? 'Продукт Viva', type, count: 1,
    bookingRequests: [{ exerciseId, client: null, comment: null, marketingAttribution: {} }] };
  if (type === 'SUBSCRIPTION') {
    const clientSubscriptionId = str(row, ['clientSubscriptionId', 'subscriptionId']);
    const subscriptionId = str(row, ['subscriptionId']);
    if (clientSubscriptionId) product.clientSubscriptionId = clientSubscriptionId;
    if (subscriptionId) product.subscriptionId = subscriptionId;
  }
  return product;
}

export function tournamentCheckoutReturnUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 2000) throw new BadRequestException('Invalid return URL');
  let url: URL;
  try { url = new URL(value); } catch { throw new BadRequestException('Invalid return URL'); }
  if (!['https://padlhub.ru', 'https://www.padlhub.ru', 'https://padlhub.su', 'https://www.padlhub.su'].includes(url.origin)
    || url.username || url.password) throw new BadRequestException('Invalid return URL');
  return url.toString();
}

@Injectable()
export class TournamentCheckoutService {
  constructor(private readonly tournaments: TournamentsService, private readonly persistence: TournamentsPersistenceService) {}

  private async http(url: string, auth: string | undefined, body?: Row): Promise<unknown> {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { Authorization: auth ?? '', Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new ServiceUnavailableException({ code: 'TOURNAMENT_PROVIDER_UNAVAILABLE' });
    return response.json();
  }

  private rows(value: unknown): Row[] {
    if (Array.isArray(value)) return value.filter(record);
    if (record(value) && value.last !== false) {
      const rows = ['items', 'content', 'data', 'results'].map(k => value[k]).find(Array.isArray);
      if (rows && (!Number.isFinite(value.totalElements) || value.totalElements === rows.length)) return rows.filter(record);
    }
    throw new ServiceUnavailableException({ code: 'TOURNAMENT_CATALOG_INCOMPLETE' });
  }

  private view(operation: Row): Row {
    if (operation.state === 'FAILED') return { operationId: operation.transactionId, state: 'REJECTED', code: operation.ownerRefusal };

    if (operation.ownerCommand?.kind === 'SUBSCRIPTION') return {
      operationId: operation.transactionId, requestOperationId: operation.ownerCommand.requestOperationId,
      actorClientId: operation.clientId, exerciseId: operation.exerciseId,
      clientSubscriptionId: operation.ownerCommand.clientSubscriptionId,
      state: 'ADMITTED', schemaVersion: 1,
    };
    return operation.ownerReceipt ? { ...operation.ownerReceipt, operationId: operation.transactionId } : pending(operation);
  }

  async checkout(ref: string, auth: string | undefined, body: unknown, requestKey: unknown): Promise<Row> {
    if (!id(requestKey)) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    if (!record(body)) throw new BadRequestException('Invalid checkout');
    // Identity and operation lookup precede every fresh rule/catalog read, including alternate keys.
    const context = await this.tournaments.resolveCheckoutIdentity(ref, auth);
    const previous = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm);
    if (previous) return this.resume(context, auth, previous);
    if (!id(body.productId) || !['one-time', 'client-one-time', 'subscription'].includes(body.source)
      || (body.promoCode != null && (typeof body.promoCode !== 'string' || body.promoCode.length > 100))) {
      throw new BadRequestException({ code: 'TOURNAMENT_CHECKOUT_INVALID' });
    }
    const { exerciseId, studioId, tenantKey } = context;
    const v1 = `https://api.vivacrm.ru/end-user/api/v1/${encodeURIComponent(tenantKey)}`;
    const v2 = `https://api.vivacrm.ru/end-user/api/v2/${encodeURIComponent(tenantKey)}`;
    const exercise = await this.http(`${v1}/exercises/${encodeURIComponent(exerciseId)}`, auth);
    const start = record(exercise) ? Date.parse(String(exercise.timeFrom ?? exercise.startsAt ?? '')) : NaN;
    if (!Number.isFinite(start) || start <= Date.now() || !record(exercise) || exercise.id !== exerciseId || exercise.inBooking === true
      || (exercise.studio?.id ?? exercise.studioId) !== studioId
      || exercise.cancelled === true || exercise.canceled === true || exercise.archived === true
      || /CANCEL|DELETE|ARCHIVE/.test(String(exercise.status ?? '').toUpperCase())) {
      throw new ConflictException({ code: 'TOURNAMENT_CHECKOUT_TARGET_UNVERIFIED' });
    }
    const raw = body.source === 'client-one-time' ? exercise.availableClientOneTimes
      : await this.http(`${v2}/products/${body.source === 'subscription' ? 'subscriptions' : 'one-times'}?exerciseId=${encodeURIComponent(exerciseId)}`, auth);
    const matches = this.rows(raw).filter(row => str(row, ['id', 'productId', 'subscriptionId', 'clientSubscriptionId', 'oneTimeId', 'clientOneTimeId', 'uuid']) === body.productId);
    if (matches.length !== 1) throw new ConflictException({ code: 'TOURNAMENT_CHECKOUT_PRODUCT_UNAVAILABLE' });
    const product = tournamentCheckoutProduct(matches[0], body.source, exerciseId);
    const successUrl = tournamentCheckoutReturnUrl(body.successUrl), failUrl = tournamentCheckoutReturnUrl(body.failUrl);
    const payload = { products: [product], clientPhone: context.actor.phoneNorm, paymentMethod: 'WIDGET', exerciseId, studioId,
      promoCode: body.promoCode ?? null,
      ...(successUrl ? { successUrl, baseRedirectUrl: successUrl, redirectUrl: successUrl, returnUrl: successUrl, successRedirectUrl: successUrl } : {}),
      ...(failUrl ? { failUrl, failRedirectUrl: failUrl, failureRedirectUrl: failUrl } : {}) };
    const rule = await this.tournaments.checkCheckoutAdmission(context, auth);
    const operation = this.operation(context, requestKey, { kind: 'CHECKOUT', payload });
    const reserved = await this.persistence.reservePublicJoinPayment(context.tournament.id, operation, rule);
    if (!reserved) {
      const winner = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm);
      if (winner) return this.resume(context, auth, winner);
      throw new ConflictException({ code: 'TOURNAMENT_RULE_OR_CAPACITY_CHANGED' });
    }
    return this.resume(context, auth, operation);
  }

  async subscriptionAdmission(ref: string, auth: string | undefined, body: unknown): Promise<Row> {
    if (!record(body) || !id(body.operationId) || !id(body.clientSubscriptionId)) throw new BadRequestException('Invalid subscription admission');
    const context = await this.tournaments.resolveCheckoutIdentity(ref, auth);
    const previous = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm);
    if (previous) {
      if (previous.ownerCommand?.kind !== 'SUBSCRIPTION'
        || previous.ownerCommand.requestOperationId !== body.operationId
        || previous.ownerCommand.clientSubscriptionId !== body.clientSubscriptionId) {
        throw new ConflictException({ code: 'TOURNAMENT_OPERATION_ALREADY_STARTED', operationId: previous.transactionId });
      }
      return this.view(previous);
    }
    const rule = await this.tournaments.checkCheckoutAdmission(context, auth);
    const operation = this.operation(context, body.operationId, { kind: 'SUBSCRIPTION',
      requestOperationId: body.operationId, clientSubscriptionId: body.clientSubscriptionId });
    const saved = await this.persistence.reservePublicJoinPayment(context.tournament.id, operation, rule);
    if (!saved) {
      const winner = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm);
      if (winner?.ownerCommand?.kind === 'SUBSCRIPTION' && winner.ownerCommand.requestOperationId === body.operationId
        && winner.ownerCommand.clientSubscriptionId === body.clientSubscriptionId) return this.view(winner);
      throw new ConflictException({ code: 'TOURNAMENT_RULE_OR_CAPACITY_CHANGED' });
    }
    return this.view(operation);
  }

  async reconcile(ref: string, auth: string | undefined): Promise<Row> {
    const context = await this.tournaments.resolveCheckoutIdentity(ref, auth);
    const operation = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm);
    if (!operation || operation.clientId !== context.actor.clientId) throw new ConflictException({ code: 'TOURNAMENT_OPERATION_NOT_FOUND' });
    if (operation.ownerCommand?.kind !== 'CHECKOUT' || !id(operation.ownerReceipt?.transactionId)) return this.view(operation);
    const tx = operation.ownerReceipt.transactionId;
    const raw = await this.http(`https://api.vivacrm.ru/end-user/api/v2/${encodeURIComponent(operation.widgetId)}/bookings?size=1000`, auth);
    // A matching exercise alone is not attribution: require this acknowledged transaction.
    const bookings = this.rows(raw).filter(row => (row.exerciseId ?? row.exercise?.id) === operation.exerciseId
      && (row.clientId ?? row.client?.id) === operation.clientId
      && (row.transactionId ?? row.transactionStatus?.transactionId) === tx
      && !row.cancelled && !row.canceled && !row.isCancelled
      && !/CANCEL|REFUND|FAIL|EXPIRE|DELETE/.test(String(row.status ?? '').toUpperCase()));
    if (bookings.length === 1 && id(bookings[0].id)) {
      const status = bookings[0].transactionStatus;
      const paid = ['PAID', 'COMPLETED'].includes(typeof status === 'string' ? status : status?.transactionStatus);
      if (paid) await this.persistence.completeTournamentCheckout(context.tournament.id, operation, bookings[0].id, true);
    }
    return this.view(operation);
  }

  async completeSubscription(ref: string, auth: string | undefined, token: string | undefined, body: unknown): Promise<Row> {
    // Only the authenticated Node-RED write owner can attest its durable confirmed result.
    const actor = await this.tournaments.verifyCheckoutOwner(auth, token);
    const context = await this.tournaments.resolveCheckoutIdentity(ref, auth);
    if (actor.clientId !== context.actor.clientId || actor.phoneNorm !== context.actor.phoneNorm || actor.tenantKey !== context.tenantKey) throw new ConflictException();
    if (!record(body) || !id(body.operationId) || !id(body.clientSubscriptionId) || !id(body.bookingId)) throw new BadRequestException();
    const operation = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, actor.phoneNorm);
    if (!operation) return { state: 'LEGACY_UNTRACKED', requestOperationId: body.operationId };
    if (operation.ownerCommand?.kind !== 'SUBSCRIPTION' || operation.ownerCommand.requestOperationId !== body.operationId
      || operation.ownerCommand.clientSubscriptionId !== body.clientSubscriptionId || operation.clientId !== actor.clientId) {
      throw new ConflictException({ code: 'TOURNAMENT_OPERATION_BINDING_MISMATCH' });
    }
    if (!await this.persistence.completeTournamentCheckout(context.tournament.id, operation, body.bookingId, false)) {
      throw new ServiceUnavailableException({ code: 'TOURNAMENT_COMPLETION_UNRESOLVED' });
    }
    return { state: 'COMPLETED', requestOperationId: body.operationId, bookingId: body.bookingId };
  }

  private operation(context: Awaited<ReturnType<TournamentsService['resolveCheckoutIdentity']>>, key: string, command: Row): Row {
    return { transactionId: `tournament-owner:${randomUUID()}`, state: 'PROVIDER_CREATE_PENDING', operationType: 'TRANSACTION',
      ownerCommand: { ...command, version: 1, requestKey: key }, clientId: context.actor.clientId,
      phone: context.actor.phoneNorm, exerciseId: context.exerciseId, studioId: context.studioId, widgetId: context.tenantKey,
      createdAt: new Date().toISOString() };
  }

  private async resume(context: Awaited<ReturnType<TournamentsService['resolveCheckoutIdentity']>>, auth: string | undefined, operation: Row): Promise<Row> {
    if (operation.clientId !== context.actor.clientId || operation.exerciseId !== context.exerciseId
      || operation.studioId !== context.studioId || operation.widgetId !== context.tenantKey
      || operation.ownerCommand?.version !== 1 || operation.ownerCommand.kind !== 'CHECKOUT') {
      throw new ConflictException({ code: 'TOURNAMENT_OPERATION_ALREADY_STARTED', operationId: operation.transactionId });
    }
    if (operation.ownerReceipt || operation.state !== 'PROVIDER_CREATE_PENDING') return this.view(operation);
    // A persisted preparation is resumable, but never grants a new dispatch on stale facts.
    const currentContext = await this.tournaments.resolveCheckoutIdentity(context.tournament.id, auth);
    if (currentContext.exerciseId !== operation.exerciseId || currentContext.studioId !== operation.studioId
      || currentContext.tenantKey !== operation.widgetId) throw new ConflictException({ code: 'TOURNAMENT_TARGET_CHANGED' });
    let rule;
    try { rule = await this.tournaments.checkCheckoutAdmission(currentContext, auth); }
    catch (error) {
      const code = (error as any)?.getResponse?.()?.code;
      if (['LEVEL_NOT_ALLOWED', 'PLAYER_LEVEL_REQUIRED', 'PLAYER_LEVEL_UNKNOWN', 'ACTIVITY_LEVEL_INVALID',
        'GENDER_NOT_ALLOWED', 'PLAYER_GENDER_REQUIRED'].includes(code)) {
        await this.persistence.rejectTournamentCheckoutPreparation(context.tournament.id, operation, code);
        const winner = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm);
        if (winner && winner.transactionId === operation.transactionId && winner.state !== 'FAILED') return this.view(winner);
      }
      throw error;
    }
    const claimed = await this.persistence.claimTournamentCheckout(context.tournament.id, operation, rule);
    if (!claimed) {
      return this.view(await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm) ?? operation);
    }
    let result: unknown;
    try {
      result = await this.http(`https://api.vivacrm.ru/end-user/api/v2/${encodeURIComponent(operation.widgetId)}/transactions`, auth, operation.ownerCommand.payload);
    } catch { return pending(operation); }
    if (!record(result)) return pending(operation);
    const transactionId = str(result, ['transactionId', 'transaction_id', 'id', 'uuid'])
      ?? str(result.transaction, ['transactionId', 'id']) ?? str(result.data, ['transactionId', 'id']);
    if (!id(transactionId)) return pending(operation);
    // Retain only response fields used by the widget; no provider identity/profile is exposed.
    const receipt = { transactionId, ...(str(result, ['paymentUrl', 'checkoutUrl']) ? { paymentUrl: str(result, ['paymentUrl', 'checkoutUrl']) } : {}) };
    await this.persistence.recordTournamentCheckoutReceipt(context.tournament.id, operation, receipt);
    return { ...receipt, operationId: operation.transactionId };
  }
}
