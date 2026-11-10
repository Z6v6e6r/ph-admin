import { createHash } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { RESIDENCY_PRODUCT_ID } from './residency-booking-policy';

export type ProviderObject = Record<string, any>;
export const residencyDigest = (value: unknown): string => {
  const stable = (v: any): any => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
  return 'sha256:' + createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
};
export function residencyFailure(code: string): never {
  throw new ServiceUnavailableException({ code: 'RESIDENCY_SYNC_' + code });
}
export function residencyRemainingMS(deadline: number): number {
  const remaining = Math.floor(deadline - Date.now());
  if (!Number.isFinite(remaining) || remaining <= 0) residencyFailure('DEADLINE');
  return remaining;
}
/** Bounds read/setup waits; callers must also give cancellable I/O its remaining driver budget. */
export async function withinResidencyDeadline<T>(work: () => Promise<T>, deadline: number): Promise<T> {
  const remaining = residencyRemainingMS(deadline);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ServiceUnavailableException({ code: 'RESIDENCY_SYNC_DEADLINE' })), remaining);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
export const providerObject = (v: unknown): ProviderObject => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) residencyFailure('PROVIDER_SHAPE');
  return v as ProviderObject;
};
export function exactProviderId(values: unknown[], expected?: string): string {
  const ids = values.filter(v => v !== undefined && v !== null);
  if (!ids.length || ids.some(v => typeof v !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/.test(v) || v !== ids[0])
    || (expected !== undefined && ids[0] !== expected)) residencyFailure('PROVIDER_IDENTITY');
  return ids[0] as string;
}
export function providerInstant(value: unknown): string {
  // Viva may return fractional seconds and a numeric zone. Never assume Moscow for zoneless data.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    residencyFailure('PROVIDER_TIMESTAMP');
  }
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const [hour, minute, second] = value.slice(11, 19).split(':').map(Number);
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? '';
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.toISOString().slice(0, 10) !== value.slice(0, 10) || !Number.isFinite(Date.parse(value))
    || hour > 23 || minute > 59 || second > 59 || /[1-9]/.test(fraction.slice(3))) {
    residencyFailure('PROVIDER_TIMESTAMP');
  }
  return new Date(value).toISOString();
}

export interface ResidencyProviderFacts {
  providerClientId: string;
  clientSubscriptionId: string;
  providerProductId: typeof RESIDENCY_PRODUCT_ID;
  transactionId: string;
  providerStatus: string;
  paymentStatus: string;
  purchasedAt: string;
  activeFrom: string | null;
  activeTo: string | null;
  paymentDate: string | null;
  purchaseAmountMinor: number;
  eligible: boolean;
  denialReason: string | null;
  sourceDigest: string;
}

