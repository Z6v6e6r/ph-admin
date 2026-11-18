/**
 * Server-owned tournament booking (prepared, disabled by default).
 *
 * CUP decides admission (level v2 decision for the verified actor), creates the Viva booking
 * through the admin API and issues the payment through the existing admin booking checkout.
 * Clients never send a level, a price or a provider identifier.
 *
 * Invariants:
 * - One attempt document per (tournament, player): `_id = tournamentId:clientId`. Every transition
 *   is a compare-and-set on `revision`; only the CAS winner calls the provider.
 * - The provider booking call is made at most once per attempt generation. An ambiguous answer
 *   becomes BOOKING_UNKNOWN and is only resolved by a read (`findBooking`), never by a repost.
 * - A started attempt keeps its start decision (owner decision 2026-11-17). The decision is
 *   re-evaluated once immediately before the provider call; a refusal there ends the attempt
 *   without any provider write.
 * - The payment checkout is created at most once per attempt; an ambiguous checkout becomes
 *   PAYMENT_UNKNOWN for manual reconciliation (refunds stay manual in the first version).
 */
import type { TournamentLevelDecision } from './tournament-level-admission';

export const TOURNAMENT_SERVER_BOOKING_SCHEMA_VERSION = 1 as const;
export const TOURNAMENT_SERVER_BOOKING_LEASE_MS = 60_000;

export type TournamentServerBookingMode = 'DISABLED' | 'ENABLED';

export function readTournamentServerBookingMode(env: Record<string, string | undefined>): TournamentServerBookingMode {
  return env.TOURNAMENT_SERVER_BOOKING_MODE?.trim().toLowerCase() === 'enabled' ? 'ENABLED' : 'DISABLED';
}

export type TournamentServerBookingState =
  | 'ADMITTED'
  | 'BOOKING'
  | 'BOOKING_UNKNOWN'
  | 'BOOKED'
  | 'PAYMENT_CREATING'
  | 'PAYMENT_UNKNOWN'
  | 'PAYMENT_PENDING'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'FAILED';

const TERMINAL: ReadonlySet<TournamentServerBookingState> = new Set(['REJECTED', 'FAILED']);

export type TournamentServerBookingErrorCode =
  | 'SERVER_BOOKING_DISABLED'
  | 'SERVER_BOOKING_REQUIRES_LEVEL_ENFORCE'
  | 'SERVER_BOOKING_IDEMPOTENCY_KEY_INVALID'
  | 'SERVER_BOOKING_IN_PROGRESS'
  | 'SERVER_BOOKING_TARGET_INVALID'
  | 'SERVER_BOOKING_PRICE_NOT_CONFIGURED'
  | 'SERVER_BOOKING_STORE_CONFLICT'
  | 'SERVER_BOOKING_NOT_FOUND';

export class TournamentServerBookingError extends Error {
  constructor(
    readonly code: TournamentServerBookingErrorCode,
    readonly httpStatus: number,
    message: string
  ) {
    super(message);
  }
}

/** Server-side price; 100% discount (discountMinor === baseAmountMinor) confirms without payment. */
export interface TournamentServerBookingPrice {
  baseAmountMinor: number;
  discountMinor: number;
  discountReason: string;
  productId: string | null;
}

export interface TournamentServerBookingAdmission {
  tournamentId: string;
  exerciseId: string | null;
  studioId: string | null;
  levelMode: TournamentLevelDecision['mode'];
  decision: TournamentLevelDecision;
  actor: { clientId: string; phone: string };
  price: TournamentServerBookingPrice | null;
  /** Non-level admission refusal (gender, rule changed), evaluated by the existing CUP checks. */
  otherRefusal: { code: string; message: string } | null;
}

export interface DecisionSnapshot {
  allowed: boolean;
  reasonCode: TournamentLevelDecision['reasonCode'];
  ruleVersion: string;
  ruleKind: TournamentLevelDecision['ruleKind'];
  baseRange: TournamentLevelDecision['baseRange'];
  levelTolerance: number;
  effectiveRange: TournamentLevelDecision['effectiveRange'];
  playerLevel: number | null;
  evaluatedAt: string;
}

