import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class RequestGamePlayerRemovalDto {
  @IsIn(['RETURN_VISIT', 'NO_RETURN'])
  refundPolicy!: 'RETURN_VISIT' | 'NO_RETURN';

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
}
