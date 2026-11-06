export type ResidentServiceKind = 'TOWEL' | 'RACKET';
export type ResidentPassState = 'ACTIVE' | 'CONSUMED';
export type ResidentServiceLimitPeriod = 'DAY' | 'WEEK' | 'MONTH' | 'SUBSCRIPTION' | 'MANUAL_PER_ISSUANCE';
export type ResidentServiceIssuanceState = 'ISSUED' | 'PARTIALLY_RETURNED' | 'RETURNED';
export type ResidentServiceJournalEventType = 'ISSUANCE_CONFIRMED' | 'ITEM_RETURNED';

export const RESIDENT_SERVICE_KINDS: readonly ResidentServiceKind[] = ['TOWEL', 'RACKET'];
export const RESIDENT_SERVICE_LIMIT_PERIODS: readonly ResidentServiceLimitPeriod[] = [
  'DAY',
  'WEEK',
  'MONTH',
  'SUBSCRIPTION',
  'MANUAL_PER_ISSUANCE'
];
export const RESIDENT_SERVICE_LABELS: Record<ResidentServiceKind, string> = {
  TOWEL: 'Полотенце',
  RACKET: 'Ракетка'
};

export const RESIDENT_SERVICES_TIMEZONE = 'Europe/Moscow';
export const RESIDENT_SERVICES_MAX_PASS_TTL_SECONDS = 120;
export const RESIDENT_SERVICES_MIN_PASS_TTL_SECONDS = 30;
export const RESIDENT_SERVICES_MAX_EVIDENCE_AGE_SECONDS = 86400;
export const RESIDENT_SERVICES_MIN_EVIDENCE_AGE_SECONDS = 30;
export const RESIDENT_SERVICES_MAX_LIMIT_QUANTITY = 1000;
export const RESIDENT_SERVICES_MAX_ITEM_QUANTITY = 10;
export const RESIDENT_SERVICES_MAX_RULES_PER_TYPE = 100;
export const RESIDENT_SERVICES_JOURNAL_PAGE_SIZE = 50;
export const RESIDENT_SERVICES_JOURNAL_MAX_PAGE_SIZE = 200;

