import { IsEnum } from 'class-validator';
import { AiAssistMode } from '../messenger.types';

export class SetAiModeDto {
  @IsEnum(AiAssistMode)
  mode!: AiAssistMode;
}
