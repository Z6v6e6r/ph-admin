import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength
} from 'class-validator';
import {
  CommunityMemberRole,
  CommunityMemberStatus
} from '../communities.types';
import { CommunityMemberManageAction } from '../communities-persistence.service';

class CommunityActorDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  name?: string;
}

export class ManageCommunityMemberDto {
  @IsIn(['APPROVE', 'REMOVE', 'BAN'])
  action!: CommunityMemberManageAction;

  @IsObject()
  member!: {
    id?: string;
    phone?: string;
    name?: string;
    avatar?: string | null;
    role?: CommunityMemberRole;
    status?: CommunityMemberStatus;
    levelScore?: number;
    levelLabel?: string;
    joinedAt?: string;
  };

  @IsOptional()
  @IsObject()
  actor?: CommunityActorDto;
}