export const RESIDENT_SERVICES_ERROR_CODES = {
  DISABLED: 'RESIDENT_SERVICES_DISABLED',
  NOT_CONFIGURED: 'RESIDENT_SERVICES_NOT_CONFIGURED',
  INTEGRATION_FORBIDDEN: 'RESIDENT_SERVICES_INTEGRATION_FORBIDDEN',
  CONFIG_INVALID: 'RESIDENT_SERVICES_CONFIG_INVALID',
  PERSISTENCE_UNAVAILABLE: 'RESIDENT_SERVICES_PERSISTENCE_UNAVAILABLE',
  REQUEST_INVALID: 'RESIDENT_SERVICES_REQUEST_INVALID',
  UNTRUSTED_ORIGIN: 'RESIDENT_SERVICES_UNTRUSTED_ORIGIN',
  IDEMPOTENCY_KEY_INVALID: 'RESIDENT_SERVICES_IDEMPOTENCY_KEY_INVALID',
  IDEMPOTENCY_CONFLICT: 'RESIDENT_SERVICES_IDEMPOTENCY_CONFLICT',
  PASS_NOT_FOUND: 'RESIDENT_PASS_NOT_FOUND',
  PASS_INVALID: 'RESIDENT_PASS_INVALID',
  PASS_EXPIRED: 'RESIDENT_PASS_EXPIRED',
  PASS_ALREADY_USED: 'RESIDENT_PASS_ALREADY_USED',
  NOT_ACTIVE: 'RESIDENT_NOT_ACTIVE',
  TERM_EXPIRED: 'RESIDENT_TERM_EXPIRED',
  EVIDENCE_STALE: 'RESIDENT_EVIDENCE_STALE',
  EVIDENCE_INVALID: 'RESIDENT_EVIDENCE_INVALID',
  MAPPING_NOT_CURRENT: 'RESIDENT_MAPPING_NOT_CURRENT',
  MAPPING_STALE: 'RESIDENT_MAPPING_STALE',
  POLICY_NOT_CURRENT: 'RESIDENT_POLICY_NOT_CURRENT',
  TYPE_NOT_FOUND: 'RESIDENT_TYPE_NOT_FOUND',
  INSTANCE_NOT_FOUND: 'RESIDENT_INSTANCE_NOT_FOUND',
  STATION_REQUIRED: 'RESIDENT_STATION_REQUIRED',
  STATION_FORBIDDEN: 'RESIDENT_STATION_FORBIDDEN',
  SERVICE_NOT_CONFIGURED: 'RESIDENT_SERVICE_NOT_CONFIGURED',
  SERVICE_LIMIT_EXCEEDED: 'RESIDENT_SERVICE_LIMIT_EXCEEDED',
  SERVICE_NOT_RETURNABLE: 'RESIDENT_SERVICE_NOT_RETURNABLE',
  SERVICE_ALREADY_RETURNED: 'RESIDENT_SERVICE_ALREADY_RETURNED',
  SERVICE_NOT_ISSUED: 'RESIDENT_SERVICE_NOT_ISSUED',
  ISSUANCE_NOT_FOUND: 'RESIDENT_ISSUANCE_NOT_FOUND',
  ISSUANCE_REVISION_CONFLICT: 'RESIDENT_ISSUANCE_REVISION_CONFLICT',
  BENEFIT_RULE_NOT_FOUND: 'RESIDENT_BENEFIT_RULE_NOT_FOUND',
  BENEFIT_RULE_CONFLICT: 'RESIDENT_BENEFIT_RULE_CONFLICT',
  BENEFIT_RULE_INVALID: 'RESIDENT_BENEFIT_RULE_INVALID',
  BENEFIT_RULE_REVISION_CONFLICT: 'RESIDENT_BENEFIT_RULE_REVISION_CONFLICT',
  RETRY_CONFLICT: 'RESIDENT_SERVICES_RETRY_CONFLICT'
} as const;

export interface ResidentServiceItemCommand {
  serviceKind: ResidentServiceKind;
  quantity: number;
}

