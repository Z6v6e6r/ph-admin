export enum CommunityStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  MODERATION = 'MODERATION',
  PRIVATE = 'PRIVATE',
  ARCHIVED = 'ARCHIVED',
  UNKNOWN = 'UNKNOWN'
}

export interface Community {
  id: string;
  source: 'LK_PADELHUB';
  name: string;
  slug?: string;
  description?: string;
  status: CommunityStatus;
  rawStatus?: string;
  visibility?: string;
  stationId?: string;
  stationName?: string;
  membersCount?: number;
  moderatorsCount?: number;
  postsCount?: number;
  pendingRequestsCount?: number;
  createdAt?: string;
  updatedAt?: string;
  lastActivityAt?: string;
  publicUrl?: string;
  moderationUrl?: string;
  webviewUrl?: string;
  tags?: string[];
  details?: Record<string, unknown>;
}