export interface TournamentServerBookingAttempt {
  _id: string;
  schemaVersion: typeof TOURNAMENT_SERVER_BOOKING_SCHEMA_VERSION;
  tournamentId: string;
  clientId: string;
  exerciseId: string;
  studioId: string;
  idempotencyKey: string;
  generation: number;
  revision: number;
  state: TournamentServerBookingState;
  startDecision: DecisionSnapshot;
  providerDecision: DecisionSnapshot | null;
  price: TournamentServerBookingPrice;
  bookingId: string | null;
  payment: { transactionId: string | null; paymentUrl: string | null; toPayMinor: number; expiresAt: string | null } | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TournamentServerBookingStore {
  find(id: string): Promise<TournamentServerBookingAttempt | null>;
  /** false when a document with this `_id` already exists. */
  insert(doc: TournamentServerBookingAttempt): Promise<boolean>;
  /** Replaces the document only when its stored revision equals `expectedRevision`. */
  replace(doc: TournamentServerBookingAttempt, expectedRevision: number): Promise<boolean>;
}

export type ProviderBookingResult =
  | { outcome: 'CREATED'; bookingId: string }
  | { outcome: 'REJECTED'; reasonCode: string }
  | { outcome: 'UNKNOWN'; reasonCode: string };

export interface VivaAdminBookingPort {
  /** Admin booking for the client. `operationKey` is stable per attempt generation. */
  createBooking(input: { clientId: string; exerciseId: string; studioId: string; phone: string; operationKey: string }): Promise<ProviderBookingResult>;
  /** Read-only recovery: the client's active booking on this exercise, if any. */
  findBooking(input: { clientId: string; exerciseId: string }): Promise<{ bookingId: string } | null | 'UNAVAILABLE'>;
}

export type ProviderCheckoutResult =
  | { outcome: 'CREATED'; transactionId: string | null; paymentUrl: string | null; toPayMinor: number; paid: boolean; expiresAt: string | null }
  | { outcome: 'UNKNOWN'; reasonCode: string };

export interface VivaAdminBookingCheckoutPort {
  createCheckout(input: {
    clientId: string;
    clientPhone: string;
    studioId: string;
    bookingId: string;
    price: TournamentServerBookingPrice;
  }): Promise<ProviderCheckoutResult>;
}

export interface TournamentServerBookingAdmissionPort {
  /** Verifies the bearer and evaluates the CUP level decision for that actor. */
  admit(tournamentRef: string, authorizationHeader: string | undefined): Promise<TournamentServerBookingAdmission>;
}

export interface TournamentServerBookingView {
  tournamentId: string;
  state: TournamentServerBookingState;
  generation: number;
  bookingId: string | null;
  paymentUrl: string | null;
  toPayMinor: number | null;
  errorCode: string | null;
  levelDecision: DecisionSnapshot;
}

export interface TournamentServerBookingRefusal {
  refused: true;
  httpStatus: number;
  code: string;
  message: string;
  levelDecision: TournamentLevelDecision;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;
const PROVIDER_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function snapshotDecision(decision: TournamentLevelDecision): DecisionSnapshot {
  return {
    allowed: decision.allowed,
    reasonCode: decision.reasonCode,
    ruleVersion: decision.ruleVersion,
    ruleKind: decision.ruleKind,
    baseRange: decision.baseRange,
    levelTolerance: decision.levelTolerance,
    effectiveRange: decision.effectiveRange,
    playerLevel: decision.playerLevel,
    evaluatedAt: decision.evaluatedAt
  };
}

/** Reads `details.booking.serverBooking`; anything malformed is "not configured" (fail closed). */
export function parseTournamentServerBookingPrice(value: unknown): TournamentServerBookingPrice | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const base = record.baseAmountMinor;
  const discount = record.discountMinor ?? 0;
  const reason = typeof record.discountReason === 'string' ? record.discountReason.trim() : '';
  if (!Number.isSafeInteger(base) || (base as number) <= 0) return null;
  if (!Number.isSafeInteger(discount) || (discount as number) < 0 || (discount as number) > (base as number)) return null;
  if (!reason || reason.length > 200) return null;
  const productId = typeof record.productId === 'string' && PROVIDER_ID.test(record.productId) ? record.productId : null;
  if (record.productId !== undefined && record.productId !== null && !productId) return null;
  return { baseAmountMinor: base as number, discountMinor: discount as number, discountReason: reason, productId };
}

export class TournamentServerBookingCoordinator {
  constructor(
    private readonly ports: {
      mode: () => TournamentServerBookingMode;
      admission: TournamentServerBookingAdmissionPort;
      store: TournamentServerBookingStore;
      booking: VivaAdminBookingPort;
      checkout: VivaAdminBookingCheckoutPort;
      now?: () => Date;
      log?: (event: string, fields: Record<string, unknown>) => void;
    }
  ) {}