export interface StoredResidentPass {
  schemaVersion: 1;
  passId: string;
  tenantId: string;
  subscriptionInstanceId: string;
  clientRefHash: string;
  tokenHash: string;
  state: ResidentPassState;
  issuedAt: string;
  expiresAt: string;
  expiresAtDate: Date;
  consumedAt: string | null;
  consumedBy: string | null;
  consumedOperationId: string | null;
  consumedStationId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type ResidentBenefitStationScope =
  | { kind: 'ALL_STATIONS'; stationIds: [] }
  | { kind: 'STATION_LIST'; stationIds: string[] };

export interface StoredResidentBenefitRule {
  schemaVersion: 1;
  ruleId: string;
  tenantId: string;
  subscriptionTypeId: string;
  serviceKind: ResidentServiceKind;
  stationScopeKey: string;
  stationScope: ResidentBenefitStationScope;
  limitPeriod: ResidentServiceLimitPeriod;
  limitQuantity: number;
  returnable: boolean;
  enabled: boolean;
  revision: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  idempotency?: {
    actorId: string;
    keyHash: string;
    requestHash: string;
    correlationId: string;
  };
}

export interface StoredResidentServiceUsage {
  schemaVersion: 1;
  tenantId: string;
  clientRefHash: string;
  subscriptionInstanceId: string;
  lastSubscriptionInstanceId: string;
  serviceKind: ResidentServiceKind;
  limitPeriod: ResidentServiceLimitPeriod;
  periodKey: string;
  used: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredResidentIssuanceItem {
  serviceKind: ResidentServiceKind;
  quantity: number;
  returnable: boolean;
  returnedQuantity: number;
  benefitRuleId: string;
  benefitRuleRevision: number;
  limitPeriod: ResidentServiceLimitPeriod;
  limitPeriodKey: string;
  limitQuantity: number;
  remainingAfter: number;
}

export interface StoredResidentIssuanceResidency {
  subscriptionTypeId: string;
  subscriptionTypeTitle: string;
  activeFrom: string;
  activeTo: string;
  policyVersion: number;
  policyDigest: string;
  evidenceAsOf: string;
}

export interface StoredResidentIssuance {
  schemaVersion: 1;
  issuanceId: string;
  tenantId: string;
  subscriptionInstanceId: string;
  clientRefHash: string;
  passId: string;
  stationId: string;
  actorId: string;
  state: ResidentServiceIssuanceState;
  items: StoredResidentIssuanceItem[];
  residency: StoredResidentIssuanceResidency;
  idempotency: { keyHash: string; requestHash: string };
  correlationId: string;
  issuedAt: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  returnedAt: string | null;
  lastReturnId: string | null;
}

export interface StoredResidentReturn {
  schemaVersion: 1;
  returnId: string;
  tenantId: string;
  issuanceId: string;
  idempotency: { keyHash: string; requestHash: string };
  correlationId: string;
  actorId: string;
  stationId: string;
  items: Array<{ serviceKind: ResidentServiceKind; quantity: number }>;
  issuanceState: ResidentServiceIssuanceState;
  issuanceItems: StoredResidentIssuanceItem[];
  returnedAt: string;
  createdAt: string;
}

export interface StoredResidentJournalEvent {
  schemaVersion: 1;
  eventId: string;
  tenantId: string;
  eventType: ResidentServiceJournalEventType;
  issuanceId: string;
  returnId: string | null;
  passId: string | null;
  stationId: string;
  actorId: string;
  subscriptionInstanceId: string;
  items: Array<{ serviceKind: ResidentServiceKind; quantity: number }>;
  occurredAt: string;
  correlationId: string;
}

export interface ResidentPassView {
  schemaVersion: 1;
  passId: string;
  token: string;
  issuedAt: string;
  expiresAt: string;
  subscriptionInstanceId: string;
  residency: {
    subscriptionTypeId: string;
    subscriptionTypeTitle: string;
    activeFrom: string;
    activeTo: string;
  };
}

export interface ResidentServiceAvailabilityView {
  serviceKind: ResidentServiceKind;
  label: string;
  returnable: boolean;
  limitPeriod: ResidentServiceLimitPeriod | null;
  limitQuantity: number | null;
  used: number;
  remaining: number;
  available: boolean;
  blocker: string | null;
}

export interface ResidentPassPreviewView {
  schemaVersion: 1;
  passId: string;
  state: ResidentPassState;
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
  services: ResidentServiceAvailabilityView[];
  issuable: boolean;
}

export type ResidentPassStatusState = ResidentPassState | 'EXPIRED';

export interface ResidentPassStatusView {
  schemaVersion: 1;
  passId: string;
  state: ResidentPassStatusState;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
  stationId: string | null;
}

export interface ResidentIssuanceView {
  schemaVersion: 1;
  issuanceId: string;
  operationId: string;
  state: ResidentServiceIssuanceState;
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
    limitPeriod: ResidentServiceLimitPeriod;
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
  issuanceState: ResidentServiceIssuanceState;
  issuanceItems: ResidentIssuanceView['items'];
}

export interface ResidentJournalEntryView {
  eventId: string;
  eventType: ResidentServiceJournalEventType;
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

export interface ResidentBenefitRuleView {
  ruleId: string;
  subscriptionTypeId: string;
  subscriptionTypeTitle: string | null;
  serviceKind: ResidentServiceKind;
  stationScope: ResidentBenefitStationScope;
  limitPeriod: ResidentServiceLimitPeriod;
  limitQuantity: number;
  returnable: boolean;
  enabled: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
