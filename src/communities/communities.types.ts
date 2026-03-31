export enum CommunityStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  MODERATION = 'MODERATION',
  PRIVATE = 'PRIVATE',
  ARCHIVED = 'ARCHIVED',
  UNKNOWN = 'UNKNOWN'
}

export type CommunitySource = 'LK_PADELHUB' | 'MONGODB';
export type CommunityVisibility = 'OPEN' | 'CLOSED';
export type CommunityJoinRule = 'INSTANT' | 'MODERATED' | 'INVITE_ONLY';
export type CommunityMemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export type CommunityMemberStatus = 'ACTIVE' | 'PENDING' | 'BANNED';

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
}

export interface Community {
  id: string;
  source: CommunitySource;
  name: string;
  slug?: string;
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
  details?: Record<string, unknown>;
}
