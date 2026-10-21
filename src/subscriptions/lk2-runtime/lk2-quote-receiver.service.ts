import { randomUUID, timingSafeEqual } from 'node:crypto';

import type { SubscriptionsRepository } from '../subscriptions.repository';
import type { StoredLk2QuoteDecisionJournalEntry } from '../subscriptions.types';
import {
  verifyLk2QuoteDelegation,
  type Lk2QuoteDelegationConfig,
  type Lk2QuoteRequestForDigest,
  type VerifiedLk2QuoteDelegation,
} from './lk2-quote-delegation.verifier';

export const LK2_QUOTE_CONTRACT_VERSION = 1;
export const LK2_QUOTE_PATH = '/api/internal/subscription-runtime/lk2/v1/quote';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const HEADER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const QUOTE_ACTIONS = ['CREATE_GAME', 'JOIN_GAME'] as const;
const TARGET_KINDS = ['GAME'] as const;
const PAYMENT_INTENTS = ['AUTO_BEST_PRICE', 'PAY_FULL_PRICE', 'USE_SUBSCRIPTION'] as const;
const OUTCOMES = [
  'ENTITLEMENT_APPLIED',
  'FULL_PRICE_ONLY',
  'SUBSCRIPTION_SELECTION_REQUIRED',
  'PRICE_CONFIRMATION_REQUIRED',
  'SERVICE_BLOCKED',
  'RETRY_LATER',
  'RECONCILIATION_REQUIRED',
] as const;
const BENEFIT_KINDS = [
  'NONE',
  'FREE_ENTITLEMENT',
  'FIXED_PRICE',
  'FIXED_DISCOUNT',
  'PERCENT_DISCOUNT',
  'PARTIAL_PRICE_PERCENT_DISCOUNT',
] as const;

export type Lk2QuoteAction = (typeof QUOTE_ACTIONS)[number];
export type Lk2QuoteOutcome = (typeof OUTCOMES)[number];
export type Lk2QuotePaymentIntent = (typeof PAYMENT_INTENTS)[number];
export type Lk2QuoteBenefitKind = (typeof BENEFIT_KINDS)[number];

export interface Lk2QuoteRequest extends Lk2QuoteRequestForDigest {
  readonly action: Lk2QuoteAction;
  readonly target: { readonly kind: 'GAME'; readonly id: string; readonly expectedRevision?: number };
}

export interface Lk2QuoteOutcomeBody {
  readonly contractVersion: 1;
  readonly nonBinding: true;
  readonly requiresReservationRecheck: true;
  readonly outcome: Lk2QuoteOutcome;
  readonly paymentIntent: Lk2QuotePaymentIntent;
  readonly decisionId: string;
  readonly serviceAllowed: boolean;
  readonly subscriptionBenefitAllowed: boolean;
  readonly selectedSubscription: {
    readonly subscriptionInstanceId: string;
    readonly policyVersion: number;
    readonly policyDigest: string;
  } | null;
  readonly benefit: {
    readonly kind: Lk2QuoteBenefitKind;
    readonly ruleId: string | null;
    readonly usageUnits: number;
  } | null;
  readonly price: {
    readonly priceRevision: number;
    readonly basePriceMinor: number;
    readonly discountMinor: number;
    readonly surchargeMinor: number;
    readonly finalPriceMinor: number;
    readonly currency: 'RUB';
  } | null;
  readonly limits: {
    readonly activeServices: number | null;
    readonly activeServicesLimit: number | null;
    readonly dailyUsed: number | null;
    readonly dailyLimit: number | null;
    readonly weeklyUsed: number | null;
    readonly weeklyLimit: number | null;
    readonly monthlyUsed: number | null;
    readonly monthlyLimit: number | null;
    readonly remainingUnits: number | null;
  };
  readonly blockers: readonly { readonly code: string }[];
  readonly warnings: readonly { readonly code: string }[];
  readonly alternatives: readonly {
    readonly paymentIntent: 'PAY_FULL_PRICE';
    readonly requiresExplicitUserConfirmation: true;
  }[];
  readonly evaluatedAt: string;
  readonly expiresAt: string;
}

export interface Lk2QuoteEvaluation {
  readonly outcome: Lk2QuoteOutcome;
  readonly serviceAllowed: boolean;
  readonly subscriptionBenefitAllowed: boolean;
  readonly selectedSubscription: Lk2QuoteOutcomeBody['selectedSubscription'];
  readonly benefit: Lk2QuoteOutcomeBody['benefit'];
  readonly price: Lk2QuoteOutcomeBody['price'];
  readonly limits: Lk2QuoteOutcomeBody['limits'];
  readonly blockers: readonly { readonly code: string }[];
  readonly warnings: readonly { readonly code: string }[];
  readonly alternatives: Lk2QuoteOutcomeBody['alternatives'];
}