  private now(): string {
    return (this.ports.now?.() ?? new Date()).toISOString();
  }

  private log(event: string, fields: Record<string, unknown>): void {
    this.ports.log?.(event, fields);
  }

  async join(
    tournamentRef: string,
    authorizationHeader: string | undefined,
    idempotencyKey: string | undefined
  ): Promise<TournamentServerBookingView | TournamentServerBookingRefusal> {
    if (this.ports.mode() !== 'ENABLED') {
      throw new TournamentServerBookingError('SERVER_BOOKING_DISABLED', 503, 'Серверная запись на турнир выключена.');
    }
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new TournamentServerBookingError('SERVER_BOOKING_IDEMPOTENCY_KEY_INVALID', 400, 'Нужен корректный Idempotency-Key.');
    }
    const admission = await this.ports.admission.admit(tournamentRef, authorizationHeader);
    if (admission.levelMode !== 'ENFORCE') {
      throw new TournamentServerBookingError(
        'SERVER_BOOKING_REQUIRES_LEVEL_ENFORCE', 503, 'Серверная запись доступна только при включённой проверке уровня.'
      );
    }
    const id = `${admission.tournamentId}:${admission.actor.clientId}`;
    const existing = await this.ports.store.find(id);
    if (existing && !TERMINAL.has(existing.state)) {
      // A started attempt keeps its start decision and is resumed, never re-gated.
      if (existing.idempotencyKey !== idempotencyKey && existing.state === 'BOOKING' && !this.leaseExpired(existing)) {
        throw new TournamentServerBookingError('SERVER_BOOKING_IN_PROGRESS', 409, 'Запись уже выполняется.');
      }
      return this.view(await this.resume(existing, admission));
    }
    if (!admission.decision.allowed || admission.otherRefusal) return this.refusal(admission);
    const { exerciseId, studioId } = admission;
    if (!exerciseId || !studioId || !PROVIDER_ID.test(exerciseId) || !PROVIDER_ID.test(studioId)) {
      throw new TournamentServerBookingError('SERVER_BOOKING_TARGET_INVALID', 409, 'У турнира не настроено занятие Viva.');
    }
    if (!admission.price) {
      throw new TournamentServerBookingError('SERVER_BOOKING_PRICE_NOT_CONFIGURED', 409, 'У турнира не настроена цена серверной записи.');
    }
    const now = this.now();
    const doc: TournamentServerBookingAttempt = {
      _id: id,
      schemaVersion: TOURNAMENT_SERVER_BOOKING_SCHEMA_VERSION,
      tournamentId: admission.tournamentId,
      clientId: admission.actor.clientId,
      exerciseId,
      studioId,
      idempotencyKey,
      generation: (existing?.generation ?? 0) + 1,
      revision: (existing?.revision ?? 0) + 1,
      state: 'ADMITTED',
      startDecision: snapshotDecision(admission.decision),
      providerDecision: null,
      price: admission.price,
      bookingId: null,
      payment: null,
      errorCode: null,
      createdAt: now,
      updatedAt: now
    };
    const stored = existing ? await this.ports.store.replace(doc, existing.revision) : await this.ports.store.insert(doc);
    if (!stored) {
      const current = await this.ports.store.find(id);
      if (!current) throw new TournamentServerBookingError('SERVER_BOOKING_STORE_CONFLICT', 409, 'Повторите попытку.');
      if (TERMINAL.has(current.state)) return this.view(current);
      return this.view(await this.resume(current, admission));
    }
    this.log('tournament_server_booking_admitted', { tournamentId: doc.tournamentId, generation: doc.generation, ruleVersion: doc.startDecision.ruleVersion });
    return this.view(await this.resume(doc, admission));
  }

