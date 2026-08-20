export type CabinetHomeAdvertisingPlacement =
  | 'cabinet_home'
  | 'cabinet_home_top'
  | 'cabinet_for_me_strip'
  | 'cabinet_for_me_card';

export interface CabinetHomeAdvertisingAdRecord {
  id: string;
  title?: string;
  badgeText?: string;
  footerText?: string;
  href: string;
  imageAssetId: string;
  squareImageAssetId?: string;
  horizontalImageAssetId?: string;
  isActive: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CabinetHomeAdvertisingSettingsRecord {
  key: string;
  rotationEnabled: boolean;
  repeatEveryCards?: number;
  ads: CabinetHomeAdvertisingAdRecord[];
  updatedAt?: string;
  updatedBy?: string;
  auditLog?: AdvertisingAuditRecord[];
}

export interface AdvertisingAssetRecord {
  id: string;
  kind: 'cabinet_home_ad';
  mimeType: string;
  body: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  originalName?: string;
}

export interface CabinetHomeAdvertisingAdminAdItem {
  id: string;
  title?: string;
  badgeText?: string;
  footerText?: string;
  href: string;
  imageAssetId: string;
  imageUrl: string;
  squareImageAssetId?: string;
  squareImageUrl?: string;
  horizontalImageAssetId?: string;
  horizontalImageUrl?: string;
  isActive: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CabinetHomeAdvertisingAdminSnapshot {
  placement: CabinetHomeAdvertisingPlacement;
  rotationEnabled: boolean;
  repeatEveryCards?: number;
  ads: CabinetHomeAdvertisingAdminAdItem[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface CabinetHomeAdvertisingPublicAdItem {
  id: string;
  title?: string;
  badgeText?: string;
  footerText?: string;
  href: string;
  imageUrl: string;
  squareImageUrl?: string;
  horizontalImageUrl?: string;
}

export interface CabinetHomeAdvertisingPublicSnapshot {
  placement: CabinetHomeAdvertisingPlacement;
  rotationEnabled: boolean;
  repeatEveryCards?: number;
  ads: CabinetHomeAdvertisingPublicAdItem[];
  updatedAt?: string;
}

export type AdvertisingEngagementKind = 'IMPRESSION' | 'CLICK';

export interface AdvertisingEngagementRecord {
  eventId: string;
  placement: CabinetHomeAdvertisingPlacement;
  adId: string;
  kind: AdvertisingEngagementKind;
  phoneE164?: string;
  occurredAt: string;
  receivedAt: string;
}

export interface AdvertisingAuditRecord {
  id: string;
  placement: CabinetHomeAdvertisingPlacement;
  actor: string;
  action: 'CREATED' | 'UPDATED' | 'DELETED' | 'SETTINGS_UPDATED';
  adId?: string;
  title?: string;
  changes: string[];
  occurredAt: string;
}

export interface AdvertisingClickedPhone {
  phoneE164: string;
  clickCount: number;
  lastClickedAt: string;
}

export interface AdvertisingAdInsights {
  adId: string;
  impressionCount: number;
  clickCount: number;
  clickThroughRate: number;
  clickedPhones: AdvertisingClickedPhone[];
}

export interface AdvertisingAdminInsightsSnapshot {
  placement: CabinetHomeAdvertisingPlacement;
  ads: AdvertisingAdInsights[];
  auditLog: AdvertisingAuditRecord[];
}

export interface SplitPaymentPromoShareAmounts {
  twoTeams: number;
  fourPlayers: number;
}

export interface SplitPaymentPromoCampaignRecord {
  id: string;
  title: string;
  enabled: boolean;
  activeFrom?: string;
  expiresAt?: string;
  pricingMode: 'PER_PARTICIPANT_HOUR';
  currency: 'RUB';
  stationIds: string[];
  stationNameIncludes: string[];
  roomIds: string[];
  roomNameIncludes: string[];
  shareAmounts: SplitPaymentPromoShareAmounts;
  baseShareAmount: number;
  vivaDirectionId: number;
  vivaExerciseTypeId: number;
}

export interface SplitPaymentPromoSettingsRecord extends Omit<
  SplitPaymentPromoCampaignRecord,
  'id' | 'title'
> {
  key: string;
  promos: SplitPaymentPromoCampaignRecord[];
  updatedAt?: string;
  updatedBy?: string;
}

export type SplitPaymentPromoPublicSnapshot = Omit<
  SplitPaymentPromoSettingsRecord,
  'key' | 'updatedBy'
> & {
  selectedPromoId?: string;
};

export type SplitPaymentPromoAdminSnapshot = Omit<
  SplitPaymentPromoSettingsRecord,
  'key'
>;

export interface SplitPaymentPromoMatchContext {
  stationId?: string;
  stationName?: string;
  roomId?: string;
  roomName?: string;
}
