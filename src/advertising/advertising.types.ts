export interface CabinetHomeAdvertisingAdRecord {
  id: string;
  title?: string;
  href: string;
  imageAssetId: string;
  isActive: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CabinetHomeAdvertisingSettingsRecord {
  key: string;
  rotationEnabled: boolean;
  ads: CabinetHomeAdvertisingAdRecord[];
  updatedAt?: string;
  updatedBy?: string;
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
  href: string;
  imageAssetId: string;
  imageUrl: string;
  isActive: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CabinetHomeAdvertisingAdminSnapshot {
  placement: 'cabinet_home';
  rotationEnabled: boolean;
  ads: CabinetHomeAdvertisingAdminAdItem[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface CabinetHomeAdvertisingPublicAdItem {
  id: string;
  title?: string;
  href: string;
  imageUrl: string;
}

export interface CabinetHomeAdvertisingPublicSnapshot {
  placement: 'cabinet_home';
  rotationEnabled: boolean;
  ads: CabinetHomeAdvertisingPublicAdItem[];
  updatedAt?: string;
}

export interface SplitPaymentPromoShareAmounts {
  twoTeams: number;
  fourPlayers: number;
}

export interface SplitPaymentPromoSettingsRecord {
  key: string;
  enabled: boolean;
  stationIds: string[];
  stationNameIncludes: string[];
  roomIds: string[];
  roomNameIncludes: string[];
  shareAmounts: SplitPaymentPromoShareAmounts;
  baseShareAmount: number;
  vivaDirectionId: number;
  vivaExerciseTypeId: number;
  updatedAt?: string;
  updatedBy?: string;
}

export type SplitPaymentPromoPublicSnapshot = Omit<
  SplitPaymentPromoSettingsRecord,
  'key' | 'updatedBy'
>;

export type SplitPaymentPromoAdminSnapshot = Omit<
  SplitPaymentPromoSettingsRecord,
  'key'
>;
