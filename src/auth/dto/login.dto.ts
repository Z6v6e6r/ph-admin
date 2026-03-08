import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  login!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(200)
  password!: string;
}
