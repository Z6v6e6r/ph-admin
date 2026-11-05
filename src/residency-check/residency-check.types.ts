/**
 * Contract notes for the mobile resident check screen.
 *
 * E owns only:
 * - the staff-auth page + isolated client assets;
 * - one read-only display-profile endpoint (name/photo) that never invents PII.
 *
 * Resident pass preview, service availability, issuance, return and the journal
 * are owned by the resident-services domain (branch D) and are called by the
 * browser directly through the existing staff admin API.
 */

export interface ResidentProfileRecord {
  displayName?: string;
  avatarUrl?: string | null;
}

/** Read-only port implemented by SubscriptionsVivaResidentProfileAdapter. */
export interface ResidentProfilePort {
  profileBySubscriptionInstance(
    subscriptionInstanceId: string
  ): Promise<ResidentProfileRecord | null>;
}

export const RESIDENT_PROFILE_PORT = Symbol('RESIDENT_PROFILE_PORT');

/** Response of GET /api/v1/admin/residency/profile. */
export interface ResidentProfileResponse {
  subscriptionInstanceId: string;
  fullName: string;
  photoUrl: string | null;
}

/** Resident-services (D) view shapes used by the screen; reference only. */
export type ResidentServiceKind = 'RACKET' | 'TOWEL';
export type ResidentIssuanceState = 'ISSUED' | 'PARTIALLY_RETURNED' | 'RETURNED';
export type ResidentJournalEventType = 'ISSUANCE_CONFIRMED' | 'ITEM_RETURNED';

export interface ResidentPassPreview {
  schemaVersion: 1;
  passId: string;
  state: 'ACTIVE' | 'CONSUMED';
  issuedAt: string;
  expiresAt: string;
  stationId: string;
  resident: {
    confirmed: true;
    subscriptionInstanceId: string;
    subscriptionTypeId: string;
    subscriptionTypeTitle: string;
    activeFrom: string;
    activeTo: string;
    homeStationId: string;
  };
  services: Array<{
    serviceKind: ResidentServiceKind;
    label: string;
    returnable: boolean;
    limitPeriod: 'DAY' | 'WEEK' | 'MONTH' | 'SUBSCRIPTION' | null;
    limitQuantity: number | null;
    used: number;
    remaining: number;
    available: boolean;
    blocker: string | null;
  }>;
  issuable: boolean;
}

export interface ResidentIssuanceView {
  schemaVersion: 1;
  issuanceId: string;
  operationId: string;
  state: ResidentIssuanceState;
  stationId: string;
  subscriptionInstanceId: string;
  issuedAt: string;
  returnedAt: string | null;
  resident: {
    subscriptionTypeId: string;
    subscriptionTypeTitle: string;
    activeFrom: string;
    activeTo: string;
  };
  items: Array<{
    serviceKind: ResidentServiceKind;
    label: string;
    quantity: number;
    returnable: boolean;
    returnedQuantity: number;
    limitPeriod: 'DAY' | 'WEEK' | 'MONTH' | 'SUBSCRIPTION';
    limitQuantity: number;
    remainingAfter: number;
  }>;
}

export interface ResidentReturnView {
  schemaVersion: 1;
  returnId: string;
  issuanceId: string;
  stationId: string;
  returnedAt: string;
  items: Array<{ serviceKind: ResidentServiceKind; label: string; quantity: number }>;
  issuanceState: ResidentIssuanceState;
  issuanceItems: ResidentIssuanceView['items'];
}

export interface ResidentJournalEntryView {
  eventId: string;
  eventType: ResidentJournalEventType;
  issuanceId: string;
  returnId: string | null;
  stationId: string;
  actorId: string;
  occurredAt: string;
  items: Array<{ serviceKind: ResidentServiceKind; label: string; quantity: number }>;
}

export interface ResidentJournalPage {
  items: ResidentJournalEntryView[];
  nextCursor: string | null;
}