  /** Read-only status plus the same read-based recovery as a join retry. */
  async status(tournamentRef: string, authorizationHeader: string | undefined): Promise<TournamentServerBookingView> {
    if (this.ports.mode() !== 'ENABLED') {
      throw new TournamentServerBookingError('SERVER_BOOKING_DISABLED', 503, 'Серверная запись на турнир выключена.');
    }
    const admission = await this.ports.admission.admit(tournamentRef, authorizationHeader);
    const existing = await this.ports.store.find(`${admission.tournamentId}:${admission.actor.clientId}`);
    if (!existing) throw new TournamentServerBookingError('SERVER_BOOKING_NOT_FOUND', 404, 'Попытка записи не найдена.');
    if (existing.state === 'BOOKING_UNKNOWN' || (existing.state === 'BOOKING' && this.leaseExpired(existing))) {
      const recovered = await this.recoverBooking(existing);
      return this.view(recovered ?? (await this.ports.store.find(existing._id)) ?? existing);
    }
    return this.view(existing);
  }

  private leaseExpired(doc: TournamentServerBookingAttempt): boolean {
    const updated = Date.parse(doc.updatedAt);
    const now = Date.parse(this.now());
    return !Number.isFinite(updated) || now - updated >= TOURNAMENT_SERVER_BOOKING_LEASE_MS;
  }

  private async transition(
    doc: TournamentServerBookingAttempt,
    patch: Partial<TournamentServerBookingAttempt>
  ): Promise<TournamentServerBookingAttempt | null> {
    const next = { ...doc, ...patch, revision: doc.revision + 1, updatedAt: this.now() };
    return (await this.ports.store.replace(next, doc.revision)) ? next : null;
  }

  private async resume(
    doc: TournamentServerBookingAttempt,
    admission: TournamentServerBookingAdmission
  ): Promise<TournamentServerBookingAttempt> {
    let current = doc;
    for (let step = 0; step < 6; step += 1) {
      const next = await this.advance(current, admission);
      if (!next) {
        // Lost a CAS: another request moved the attempt. Report what is stored now.
        return (await this.ports.store.find(current._id)) ?? current;
      }
      if (next === current) return current;
      current = next;
    }
    return current;
  }