export class Lk2QuoteEvaluationUnavailable extends Error {
  public constructor(public readonly reasonCode: string) {
    super(reasonCode);
    this.name = 'Lk2QuoteEvaluationUnavailable';
  }
}

export interface Lk2QuoteEvaluator {
  evaluate(input: {
    readonly delegation: VerifiedLk2QuoteDelegation;
    readonly request: Lk2QuoteRequest;
    readonly correlationId: string;
  }): Promise<Lk2QuoteEvaluation>;
}

export interface Lk2QuoteDecisionJournal {
  append(entry: StoredLk2QuoteDecisionJournalEntry): Promise<void>;
}

export interface Lk2QuoteDelegationReplayStore {
  /** Returns true when this `(kid, jti)` pair has not been consumed before. */
  claim(input: {
    readonly keyId: string;
    readonly jti: string;
    readonly tenantId: string;
    readonly expiresAt: string;
  }): Promise<boolean>;
}

/** Single-process source boundary. A durable store is required before activation. */
export class InMemoryLk2QuoteDelegationReplayStore implements Lk2QuoteDelegationReplayStore {
  private readonly seen = new Map<string, number>();

  public async claim(input: {
    readonly keyId: string;
    readonly jti: string;
    readonly tenantId: string;
    readonly expiresAt: string;
  }): Promise<boolean> {
    const now = Date.now();
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(key);
    }
    const key = `${input.keyId}\0${input.jti}`;
    if (this.seen.has(key)) return false;
    this.seen.set(key, Date.parse(input.expiresAt));
    return true;
  }
}

/** Durable append-only decision journal used by the operator registry. */
export class MongoLk2QuoteDecisionJournalStore implements Lk2QuoteDecisionJournal {
  public constructor(
    private readonly repository: Pick<
      SubscriptionsRepository,
      'connect' | 'appendLk2QuoteDecision'
    >,
  ) {}

  public async append(entry: StoredLk2QuoteDecisionJournalEntry): Promise<void> {
    await this.repository.connect();
    await this.repository.appendLk2QuoteDecision(entry);
  }
}

/**
 * Durable single-use store. The replay collection is unique on `(keyId, jti)` and TTL-indexed on
 * `expiresAt`; index provisioning stays with the guarded subscriptions index script.
 */
export class MongoLk2QuoteDelegationReplayStore implements Lk2QuoteDelegationReplayStore {
  public constructor(
    private readonly repository: Pick<
      SubscriptionsRepository,
      'connect' | 'claimLk2QuoteDelegationReplay'
    >,
  ) {}

  public async claim(input: {
    readonly keyId: string;
    readonly jti: string;
    readonly tenantId: string;
    readonly expiresAt: string;
  }): Promise<boolean> {
    await this.repository.connect();
    return this.repository.claimLk2QuoteDelegationReplay({
      keyId: input.keyId,
      jti: input.jti,
      tenantId: input.tenantId,
      expiresAt: new Date(input.expiresAt),
    });
  }
}

export class Lk2QuoteReceiverError extends Error {
  public constructor(
    public readonly status: 400 | 403 | 409 | 503,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'Lk2QuoteReceiverError';
  }
}

export function parseLk2QuoteRequest(value: unknown): Lk2QuoteRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Lk2QuoteReceiverError(400, 'LK2_QUOTE_REQUEST_INVALID');
  const row = value as Record<string, unknown>;
  const target = row.target;
  const targetKeys = new Set(['kind', 'id', 'expectedRevision']);
  if (
    Object.keys(row).some((key) => !['action', 'target', 'preferredSubscriptionInstanceId', 'paymentIntent'].includes(key)) ||
    !QUOTE_ACTIONS.includes(row.action as Lk2QuoteAction) ||
    !target ||
    typeof target !== 'object' ||
    Array.isArray(target) ||
    Object.keys(target).some((key) => !targetKeys.has(key)) ||
    (target as Record<string, unknown>).kind !== TARGET_KINDS[0] ||
    typeof (target as Record<string, unknown>).id !== 'string' ||
    !ID_PATTERN.test((target as Record<string, unknown>).id as string) ||
    ((target as Record<string, unknown>).expectedRevision !== undefined &&
      (!Number.isSafeInteger((target as Record<string, unknown>).expectedRevision) ||
        Number((target as Record<string, unknown>).expectedRevision) < 1)) ||
    (row.preferredSubscriptionInstanceId !== undefined &&
      (typeof row.preferredSubscriptionInstanceId !== 'string' ||
        !ID_PATTERN.test(row.preferredSubscriptionInstanceId))) ||
    !PAYMENT_INTENTS.includes(row.paymentIntent as Lk2QuotePaymentIntent)
  ) {
    throw new Lk2QuoteReceiverError(400, 'LK2_QUOTE_REQUEST_INVALID');
  }
  return {
    action: row.action as Lk2QuoteAction,
    target: {
      kind: 'GAME',
      id: (target as Record<string, unknown>).id as string,
      ...((target as Record<string, unknown>).expectedRevision === undefined
        ? {}
        : { expectedRevision: Number((target as Record<string, unknown>).expectedRevision) }),
    },
    ...(row.preferredSubscriptionInstanceId === undefined
      ? {}
      : { preferredSubscriptionInstanceId: row.preferredSubscriptionInstanceId as string }),
    paymentIntent: row.paymentIntent as Lk2QuotePaymentIntent,
  };
}

