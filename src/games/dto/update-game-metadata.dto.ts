import { IsObject } from 'class-validator';

export class UpdateGameMetadataDto {
  @IsObject()
  metadata!: Record<string, unknown>;
}
