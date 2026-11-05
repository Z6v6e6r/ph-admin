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

/**
 * Staff credentials forwarded server-side to the resident-services (D) pass
 * preview. They are taken from the already authorized staff request and are
 * never accepted from a request body, stored, logged or returned.
 */
export interface ResidentStaffSession {
  cookie?: string;
  authorization?: string;
}

export interface ResidentPreviewRequest {
  passToken: string;
  stationId: string;
  staffSession: ResidentStaffSession;
}

/**
 * Minimum preview evidence E needs before it may return resident PII.
 *
 * D (resident-services) is the only owner of pass state and residency; E never
 * re-implements those checks. It only requires that D has just confirmed this
 * pass, its station and the resident instance it belongs to.
 */
export interface ResidentPreviewEvidence {
  passId: string;
  subscriptionInstanceId: string;
  stationId: string;
  expiresAt: string;
}

/**
 * Server-side bridge to the D pass preview.
 *
 * The display profile may only be returned for a resident whose pass this
 * staff user has just verified. E therefore calls D preview server-side with
 * the forwarded staff session instead of trusting a browser-supplied
 * subscription instance id.
 */
export interface ResidentPreviewPort {
  previewPass(request: ResidentPreviewRequest): Promise<ResidentPreviewEvidence>;
}

export const RESIDENT_PREVIEW_PORT = Symbol('RESIDENT_PREVIEW_PORT');

/**
 * Failure classes of the preview port. They carry no token, session or PII;
 * the profile service maps them to stable HTTP error codes.
 */
export type ResidentPreviewFailure = 'UNAUTHENTICATED' | 'REJECTED' | 'UNAVAILABLE';

export class ResidentPreviewError extends Error {
  constructor(
    readonly failure: ResidentPreviewFailure,
    readonly code: string
  ) {
    super('Resident pass preview failed');
    this.name = 'ResidentPreviewError';
  }
}

/**
 * Documented D token format: `rsp1_` + base64url random bytes
 * (`docs/resident-services.md` in branch D: 32 bytes -> 43 chars). E accepts a
 * bounded payload range so a D-side length change does not silently turn the
 * profile endpoint into a permissive pass-through; D remains the authority and
 * rejects anything else.
 */
export const RESIDENT_PASS_TOKEN_PATTERN = /^rsp1_[A-Za-z0-9_-]{32,64}$/;

/** Response of POST /api/v1/admin/residency/profile (pass-verified only). */
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