export interface Lk2QuoteReceiverOptions {
  readonly enabled: boolean;
  readonly integrationToken?: string;
  readonly delegationConfig?: Lk2QuoteDelegationConfig;
  readonly replayStore?: Lk2QuoteDelegationReplayStore;
  readonly evaluator?: Lk2QuoteEvaluator;
  readonly journal?: Lk2QuoteDecisionJournal;
  readonly now?: () => number;
  readonly onMetric?: (metric: {
    readonly outcome: 'success' | 'rejected' | 'uncertain';
    readonly durationMs: number;
  }) => void;
}

const NULL_LIMITS: Lk2QuoteOutcomeBody['limits'] = {
  activeServices: null,
  activeServicesLimit: null,
  dailyUsed: null,
  dailyLimit: null,
  weeklyUsed: null,
  weeklyLimit: null,
  monthlyUsed: null,
  monthlyLimit: null,
  remainingUnits: null,
};

export class Lk2QuoteReceiverService {
  private readonly now: () => number;

  public constructor(private readonly options: Lk2QuoteReceiverOptions) {
    this.now = options.now ?? Date.now;
  }

  public async receive(input: {
    readonly integrationToken: string | undefined;
    readonly actorDelegation: string | undefined;
    readonly contractVersion: string | undefined;
    readonly idempotencyKey: string | undefined;
    readonly correlationId: string | undefined;
    readonly body: unknown;
  }): Promise<Lk2QuoteOutcomeBody> {
    const startedAt = this.now();
    this.assertEnabledAndConfigured();
    this.assertIntegrationToken(input.integrationToken);
    if (
      input.contractVersion !== String(LK2_QUOTE_CONTRACT_VERSION) ||
      typeof input.idempotencyKey !== 'string' ||
      !HEADER_PATTERN.test(input.idempotencyKey) ||
      typeof input.correlationId !== 'string' ||
      !HEADER_PATTERN.test(input.correlationId) ||
      typeof input.actorDelegation !== 'string'
    ) {
      this.emit('rejected', startedAt);
      throw new Lk2QuoteReceiverError(400, 'LK2_QUOTE_ENVELOPE_INVALID');
    }
    const request = parseLk2QuoteRequest(input.body);
    let delegation: VerifiedLk2QuoteDelegation;
    try {
      delegation = verifyLk2QuoteDelegation({
        token: input.actorDelegation,
        config: this.options.delegationConfig!,
        request,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
      });
    } catch {
      this.emit('rejected', startedAt);
      throw new Lk2QuoteReceiverError(403, 'LK2_QUOTE_DELEGATION_REJECTED');
    }
    const claimed = await this.options.replayStore!.claim({
      keyId: delegation.keyId,
      jti: delegation.jti,
      tenantId: delegation.tenantId,
      expiresAt: new Date(delegation.expiresAt * 1000).toISOString(),
    });
    if (!claimed) {
      this.emit('rejected', startedAt);
      throw new Lk2QuoteReceiverError(409, 'LK2_QUOTE_DELEGATION_REPLAYED');
    }
    const evaluatedAt = new Date(this.now()).toISOString();
    const expiresAt = new Date(this.now() + 30_000).toISOString();
    let evaluation: Lk2QuoteEvaluation;
    try {
      evaluation = await this.options.evaluator!.evaluate({
        delegation,
        request,
        correlationId: input.correlationId,
      });
    } catch (error) {
      if (!(error instanceof Lk2QuoteEvaluationUnavailable)) throw error;
      const uncertain = this.uncertain({
        paymentIntent: request.paymentIntent,
        reasonCode: error.reasonCode,
        evaluatedAt,
        expiresAt,
      });
      await this.recordDecision(uncertain, delegation, request, input.correlationId);
      this.emit('uncertain', startedAt);
      return uncertain;
    }
    const outcome: Lk2QuoteOutcomeBody = {
      contractVersion: 1,
      nonBinding: true,
      requiresReservationRecheck: true,
      outcome: evaluation.outcome,
      paymentIntent: request.paymentIntent,
      decisionId: randomUUID(),
      serviceAllowed: evaluation.serviceAllowed,
      subscriptionBenefitAllowed: evaluation.subscriptionBenefitAllowed,
      selectedSubscription: evaluation.selectedSubscription,
      benefit: evaluation.benefit,
      price: evaluation.price,
      limits: evaluation.limits,
      blockers: evaluation.blockers,
      warnings: evaluation.warnings,
      alternatives: evaluation.alternatives,
      evaluatedAt,
      expiresAt,
    };
    await this.recordDecision(outcome, delegation, request, input.correlationId);
    this.emit('success', startedAt);
    return outcome;
  }