/** Exact owned-client response + its exact linked transaction. No release/price/date inference. */
export function normalizeResidencyProviderFacts(input: {
  providerClientId: string; clientSubscriptionId: string;
  subscription: unknown; transaction: unknown; observedAt: string;
}): ResidencyProviderFacts {
  const s = providerObject(input.subscription), t = providerObject(input.transaction);
  exactProviderId([s.subscriptionId, s.clientSubscriptionId, s.id, s.uuid], input.clientSubscriptionId);
  exactProviderId([s.productId, s.subscriptionProductId, s.product?.id, s.product?.uuid], RESIDENCY_PRODUCT_ID);
  const clientAliases = [s.clientId, s.client?.id, s.client?.uuid, s.client?.clientId].filter(v => v != null);
  if (clientAliases.length) exactProviderId(clientAliases, input.providerClientId);
  const transactionId = exactProviderId([s.transactionId, s.transactionUuid, s.transaction?.id, s.transaction?.uuid]);
  exactProviderId([t.id, t.uuid, t.transactionId], transactionId);
  exactProviderId([t.clientId, t.client?.id, t.client?.uuid, t.client?.clientId], input.providerClientId);
  if (!Array.isArray(t.products) || t.products.length !== 1) residencyFailure('PAYMENT_LINES');
  const line = providerObject(t.products[0]);
  exactProviderId([line.id, line.uuid, line.productId, line.product?.id, t.productId], RESIDENCY_PRODUCT_ID);
  const money = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
  if (line.count !== 1 || !money(line.cost) || !money(line.discount) || line.discount > line.cost
    || t.sum !== line.cost || t.discount !== line.discount || t.toPay !== line.cost - line.discount) residencyFailure('PAYMENT_AMOUNTS');
  const paymentStatus = exactProviderId([t.status, t.state, t.paymentStatus]);
  const providerStatus = exactProviderId([s.status, s.subscriptionStatus, s.state]);
  if (!['PAID', 'UNPAID', 'REFUND', 'REFUNDED', 'WAITING', 'PARTIALLY_REFUNDED', 'PARTIALLY_PAID'].includes(paymentStatus)
    || !['NEW', 'ACTIVE', 'HOLD', 'EXPIRED', 'REFUNDED', 'NO_VISITS', 'FINISHED'].includes(providerStatus)) {
    residencyFailure('PROVIDER_STATE');
  }
  const purchasedAt = providerInstant(s.purchaseDate);
  const activeFrom = s.activationDate == null ? null : providerInstant(s.activationDate);
  const activeTo = s.expirationDate == null ? null : providerInstant(s.expirationDate);
  const paymentDate = t.paymentDate == null ? null : providerInstant(t.paymentDate);
  const observed = Date.parse(providerInstant(input.observedAt));
  if ((paymentStatus === 'PAID' && (!paymentDate || Date.parse(paymentDate) > observed))
    || (paymentStatus === 'UNPAID' && paymentDate)) residencyFailure('PAYMENT_DATE');
  for (const value of [t.refundSum, s.refundSum]) if (value != null && !money(value)) residencyFailure('REFUND_SHAPE');
  for (const row of [s, t, line]) {
    if (row.refundStatus != null && !['NONE', 'PARTIAL', 'FULL'].includes(row.refundStatus)) residencyFailure('REFUND_SHAPE');
    if (row.refunded != null && typeof row.refunded !== 'boolean') residencyFailure('REFUND_SHAPE');
  }
  if (t.transactionRefunds != null && !Array.isArray(t.transactionRefunds)) residencyFailure('REFUND_SHAPE');
  const refunds = (t.transactionRefunds ?? []) as ProviderObject[];
  const refund = !!t.refundedAt || !!s.refundedAt || (t.refundSum ?? 0) > 0 || (s.refundSum ?? 0) > 0
    || [s, t, line].some(row => row.refunded === true || (row.refundStatus != null && row.refundStatus !== 'NONE'))
    || refunds.some(r => !r || r.status !== 'FAILED');
  let frozen = false;
  for (const key of ['holdUntil', 'frozenUntil', 'frozenAt']) {
    if (s[key] != null) {
      const value = providerInstant(s[key]);
      if (key === 'frozenAt' || Date.parse(value) > observed) frozen = true;
    }
  }
  const exactInterval = activeFrom === purchasedAt && activeTo !== null
    && [30 * 86400000, 30 * 86400000 - 1].includes(Date.parse(activeTo) - Date.parse(purchasedAt));
  const denialReason = frozen ? 'FROZEN'
    : refund ? 'REFUND_OR_PENDING_REFUND'
    : paymentStatus !== 'PAID' ? 'NOT_PAID'
      : providerStatus !== 'ACTIVE' ? 'NOT_ACTIVE'
        : !exactInterval ? 'PURCHASE_INTERVAL_UNSUPPORTED'
          : Date.parse(purchasedAt) > observed || Date.parse(activeTo!) <= observed ? 'OUTSIDE_ACTIVE_INTERVAL' : null;
  return { providerClientId: input.providerClientId, clientSubscriptionId: input.clientSubscriptionId,
    providerProductId: RESIDENCY_PRODUCT_ID, transactionId, providerStatus, paymentStatus,
    purchasedAt, activeFrom, activeTo, paymentDate, purchaseAmountMinor: line.cost - line.discount,
    eligible: denialReason === null, denialReason, sourceDigest: residencyDigest({ subscription: s, transaction: t }) };
}

export interface StoredResidencyObservation {
  schemaVersion: 1;
  sourceKind: 'VIVA_OWNED_SUBSCRIPTION_READ';
  subscriptionInstanceId: string;
  tenantId: string;
  providerClientId: string;
  clientSubscriptionId: string;
  clientRefHash: string;
  facts: ResidencyProviderFacts;
  binding: { subscriptionTypeId: string; policyVersion: number; policyDigest: string;
    publicationId: string; mappingId: string };
  evidence: { instanceObservedAt: string; productObservedAt: string; productEvidenceRef: string;
    sourceDigest: string; mappingRevision: number };
  revision: number;
  createdAt: string;
  updatedAt: string;
  refreshId: string;
}

export const RESIDENCY_OBSERVATION_COLLECTION = 'subscription_residency_provider_observations';
export const RESIDENCY_OBSERVATION_INDEXES = [
  { name: 'residency_observation_provider_identity_unique', key: { tenantId: 1, clientSubscriptionId: 1 }, unique: true },
  { name: 'residency_observation_instance_id_unique', key: { subscriptionInstanceId: 1 }, unique: true }
] as const;

export const residencyInstanceId = (tenantId: string, clientSubscriptionId: string): string =>
  'residency_instance:' + residencyDigest({ tenantId, clientSubscriptionId }).slice(7);
