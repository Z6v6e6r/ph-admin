export type TelegramCommandMethod = 'sendMessage' | 'answerCallbackQuery';

export type TelegramOutboxStatus = 'PENDING' | 'LEASED' | 'ACKED' | 'FAILED';

export interface TelegramOutboxCommand {
  id: string;
  method: TelegramCommandMethod;
  payload: Record<string, unknown>;
  status: TelegramOutboxStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  leasedUntil?: string;
  ackedAt?: string;
  error?: string;
  providerMessageId?: string;
}
