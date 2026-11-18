import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TournamentsService } from './tournaments.service';
import { TournamentsPersistenceService } from './tournaments-persistence.service';

type Row = Record<string, any>;
type CheckoutContext = Awaited<ReturnType<TournamentsService['resolveCheckoutIdentity']>>;
const record = (x: unknown): x is Row => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: Row, keys: string[]) => keys.map(k => x?.[k]).find(v => typeof v === 'string' && v.trim())?.trim();
const id = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(x);
const safelyRefused = (operation: Row) => operation.state === 'FAILED' && operation.ownerNoDispatch === true
  && !operation.providerCreateAttemptedAt && !operation.providerTransactionId && !operation.providerBookingId && !operation.ownerReceipt;
const permitsFreshAttempt = (operation: Row) => safelyRefused(operation) || operation.state === 'OWNER_CANCELLED';
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
    if (operation.state === 'OWNER_CANCELLED') return {
      operationId: operation.transactionId, state: 'CANCELLED', code: 'TOURNAMENT_BOOKING_CANCELLED',
      actorClientId: operation.clientId, requestKey: operation.ownerCommand?.requestKey
    };
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
    let context = await this.tournaments.resolveCheckoutIdentity(ref, auth);
    const replay = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm, { requestKey });
    if (replay) return this.resume(context, auth, replay);
    const reconciled = await this.reconcilePreviousCancellation(context, auth);
    const previous = reconciled.operation;
    context = reconciled.context;
    if (previous && !permitsFreshAttempt(previous)) return this.resume(context, auth, previous);
    this.tournaments.assertTournamentOwnerNewOperationsOpen();
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
    let rule;
    try {
      rule = await this.tournaments.checkCheckoutAdmission(context, auth);
    } catch (error) {
      if (!(error instanceof ForbiddenException) || (error.getResponse() as Row)?.code !== 'TOURNAMENT_RULE_CHANGED') throw error;
      // The first writer can advance updatedAt by reserving the same actor's
      // seat. Resolve that original operation before surfacing a rule conflict.
      const winner = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm, { requestKey })
        ?? await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm);
      if (!winner || permitsFreshAttempt(winner)) throw error;
      return this.resume(context, auth, winner);
    }
    const operation = this.operation(context, requestKey, { kind: 'CHECKOUT', payload });
    const reserved = await this.persistence.reservePublicJoinPayment(context.tournament.id, operation, rule);
    if (!reserved) {
      const winner = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm, { requestKey })
        ?? await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm);
      if (winner && !permitsFreshAttempt(winner)) return this.resume(context, auth, winner);
      throw new ConflictException({ code: 'TOURNAMENT_RULE_OR_CAPACITY_CHANGED' });
    }
    return this.resume(context, auth, operation);
  }

  async subscriptionAdmission(ref: string, auth: string | undefined, body: unknown): Promise<Row> {
    if (!record(body) || !id(body.operationId) || !id(body.clientSubscriptionId)) throw new BadRequestException('Invalid subscription admission');
    let context = await this.tournaments.resolveCheckoutIdentity(ref, auth);
    const replay = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm, { requestKey: body.operationId });
    const reconciled = replay ? { operation: replay, context } : await this.reconcilePreviousCancellation(context, auth);
    const previous = reconciled.operation;
    context = reconciled.context;
    if (previous && (replay || !permitsFreshAttempt(previous))) {
      if (!this.boundToContext(previous, context) || previous.ownerCommand?.kind !== 'SUBSCRIPTION'
        || previous.ownerCommand.requestOperationId !== body.operationId
        || previous.ownerCommand.clientSubscriptionId !== body.clientSubscriptionId) {
        throw new ConflictException({ code: 'TOURNAMENT_OPERATION_ALREADY_STARTED', operationId: previous.transactionId });
      }
      return this.view(previous);
    }
    this.tournaments.assertTournamentOwnerNewOperationsOpen();
    const rule = await this.tournaments.checkCheckoutAdmission(context, auth);
    const operation = this.operation(context, body.operationId, { kind: 'SUBSCRIPTION',
      requestOperationId: body.operationId, clientSubscriptionId: body.clientSubscriptionId });
    const saved = await this.persistence.reservePublicJoinPayment(context.tournament.id, operation, rule);
    if (!saved) {
      const winner = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm);
      if (winner?.ownerCommand?.kind === 'SUBSCRIPTION' && this.boundToContext(winner, context) && winner.ownerCommand.requestOperationId === body.operationId
        && winner.ownerCommand.clientSubscriptionId === body.clientSubscriptionId) return this.view(winner);
      throw new ConflictException({ code: 'TOURNAMENT_RULE_OR_CAPACITY_CHANGED' });
    }
    return this.view(operation);
  }

  private boundToContext(operation: Row, context: CheckoutContext): boolean {
    return operation.clientId === context.actor.clientId && operation.phone === context.actor.phoneNorm
      && operation.exerciseId === context.exerciseId && operation.studioId === context.studioId
      && operation.widgetId === context.tenantKey && operation.ownerCommand?.version === 1;
  }

  private async readProviderBookings(operation: Row, auth?: string, history = false): Promise<Row[]> {
    const storedBooking = operation.providerBookingId ?? operation.ownerReceipt?.bookingId;
    const tx = operation.ownerReceipt?.transactionId;
    if (operation.ownerCommand?.kind === 'CHECKOUT' ? !id(tx) : !id(storedBooking)) return [];
    const page = history ? '/history?includeCanceled=true&size=1000' : '?size=1000';
    const raw = await this.http(`https://api.vivacrm.ru/end-user/api/v2/${encodeURIComponent(operation.widgetId)}/bookings${page}`, auth);
    return this.rows(raw).filter(row => id(row.id)
      && (row.exerciseId ?? row.exercise?.id) === operation.exerciseId
      && (row.clientId ?? row.client?.id) === operation.clientId
      && (!storedBooking || row.id === storedBooking)
      && (operation.ownerCommand.kind !== 'CHECKOUT' || (row.transactionId ?? row.transactionStatus?.transactionId) === tx));
  }

  private bookingCancelled(booking: Row): boolean {
    const status = String(booking.status ?? '').toUpperCase();
    const flags = [booking.cancelled, booking.canceled, booking.isCancelled];
    if (flags.some(flag => flag === false)) return false;
    return status === 'CANCELLED' || status === 'CANCELED' || (!status && flags.some(flag => flag === true));
  }

  private async readCancelledBooking(operation: Row, auth?: string, bookingId?: string): Promise<Row | undefined> {
    if (bookingId && operation.providerBookingId && bookingId !== operation.providerBookingId) return undefined;
    const history = await this.readProviderBookings(operation, auth, true);
    if (history.length !== 1 || (bookingId && history[0].id !== bookingId) || !this.bookingCancelled(history[0])) return undefined;
    const active = await this.readProviderBookings(operation, auth);
    return active.some(booking => !this.bookingCancelled(booking)) ? undefined : history[0];
  }

  private async reconcilePreviousCancellation(context: CheckoutContext, auth?: string): Promise<{ operation: Row | null; context: CheckoutContext }> {
    const operation = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm);
    if (!operation || !this.boundToContext(operation, context) || permitsFreshAttempt(operation)) return { operation, context };
    let booking: Row | undefined;
    try { booking = await this.readCancelledBooking(operation, auth); } catch { return { operation, context }; }
    if (!booking || !await this.persistence.cancelTournamentCheckout(context.tournament.id, operation, booking.id)) return { operation, context };
    // Re-read both the fresh rule revision and a possible concurrent successor.
    const refreshed = await this.tournaments.resolveCheckoutIdentity(context.exerciseId, auth);
    if (refreshed.tournament.id !== context.tournament.id || !this.boundToContext(operation, refreshed)) {
      throw new ConflictException({ code: 'TOURNAMENT_TARGET_CHANGED' });
    }
    return { context: refreshed, operation: await this.persistence.readTournamentCheckoutOperation(
      refreshed.tournament.id, refreshed.actor.phoneNorm
    ) };
  }

  async reconcile(ref: string, auth: string | undefined, cancelledBookingId?: unknown): Promise<Row> {
    if (cancelledBookingId !== undefined && !id(cancelledBookingId)) throw new BadRequestException();
    const context = await this.tournaments.resolveCheckoutIdentity(ref, auth);
    const operation = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm);
    if (!operation || !this.boundToContext(operation, context)) {
      if (cancelledBookingId) return { state: 'NOT_TRACKED' };
      throw new ConflictException({ code: 'TOURNAMENT_OPERATION_NOT_FOUND' });
    }
    if (operation.state === 'OWNER_CANCELLED') {
      return cancelledBookingId && operation.providerBookingId !== cancelledBookingId
        ? { state: 'NOT_TRACKED' } : this.view(operation);
    }
    let cancelled: Row | undefined;
    try { cancelled = await this.readCancelledBooking(operation, auth, cancelledBookingId); }
    catch (error) { if (cancelledBookingId) throw error; }
    if (cancelled && await this.persistence.cancelTournamentCheckout(context.tournament.id, operation, cancelled.id)) {
      return this.view({ ...operation, state: 'OWNER_CANCELLED' });
    }
    const matches = cancelledBookingId || operation.ownerCommand?.kind !== 'CHECKOUT'
      ? [] : await this.readProviderBookings(operation, auth);
    const booking = matches.length === 1 ? matches[0] : undefined;
    if (booking
      && !booking.cancelled && !booking.canceled && !booking.isCancelled
      && !/CANCEL|REFUND|FAIL|EXPIRE|DELETE/.test(String(booking.status ?? '').toUpperCase())) {
      const status = booking.transactionStatus;
      const paid = ['PAID', 'COMPLETED'].includes(typeof status === 'string' ? status : status?.transactionStatus);
      if (paid) await this.persistence.completeTournamentCheckout(context.tournament.id, operation, booking.id, true);
    }
    if (cancelledBookingId && operation.providerBookingId !== cancelledBookingId && !operation.ownerReceipt?.transactionId) return { state: 'NOT_TRACKED' };
    return cancelledBookingId ? pending(operation) : this.view(operation);
  }

  async completeSubscription(ref: string, auth: string | undefined, token: string | undefined, body: unknown): Promise<Row> {
    // Only the authenticated Node-RED write owner can attest its durable confirmed result.
    const actor = await this.tournaments.verifyCheckoutOwner(auth, token);
    const context = await this.tournaments.resolveCheckoutIdentity(ref, auth);
    if (actor.clientId !== context.actor.clientId || actor.phoneNorm !== context.actor.phoneNorm || actor.tenantKey !== context.tenantKey) throw new ConflictException();
    if (!record(body) || !id(body.operationId) || !id(body.clientSubscriptionId) || !id(body.bookingId)) throw new BadRequestException();
    const operation = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, actor.phoneNorm, { requestKey: body.operationId });
    if (!operation) {
      const other = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, actor.phoneNorm);
      if (other) throw new ConflictException({ code: 'TOURNAMENT_OPERATION_BINDING_MISMATCH' });
      return { state: 'LEGACY_UNTRACKED', requestOperationId: body.operationId };
    }
    if ((body.ownerOperationId !== undefined && operation.transactionId !== body.ownerOperationId)
      || !this.boundToContext(operation, context) || operation.ownerCommand?.kind !== 'SUBSCRIPTION' || operation.ownerCommand.requestOperationId !== body.operationId
      || operation.ownerCommand.clientSubscriptionId !== body.clientSubscriptionId || operation.clientId !== actor.clientId) {
      throw new ConflictException({ code: 'TOURNAMENT_OPERATION_BINDING_MISMATCH' });
    }
    if (operation.state === 'OWNER_CANCELLED') throw new ConflictException({ code: 'TOURNAMENT_BOOKING_CANCELLED' });
    if (!await this.persistence.completeTournamentCheckout(context.tournament.id, operation, body.bookingId, false)) {
      throw new ServiceUnavailableException({ code: 'TOURNAMENT_COMPLETION_UNRESOLVED' });
    }
    return { state: 'COMPLETED', requestOperationId: body.operationId, bookingId: body.bookingId };
  }

  async abortSubscription(ref: string, auth: string | undefined, token: string | undefined, body: unknown): Promise<Row> {
    const actor = await this.tournaments.verifyCheckoutOwner(auth, token);
    const context = await this.tournaments.resolveCheckoutIdentity(ref, auth);
    if (actor.clientId !== context.actor.clientId || actor.phoneNorm !== context.actor.phoneNorm
      || actor.tenantKey !== context.tenantKey) throw new ConflictException();
    if (!record(body) || !id(body.operationId) || !id(body.ownerOperationId) || !id(body.clientSubscriptionId)
      || body.proof !== 'PRE_DISPATCH_REJECTED_V1'
      || body.code !== 'SUBSCRIPTION_ELIGIBILITY_CHANGED_BEFORE_WRITE') throw new BadRequestException();
    const selector = { transactionId: body.ownerOperationId, requestKey: body.operationId };
    const operation = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, actor.phoneNorm, selector);
    if (!operation || operation.ownerCommand?.kind !== 'SUBSCRIPTION'
      || operation.ownerCommand.requestOperationId !== body.operationId
      || operation.ownerCommand.clientSubscriptionId !== body.clientSubscriptionId
      || operation.clientId !== actor.clientId || operation.widgetId !== context.tenantKey
      || operation.exerciseId !== context.exerciseId || operation.studioId !== context.studioId) {
      throw new ConflictException({ code: 'TOURNAMENT_OPERATION_BINDING_MISMATCH' });
    }
    await this.persistence.abortTournamentSubscription(context.tournament.id, operation, body.code);
    // Read the exact original row after every attempt, including retries after a lost HTTP ACK.
    const current = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, actor.phoneNorm, selector);
    const binding = { ownerOperationId: operation.transactionId, requestOperationId: body.operationId,
      actorClientId: actor.clientId, exerciseId: operation.exerciseId, clientSubscriptionId: body.clientSubscriptionId };
    if (current?.state === 'OWNER_COMPLETED') return { ...binding, state: 'COMPLETED', bookingId: current.providerBookingId };
    if (current && safelyRefused(current) && current.ownerRefusal === body.code) return { ...binding, state: 'ABORTED' };
    throw new ServiceUnavailableException({ code: 'TOURNAMENT_ABORT_UNRESOLVED' });
  }

  private operation(context: CheckoutContext, key: string, command: Row): Row {
    return { transactionId: `tournament-owner:${randomUUID()}`, state: 'PROVIDER_CREATE_PENDING', operationType: 'TRANSACTION',
      ownerCommand: { ...command, version: 1, requestKey: key }, clientId: context.actor.clientId,
      phone: context.actor.phoneNorm, exerciseId: context.exerciseId, studioId: context.studioId, widgetId: context.tenantKey,
      createdAt: new Date().toISOString() };
  }

  private async resume(context: CheckoutContext, auth: string | undefined, operation: Row): Promise<Row> {
    if (operation.clientId !== context.actor.clientId || operation.exerciseId !== context.exerciseId
      || operation.studioId !== context.studioId || operation.widgetId !== context.tenantKey
      || operation.ownerCommand?.version !== 1 || operation.ownerCommand.kind !== 'CHECKOUT') {
      throw new ConflictException({ code: 'TOURNAMENT_OPERATION_ALREADY_STARTED', operationId: operation.transactionId });
    }
    if (operation.ownerReceipt || operation.state !== 'PROVIDER_CREATE_PENDING') return this.view(operation);
    // A persisted preparation is resumable, but never grants a new dispatch on stale facts.
    const currentContext = await this.tournaments.resolveCheckoutIdentity(context.exerciseId, auth);
    if (currentContext.tournament.id !== context.tournament.id
      || currentContext.exerciseId !== operation.exerciseId || currentContext.studioId !== operation.studioId
      || currentContext.tenantKey !== operation.widgetId) throw new ConflictException({ code: 'TOURNAMENT_TARGET_CHANGED' });
    let rule;
    try { rule = await this.tournaments.checkCheckoutAdmission(currentContext, auth); }
    catch (error) {
      const code = (error as any)?.getResponse?.()?.code;
      if (['LEVEL_NOT_ALLOWED', 'PLAYER_LEVEL_REQUIRED', 'PLAYER_LEVEL_UNKNOWN', 'ACTIVITY_LEVEL_INVALID',
        'GENDER_NOT_ALLOWED', 'PLAYER_GENDER_REQUIRED'].includes(code)) {
        await this.persistence.rejectTournamentCheckoutPreparation(context.tournament.id, operation, code);
        const winner = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm, { transactionId: operation.transactionId });
        if (winner && winner.transactionId === operation.transactionId && winner.state !== 'FAILED') return this.view(winner);
      }
      throw error;
    }
    const claimed = await this.persistence.claimTournamentCheckout(context.tournament.id, operation, rule, currentContext.mappingChecks);
    if (!claimed) {
      const original = await this.persistence.readTournamentCheckoutOperation(context.tournament.id, context.actor.phoneNorm, {
        transactionId: operation.transactionId, requestKey: operation.ownerCommand.requestKey
      });
      return this.view(original ?? operation);
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