  /** One transition. Returns the same object when nothing more can happen in this request. */
  private async advance(
    doc: TournamentServerBookingAttempt,
    admission: TournamentServerBookingAdmission
  ): Promise<TournamentServerBookingAttempt | null> {
    switch (doc.state) {
      case 'ADMITTED': {
        // Fresh decision immediately before the only provider write of this generation.
        const fresh = admission.decision;
        if (!fresh.allowed || admission.otherRefusal) {
          return this.transition(doc, {
            state: 'REJECTED',
            providerDecision: snapshotDecision(fresh),
            errorCode: fresh.allowed ? admission.otherRefusal!.code : fresh.reasonCode
          });
        }
        const claimed = await this.transition(doc, { state: 'BOOKING', providerDecision: snapshotDecision(fresh) });
        if (!claimed) return null;
        let result: ProviderBookingResult;
        try {
          result = await this.ports.booking.createBooking({
            clientId: claimed.clientId,
            exerciseId: claimed.exerciseId,
            studioId: claimed.studioId,
            phone: admission.actor.phone,
            operationKey: `${claimed._id}:${claimed.generation}`
          });
        } catch {
          result = { outcome: 'UNKNOWN', reasonCode: 'PROVIDER_EXCEPTION' };
        }
        this.log('tournament_server_booking_provider_result', { tournamentId: claimed.tournamentId, generation: claimed.generation, outcome: result.outcome });
        if (result.outcome === 'CREATED' && PROVIDER_ID.test(result.bookingId)) {
          return this.transition(claimed, { state: 'BOOKED', bookingId: result.bookingId });
        }
        if (result.outcome === 'REJECTED') {
          return this.transition(claimed, { state: 'FAILED', errorCode: result.reasonCode });
        }
        return this.transition(claimed, {
          state: 'BOOKING_UNKNOWN',
          errorCode: result.outcome === 'UNKNOWN' ? result.reasonCode : 'PROVIDER_BOOKING_ID_INVALID'
        });
      }
      case 'BOOKING':
        return this.leaseExpired(doc) ? this.recoverBooking(doc) : doc;
      case 'BOOKING_UNKNOWN':
        return this.recoverBooking(doc);
      case 'BOOKED': {
        const claimed = await this.transition(doc, { state: 'PAYMENT_CREATING' });
        if (!claimed || !claimed.bookingId) return null;
        let result: ProviderCheckoutResult;
        try {
          result = await this.ports.checkout.createCheckout({
            clientId: claimed.clientId,
            clientPhone: admission.actor.phone,
            studioId: claimed.studioId,
            bookingId: claimed.bookingId,
            price: claimed.price
          });
        } catch {
          result = { outcome: 'UNKNOWN', reasonCode: 'CHECKOUT_EXCEPTION' };
        }
        if (result.outcome !== 'CREATED') {
          return this.transition(claimed, { state: 'PAYMENT_UNKNOWN', errorCode: result.reasonCode });
        }
        const expectedToPay = claimed.price.baseAmountMinor - claimed.price.discountMinor;
        if (!result.paid && result.toPayMinor !== expectedToPay) {
          return this.transition(claimed, { state: 'PAYMENT_UNKNOWN', errorCode: 'CHECKOUT_AMOUNT_MISMATCH' });
        }
        const payment = {
          transactionId: result.transactionId,
          paymentUrl: result.paymentUrl,
          toPayMinor: result.paid ? 0 : result.toPayMinor,
          expiresAt: result.expiresAt
        };
        return this.transition(claimed, { state: result.paid || payment.toPayMinor === 0 ? 'CONFIRMED' : 'PAYMENT_PENDING', payment });
      }
      default:
        // PAYMENT_CREATING, PAYMENT_UNKNOWN, PAYMENT_PENDING, CONFIRMED and terminal states are
        // reported as stored. Payment confirmation comes from the existing Viva status sync.
        return doc;
    }
  }

  /** Ambiguous booking: resolve only by reading Viva; never repost. */
  private async recoverBooking(doc: TournamentServerBookingAttempt): Promise<TournamentServerBookingAttempt | null> {
    let found: { bookingId: string } | null | 'UNAVAILABLE';
    try {
      found = await this.ports.booking.findBooking({ clientId: doc.clientId, exerciseId: doc.exerciseId });
    } catch {
      found = 'UNAVAILABLE';
    }
    if (found && found !== 'UNAVAILABLE' && PROVIDER_ID.test(found.bookingId)) {
      return this.transition(doc, { state: 'BOOKED', bookingId: found.bookingId, errorCode: null });
    }
    if (doc.state === 'BOOKING') {
      return this.transition(doc, { state: 'BOOKING_UNKNOWN', errorCode: found === 'UNAVAILABLE' ? 'RECOVERY_READ_UNAVAILABLE' : 'BOOKING_NOT_VISIBLE' });
    }
    return doc;
  }

  private refusal(admission: TournamentServerBookingAdmission): TournamentServerBookingRefusal {
    const decision = admission.decision;
    if (decision.allowed && admission.otherRefusal) {
      return { refused: true, httpStatus: 403, ...admission.otherRefusal, levelDecision: decision };
    }
    return {
      refused: true,
      httpStatus: decision.reasonCode === 'LEVEL_CHECK_UNAVAILABLE' ? 503 : 403,
      code: decision.reasonCode,
      message: decision.message,
      levelDecision: decision
    };
  }

  private view(doc: TournamentServerBookingAttempt): TournamentServerBookingView {
    return {
      tournamentId: doc.tournamentId,
      state: doc.state,
      generation: doc.generation,
      bookingId: doc.bookingId,
      paymentUrl: doc.payment?.paymentUrl ?? null,
      toPayMinor: doc.payment ? doc.payment.toPayMinor : null,
      errorCode: doc.errorCode,
      levelDecision: doc.providerDecision ?? doc.startDecision
    };
  }
}
