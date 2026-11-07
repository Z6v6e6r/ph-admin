import { IsString, Matches, MaxLength } from 'class-validator';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;

export class CreateResidentPassDto {
  @IsString()
  @MaxLength(200)
  @Matches(ID_PATTERN)
  clientSubscriptionId!: string;
}