  private uncertain(input: {
    readonly paymentIntent: Lk2QuotePaymentIntent;
    readonly reasonCode: string;
    readonly evaluatedAt: string;
    readonly expiresAt: string;
  }): Lk2QuoteOutcomeBody {
    return {
      contractVersion: 1,
      nonBinding: true,
      requiresReservationRecheck: true,
      outcome: 'RETRY_LATER',
      paymentIntent: input.paymentIntent,
      decisionId: randomUUID(),
      serviceAllowed: false,
      subscriptionBenefitAllowed: false,
      selectedSubscription: null,
      benefit: null,
      price: null,
      limits: NULL_LIMITS,
      blockers: [{ code: input.reasonCode }],
      warnings: [],
      alternatives: [],
      evaluatedAt: input.evaluatedAt,
      expiresAt: input.expiresAt,
    };
  }

  private async recordDecision(
    outcome: Lk2QuoteOutcomeBody,
    delegation: VerifiedLk2QuoteDelegation,
    request: Lk2QuoteRequest,
    correlationId: string,
  ): Promise<void> {
    if (!this.options.journal) return;
    try {
      await this.options.journal.append({
        decisionId: outcome.decisionId,
        tenantId: delegation.tenantId,
        correlationId,
        action: request.action,
        targetId: request.target.id,
        subscriptionInstanceId: outcome.selectedSubscription?.subscriptionInstanceId ?? null,
        outcome: outcome.outcome,
        serviceAllowed: outcome.serviceAllowed,
        subscriptionBenefitAllowed: outcome.subscriptionBenefitAllowed,
        blockers: outcome.blockers.map((blocker) => blocker.code),
        policyVersion: outcome.selectedSubscription?.policyVersion ?? null,
        policyDigest: outcome.selectedSubscription?.policyDigest ?? null,
        evaluatedAt: outcome.evaluatedAt,
        recordedAt: new Date().toISOString(),
      });
    } catch {
      throw new Lk2QuoteReceiverError(503, 'LK2_QUOTE_JOURNAL_UNAVAILABLE');
    }
  }

  private assertEnabledAndConfigured(): void {
    if (
      !this.options.enabled ||
      !this.options.delegationConfig ||
      !this.options.replayStore ||
      !this.options.evaluator ||
      !this.options.journal
    ) {
      throw new Lk2QuoteReceiverError(503, 'SUBSCRIPTION_RUNTIME_LK2_QUOTE_DISABLED');
    }
  }

  private assertIntegrationToken(supplied: string | undefined): void {
    const expected = String(this.options.integrationToken ?? '').trim();
    if (Buffer.byteLength(expected, 'utf8') < 32) {
      throw new Lk2QuoteReceiverError(503, 'SUBSCRIPTION_RUNTIME_LK2_QUOTE_NOT_CONFIGURED');
    }
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(String(supplied ?? '').trim());
    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      throw new Lk2QuoteReceiverError(403, 'SUBSCRIPTION_RUNTIME_LK2_QUOTE_FORBIDDEN');
    }
  }

  private emit(outcome: 'success' | 'rejected' | 'uncertain', startedAt: number): void {
    try {
      this.options.onMetric?.({
        outcome,
        durationMs: Math.max(0, this.now() - startedAt),
      });
    } catch {
      /* telemetry cannot change the quote boundary */
    }
  }
}
