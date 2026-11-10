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

/** Parse provider timestamp components without assigning a zone to a naive DTO field. */
function providerTimestampParts(value: unknown) {
  if (typeof value !== 'string') residencyFailure('PROVIDER_TIMESTAMP');
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))?$/.exec(value);
  if (!m) residencyFailure('PROVIDER_TIMESTAMP');
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const fraction = (m[7] || '').padEnd(9, '0');
  const clock = new Date(0);
  clock.setUTCFullYear(year, month - 1, day); clock.setUTCHours(hour, minute, second, Number(fraction.slice(0, 3)));
  if (clock.getUTCFullYear() !== year || clock.getUTCMonth() !== month - 1 || clock.getUTCDate() !== day
    || hour > 23 || minute > 59 || second > 59
    || (m[8] && m[8] !== 'Z' && (Number(m[10]) > 14 || Number(m[11]) > 59
      || (Number(m[10]) === 14 && Number(m[11]) !== 0)))) residencyFailure('PROVIDER_TIMESTAMP');
  return { raw: value, match: m, clock, fraction };
}

/** Zoned financial issuance instant: exact ns evidence, floor export and ceil admission bound. */
export function providerPaymentInstant(value: unknown) {
  const { raw, match: m, clock, fraction } = providerTimestampParts(value);
  // RFC3339 -00:00 denotes an unknown local offset, not authoritative UTC.
  if (!m[8] || m[8] === '-00:00') residencyFailure('PAYMENT_TIMESTAMP_ZONE_REQUIRED');
  const offset = m[8] === 'Z' ? 0 : (m[9] === '+' ? 1 : -1) * (Number(m[10]) * 60 + Number(m[11]));
  const floorMs = clock.getTime() - offset * 60000;
  const remainder = BigInt(fraction.slice(3));
  return { raw, exactNs: (BigInt(floorMs) * 1000000n + remainder).toString(), floorMs,
    ceilMs: floorMs + (remainder > 0n ? 1 : 0), canonical: new Date(floorMs).toISOString() };
}

function rawProviderDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  providerTimestampParts(value); // Calendar/shape only. Never invent an offset for the provider field.
  return value as string;
}

export interface ResidencyProviderFacts {
  providerClientId: string;
  clientSubscriptionId: string;
  providerProductId: typeof RESIDENCY_PRODUCT_ID;
  transactionId: string;
  providerStatus: string;
  paymentStatus: string;
  // CUP monetary window; authoritative financial issuance, not Viva counter activation.
  windowOrigin: 'VIVA_PAID_TRANSACTION_PAYMENT_DATE';
  acquisitionInstantNs: string;
  paymentDateRaw: string;
  providerPurchaseDateRaw: string | null;
  providerActivationDateRaw: string | null;
  providerExpirationDateRaw: string | null;
  purchasedAt: string;
  activeFrom: string | null;
  activeTo: string | null;
  paymentDate: string | null;
  purchaseAmountMinor: number;
  eligible: boolean;
  denialReason: string | null;
  sourceDigest: string;
}

/** Exact owned-client response + linked transaction. The published CUP PURCHASE profile owns the monetary window. */
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
  const issued = providerPaymentInstant(t.paymentDate);
  const purchasedAt = issued.canonical, paymentDate = issued.canonical;
  const activeFrom = purchasedAt, activeTo = new Date(issued.floorMs + 30 * 86400000).toISOString();
  const providerPurchaseDateRaw = rawProviderDate(s.purchaseDate);
  const providerActivationDateRaw = rawProviderDate(s.activationDate);
  const providerExpirationDateRaw = rawProviderDate(s.expirationDate);
  const observed = Date.parse(providerInstant(input.observedAt));
  if (issued.ceilMs > observed || paymentStatus === 'UNPAID') residencyFailure('PAYMENT_DATE');
  if (t.paymentMethod === 'NO_PAYMENT' && (t.toPay !== 0 || line.discount !== line.cost)) {
    residencyFailure('NO_PAYMENT_AMOUNT_CONTRADICTION');
  }
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
  // These timestamps belong to provider hold/counter bookkeeping. Presence is a conservative
  // denial; no timezone is guessed to turn ambiguous hold evidence into permission.
  const frozen = ['holdUntil', 'frozenUntil', 'frozenAt'].some(key => rawProviderDate(s[key]) !== null);
  const denialReason = frozen ? 'FROZEN'
    : refund ? 'REFUND_OR_PENDING_REFUND'
      : paymentStatus !== 'PAID' ? 'NOT_PAID'
        : !['NEW', 'ACTIVE'].includes(providerStatus) ? 'NOT_ACTIVE'
          : observed >= Date.parse(activeTo) ? 'OUTSIDE_ACTIVE_INTERVAL' : null;
  return { providerClientId: input.providerClientId, clientSubscriptionId: input.clientSubscriptionId,
    providerProductId: RESIDENCY_PRODUCT_ID, transactionId, providerStatus, paymentStatus,
    windowOrigin: 'VIVA_PAID_TRANSACTION_PAYMENT_DATE', acquisitionInstantNs: issued.exactNs,
    paymentDateRaw: issued.raw, providerPurchaseDateRaw, providerActivationDateRaw, providerExpirationDateRaw,
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
