import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength
} from 'class-validator';
import {
  AdvertisingEngagementKind,
  CabinetHomeAdvertisingPlacement
} from '../advertising.types';

export class RecordAdvertisingEngagementDto {
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/)
  eventId!: string;

  @IsIn([
    'cabinet_home',
    'cabinet_home_top',
    'cabinet_for_me_strip',
    'cabinet_for_me_card'
  ])
  placement!: CabinetHomeAdvertisingPlacement;

  @IsString()
  @MaxLength(120)
  adId!: string;

  @IsIn(['IMPRESSION', 'CLICK'])
  kind!: AdvertisingEngagementKind;

  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/)
  phoneE164?: string;

  @IsDateString()
  occurredAt!: string;
}
