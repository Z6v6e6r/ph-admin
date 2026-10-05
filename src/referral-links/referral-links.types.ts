export type ReferralLinkStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export interface StoredReferralLink {
  linkId: string;
  publicToken: string;
  campaignName: string;
  recipientName: string;
  recipientExternalRef?: string;
  targetUrl: string;
  validFrom: string;
  validTo: string;
  timezone: string;
  status: ReferralLinkStatus;
  legacyAttributionKey?: string;
  revision: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  idempotency?: {
    actorId: string;
    key: string;
    intentHash: string;
  };
}

export interface ReferralOpenEvent {
  eventId: string;
  linkId: string;
  publicToken: string;
  visitId: string;
  kind: 'OPEN';
  occurredAt: string;
  receivedAt: string;
  dayKey: string;
  referrerOrigin?: string;
}

export interface ReferralSaleSnapshot {
  paymentRef: string;
  transactionId?: string;
  visitId?: string;
  trainerQrCode?: string;
  clientPhone?: string;
  clientId?: string;
  clientName?: string;
  productId?: string;
  productName?: string;
  planKey?: string;
  campaignKey?: string;
  amountMinor?: number;
  toPayMinor?: number;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  paidAt?: string;
}

export interface ReferralLinkDailyMetrics {
  date: string;
  opens: number;
  uniqueVisits: number;
  checkoutStarts: number;
  paidPurchases: number;
  uniqueBuyers: number;
}

export interface ReferralLinkTotals {
  opens: number;
  uniqueVisits: number;
  checkoutStarts: number;
  paidPurchases: number;
  uniqueBuyers: number;
  checkoutNotPaid: number;
  visitToCheckoutPercent: number;
  checkoutToPaidPercent: number;
  visitToPaidPercent: number;
}

export interface ReferralLinkJourney {
  visitId?: string;
  openedAt?: string;
  paymentRef?: string;
  transactionId?: string;
  clientPhoneMasked?: string;
  clientPhone?: string;
  clientId?: string;
  clientName?: string;
  checkoutAt?: string;
  paidAt?: string;
  productId?: string;
  productName?: string;
  planKey?: string;
  amountMinor?: number;
  status: 'OPEN_ONLY' | 'CHECKOUT_NOT_PAID' | 'PAID';
  paymentStatus?: string;
}

export interface ReferralLinkView extends Omit<StoredReferralLink, 'publicToken' | 'idempotency'> {
  publicUrl: string;
}

export interface ReferralLinkAnalytics {
  link: ReferralLinkView;
  period: { from: string; to: string };
  totals: ReferralLinkTotals;
  daily: ReferralLinkDailyMetrics[];
  journeys: ReferralLinkJourney[];
}

export interface ReferralLinkListItem extends ReferralLinkView {
  totals: ReferralLinkTotals;
}

export interface ReferralLinkListResponse {
  items: ReferralLinkListItem[];
  period: { from: string; to: string };
  persistence: 'MONGODB';
}

export interface ReferralLinkRedirect {
  targetUrl: string;
  visitId: string;
  cookieName: string;
  cookieMaxAgeSeconds: number;
}
