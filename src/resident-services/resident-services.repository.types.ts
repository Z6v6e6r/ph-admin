import type {
  ResidentBenefitStationScope,
  ResidentServiceKind,
  ResidentServiceLimitPeriod,
  StoredResidentJournalEvent
} from './resident-services.types';

export interface ResidentBenefitRuleWrite {
  stationScopeKey: string;
  stationScope: ResidentBenefitStationScope;
  limitPeriod: ResidentServiceLimitPeriod;
  limitQuantity: number;
  returnable: boolean;
  enabled: boolean;
  updatedBy: string;
  updatedAt: string;
}

export interface ResidentServiceConsumptionResult {
  used: number;
  remaining: number;
}

export interface ResidentJournalCursor {
  occurredAt: string;
  eventId: string;
}

export interface ResidentJournalQuery {
  tenantId: string;
  stationIds: string[] | null;
  stationId?: string;
  from?: string;
  to?: string;
  limit: number;
  cursor: ResidentJournalCursor | null;
}

export interface ResidentJournalPage {
  items: StoredResidentJournalEvent[];
  nextCursor: ResidentJournalCursor | null;
}
