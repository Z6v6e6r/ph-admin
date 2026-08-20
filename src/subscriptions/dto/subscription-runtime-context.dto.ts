import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;

export class SubscriptionRuntimeContextDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  @Matches(ID_PATTERN)
  clientSubscriptionId!: string;
}
