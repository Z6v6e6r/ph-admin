export enum CommunityStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  MODERATION = 'MODERATION',
  PAUSED = 'PAUSED',
  HIDDEN = 'HIDDEN',
  PRIVATE = 'PRIVATE',
  ARCHIVED = 'ARCHIVED',
  UNKNOWN = 'UNKNOWN'
}

export type CommunitySource = 'LK_PADELHUB' | 'MONGODB';
export type CommunityVisibility = 'OPEN' | 'CLOSED';
export type CommunityJoinRule = 'INSTANT' | 'MODERATED' | 'INVITE_ONLY';
export type CommunityMemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export type CommunityMemberStatus = 'ACTIVE' | 'PENDING' | 'BANNED';
export type CommunityFeedItemKind = 'NEWS' | 'GAME' | 'TOURNAMENT' | 'EVENT' | 'AD';
export type CommunityFeedItemStatus = 'DRAFT' | 'PUBLISHED' | 'HIDDEN';

export interface CommunityActor {
  id?: string;
  phone?: string;
  name?: string;
}

export interface CommunityMember {
  id?: string;
  phone?: string;
  name: string;
  avatar?: string | null;
  role: CommunityMemberRole;
  status: CommunityMemberStatus;
  levelScore?: number;
  levelLabel?: string;
  joinedAt?: string;
  lastActiveAt?: string;
  warningsCount?: number;
  complaintsCount?: number;
}

export interface CommunityFeedParticipant {
  id?: string;
  name: string;
  avatar?: string | null;
  shortName?: string;
  levelLabel?: string;
}

export interface CommunityFeedItem {
  id: string;
  communityId: string;
  kind: CommunityFeedItemKind;
  status: CommunityFeedItemStatus;
  title: string;
  body?: string;
  imageUrl?: string | null;
  previewLabel?: string;
  ctaLabel?: string;
  startAt?: string;
  endAt?: string;
  stationName?: string;
  courtName?: string;
  levelLabel?: string;
  reportsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  isAdvertisement?: boolean;
  priority?: number;
  placement?: string;
  tags?: string[];
  authorName?: string;
  createdBy?: CommunityActor;
  participants?: CommunityFeedParticipant[];
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  details?: Record<string, unknown>;
}

export interface CommunityFeedTemplateSlot {
  id: string;
  startAt: string;
  endAt: string;
  availablePlaces: number;
}

export interface CommunityFeedTemplateOption {
  id: string;
  title: string;
  description?: string;
  levelLabel?: string;
  ctaLabel?: string;
  slots: CommunityFeedTemplateSlot[];
}

export interface CommunityFeedTemplateSlotsResponse {
  communityId: string;
  stationId: string;
  stationName: string;
  generatedAt: string;
  items: CommunityFeedTemplateOption[];
}

export interface Community {
  id: string;
  source: CommunitySource;
  name: string;
  slug?: string;
  isVerified?: boolean;
  logo?: string | null;
  description?: string;
  city?: string;
  status: CommunityStatus;
  rawStatus?: string;
  visibility?: CommunityVisibility | string;
  joinRule?: CommunityJoinRule | string;
  minimumLevel?: string;
  rules?: string;
  inviteCode?: string;
  inviteLink?: string;
  stationId?: string;
  stationName?: string;
  membersCount?: number;
  moderatorsCount?: number;
  postsCount?: number;
  pendingRequestsCount?: number;
  bannedMembersCount?: number;
  createdAt?: string;
  updatedAt?: string;
  lastActivityAt?: string;
  publicUrl?: string;
  moderationUrl?: string;
  webviewUrl?: string;
  tags?: string[];
  focusTags?: string[];
  createdBy?: CommunityActor;
  members?: CommunityMember[];
  pendingMembers?: CommunityMember[];
  bannedMembers?: CommunityMember[];
  feedItems?: CommunityFeedItem[];
  details?: Record<string, unknown>;
}
