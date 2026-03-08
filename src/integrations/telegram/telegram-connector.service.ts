import { ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RequestUser } from '../../common/rbac/request-user.interface';
import { Role } from '../../common/rbac/role.enum';
import { CreateMessageDto } from '../../messenger/dto/create-message.dto';
import { CreateThreadDto } from '../../messenger/dto/create-thread.dto';
import {
  ChatMessage,
  ChatThread,
  ConnectorRoute,
  ThreadStatus
} from '../../messenger/messenger.types';
import { MessengerService } from '../../messenger/messenger.service';
import {
  TelegramClientStationState,
  TelegramStationMapping
} from './telegram-connector.types';
import { TelegramOutboxService } from './telegram-outbox.service';

type TelegramUpdate = {
  callback_query?: {
    id?: string;
    data?: string;
    from?: { id?: number };
    message?: { chat?: { id?: number } };
  };
  message?: {
    chat?: { id?: number; type?: string };
    from?: { id?: number; is_bot?: boolean };
    text?: string;
    caption?: string;
    contact?: { phone_number?: string };
    reply_to_message?: { text?: string; caption?: string };
  };
};

@Injectable()
export class TelegramConnectorService implements OnModuleInit {
  private readonly logger = new Logger(TelegramConnectorService.name);
  private readonly botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
  private readonly webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  private readonly deliveryMode = (
    process.env.TELEGRAM_DELIVERY_MODE ?? 'outbox'
  ).toLowerCase();
  private readonly stationMappings = this.parseStationMappings();
  private readonly mappingByKey = new Map<string, TelegramStationMapping>();
  private readonly mappingByStationId = new Map<string, TelegramStationMapping>();
  private readonly mappingByGroupChatId = new Map<string, TelegramStationMapping>();
  private readonly clientStationState = new Map<number, TelegramClientStationState>();

  constructor(
    private readonly messengerService: MessengerService,
    private readonly outboxService: TelegramOutboxService
  ) {
    for (const mapping of this.stationMappings) {
      this.mappingByKey.set(mapping.key, mapping);
      this.mappingByStationId.set(mapping.stationId, mapping);
      this.mappingByGroupChatId.set(String(mapping.groupChatId), mapping);
    }
  }

  onModuleInit(): void {
    this.messengerService.registerMessageObserver((thread, message) =>
      this.forwardMessengerMessageToTelegram(thread, message)
    );
  }

  listStations(): TelegramStationMapping[] {
    return this.stationMappings;
  }

  async handleWebhookUpdate(
    rawUpdate: unknown,
    receivedSecret?: string
  ): Promise<{ ok: true }> {
    this.assertWebhookSecret(receivedSecret);
    const update = (rawUpdate ?? {}) as TelegramUpdate;

    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return { ok: true };
    }

    if (!update.message || !update.message.chat) {
      return { ok: true };
    }

    const chatType = update.message.chat.type;
    if (chatType === 'private') {
      await this.handleClientPrivateMessage(update.message);
      return { ok: true };
    }

    if (chatType === 'group' || chatType === 'supergroup') {
      await this.handleStationGroupMessage(update.message);
      return { ok: true };
    }

    return { ok: true };
  }

  private assertWebhookSecret(receivedSecret?: string): void {
    if (!this.webhookSecret) {
      return;
    }
    if (receivedSecret === this.webhookSecret) {
      return;
    }
    throw new ForbiddenException('Invalid telegram webhook secret');
  }

  private async handleCallbackQuery(
    callback: NonNullable<TelegramUpdate['callback_query']>
  ): Promise<void> {
    const callbackId = callback.id;
    const data = String(callback.data ?? '').trim();
    if (!data) {
      if (callbackId) {
        await this.answerCallbackQuery(callbackId, 'Команда не распознана');
      }
      return;
    }

    const mapping = this.mappingByKey.get(data);
    if (!mapping) {
      if (callbackId) {
        await this.answerCallbackQuery(callbackId, 'Маршрут не поддерживается');
      }
      return;
    }

    const clientChatId = callback.from?.id ?? callback.message?.chat?.id;
    if (!clientChatId) {
      return;
    }

    this.clientStationState.set(clientChatId, {
      stationId: mapping.stationId,
      stationName: mapping.stationName,
      groupChatId: String(mapping.groupChatId)
    });

    if (callbackId) {
      await this.answerCallbackQuery(callbackId, `Станция: ${mapping.stationName}`);
    }

    await this.sendTelegramMessage(String(clientChatId), {
      text: `Подключили станцию: ${mapping.stationName}\nТеперь можете писать сообщение администратору.`,
      disable_web_page_preview: true
    });
  }

  private async handleClientPrivateMessage(
    message: NonNullable<TelegramUpdate['message']>
  ): Promise<void> {
    const clientChatId = message.chat?.id;
    if (!clientChatId) {
      return;
    }

    const text = this.readMessageText(message);
    const contactPhone = message.contact?.phone_number
      ? `Контакт клиента: ${message.contact.phone_number}`
      : '';

    if (!text && !contactPhone) {
      return;
    }

    if (text === '/start' || text === '☰ Меню') {
      await this.sendStationSelector(clientChatId);
      return;
    }

    const startKey = this.extractStartKey(text);
    if (startKey) {
      const mapping = this.mappingByKey.get(startKey);
      if (mapping) {
        this.clientStationState.set(clientChatId, {
          stationId: mapping.stationId,
          stationName: mapping.stationName,
          groupChatId: String(mapping.groupChatId)
        });
        await this.sendTelegramMessage(String(clientChatId), {
          text: `Станция выбрана: ${mapping.stationName}`
        });
        return;
      }
    }

    const stationState = this.clientStationState.get(clientChatId);
    if (!stationState) {
      await this.sendStationSelector(clientChatId);
      return;
    }

    const outgoingText = text || contactPhone;
    const clientId = this.toClientId(clientChatId);
    const thread = this.findOrCreateClientThread(clientChatId, clientId, stationState);
    const dto: CreateMessageDto = { text: outgoingText };
    this.messengerService.sendMessage(thread.id, dto, this.buildClientUser(clientChatId));
  }

  private async handleStationGroupMessage(
    message: NonNullable<TelegramUpdate['message']>
  ): Promise<void> {
    const groupChatId = message.chat?.id;
    if (!groupChatId) {
      return;
    }
    if (message.from?.is_bot) {
      return;
    }

    const mapping = this.mappingByGroupChatId.get(String(groupChatId));
    if (!mapping) {
      return;
    }

    const text = this.readMessageText(message);
    if (!text) {
      return;
    }

    const replyText = this.readReplyText(message);
    const clientChatId = this.extractClientChatId(replyText);
    if (!clientChatId) {
      return;
    }

    let thread: ChatThread | undefined;
    const threadId = this.extractThreadId(replyText);
    if (threadId) {
      thread = this.safeGetThreadById(threadId);
    }
    if (!thread) {
      thread = this.findOpenThreadForClientAndStation(
        this.toClientId(clientChatId),
        mapping.stationId
      );
    }
    if (!thread) {
      return;
    }

    const dto: CreateMessageDto = { text };
    const senderId = message.from?.id ? `tg-admin:${message.from.id}` : 'tg-admin';
    const user: RequestUser = {
      id: senderId,
      roles: [Role.SUPPORT],
      stationIds: [mapping.stationId]
    };
    this.messengerService.sendMessage(thread.id, dto, user);
  }

  private findOrCreateClientThread(
    clientChatId: number,
    clientId: string,
    state: TelegramClientStationState
  ): ChatThread {
    const existing = this.findOpenThreadForClientAndStation(clientId, state.stationId);
    if (existing) {
      return existing;
    }

    const dto: CreateThreadDto = {
      connector: ConnectorRoute.TG_BOT,
      stationId: state.stationId,
      stationName: state.stationName,
      subject: `Telegram ${clientChatId}`
    };
    return this.messengerService.createThread(dto, this.buildClientUser(clientChatId));
  }

  private findOpenThreadForClientAndStation(
    clientId: string,
    stationId: string
  ): ChatThread | undefined {
    const threads = this.messengerService.listThreads(this.buildSystemUser(), {
      connector: ConnectorRoute.TG_BOT,
      stationId
    });

    return threads.find(
      (thread) => thread.clientId === clientId && thread.status === ThreadStatus.OPEN
    );
  }

  private safeGetThreadById(threadId: string): ChatThread | undefined {
    try {
      return this.messengerService.getThreadById(threadId, this.buildSystemUser());
    } catch (_error) {
      return undefined;
    }
  }

  private async forwardMessengerMessageToTelegram(
    thread: ChatThread,
    message: ChatMessage
  ): Promise<void> {
    if (thread.connector !== ConnectorRoute.TG_BOT) {
      return;
    }

    const clientChatId = this.fromClientId(thread.clientId);
    if (!clientChatId) {
      return;
    }

    if (message.senderRole === Role.CLIENT) {
      const mapping = this.mappingByStationId.get(thread.stationId);
      if (!mapping) {
        return;
      }

      const stationTitle = thread.stationName || mapping.stationName || thread.stationId;
      const text = [
        `<b>${this.escapeHtml(stationTitle)}</b>`,
        `thread:${this.escapeHtml(thread.id)}`,
        `client:${this.escapeHtml(String(clientChatId))}`,
        '',
        this.escapeHtml(message.text)
      ].join('\n');

      await this.sendTelegramMessage(String(mapping.groupChatId), {
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
      return;
    }

    const senderLabel =
      message.origin === 'AI' ? 'AI помощник ПадлхАБ' : 'Администратор ПадлхАБ';
    const text = `<b>${this.escapeHtml(senderLabel)}</b>\n${this.escapeHtml(message.text)}`;

    await this.sendTelegramMessage(String(clientChatId), {
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  }

  private async sendStationSelector(clientChatId: number): Promise<void> {
    const rows = this.stationMappings.map((item) => [
      { text: item.stationName, callback_data: item.key }
    ]);
    await this.sendTelegramMessage(String(clientChatId), {
      text: 'Выберите станцию, чтобы начать диалог с администратором:',
      reply_markup: {
        inline_keyboard: rows
      }
    });
  }

  private async answerCallbackQuery(
    callbackQueryId: string,
    text: string
  ): Promise<void> {
    await this.sendTelegramCommand('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text
    });
  }

  private async sendTelegramMessage(
    chatId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.sendTelegramCommand('sendMessage', {
      chat_id: chatId,
      ...payload
    });
  }

  private async sendTelegramCommand(
    method: 'sendMessage' | 'answerCallbackQuery',
    payload: Record<string, unknown>
  ): Promise<void> {
    if (this.deliveryMode === 'outbox') {
      this.outboxService.enqueue(method, payload);
      return;
    }
    await this.callTelegramApiDirect(method, payload);
  }

  private async callTelegramApiDirect(
    method: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    if (!this.botToken) {
      this.logger.warn(
        `TELEGRAM_BOT_TOKEN is empty. Skip outgoing telegram call ${method}.`
      );
      return;
    }

    const response = await fetch(
      `https://api.telegram.org/bot${this.botToken}/${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.error(`Telegram API ${method} HTTP ${response.status}: ${text}`);
      return;
    }

    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; description?: string }
      | null;
    if (body && body.ok === false) {
      this.logger.error(`Telegram API ${method} rejected: ${body.description ?? 'unknown'}`);
    }
  }

  private readMessageText(message: NonNullable<TelegramUpdate['message']>): string {
    return String(message.text ?? message.caption ?? '').trim();
  }

  private readReplyText(message: NonNullable<TelegramUpdate['message']>): string {
    return String(message.reply_to_message?.text ?? message.reply_to_message?.caption ?? '');
  }

  private extractClientChatId(replyText: string): number | null {
    const direct = replyText.match(/client\s*[:=]\s*(-?\d+)/i);
    if (direct) {
      return Number(direct[1]);
    }

    const tgid = replyText.match(/TGid\s*:\s*\*?(-?\d+)\*?/i);
    if (tgid) {
      return Number(tgid[1]);
    }

    const generic = replyText.match(/\*(-?\d{5,})\*/);
    if (generic) {
      return Number(generic[1]);
    }

    return null;
  }

  private extractThreadId(replyText: string): string | null {
    const match = replyText.match(/thread(?:_id)?\s*[:=]\s*([a-f0-9-]{20,})/i);
    if (!match) {
      return null;
    }
    return match[1];
  }

  private extractStartKey(text: string): string | null {
    if (!text.startsWith('/start')) {
      return null;
    }
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      return null;
    }
    return parts[1].trim();
  }

  private buildClientUser(clientChatId: number): RequestUser {
    return {
      id: this.toClientId(clientChatId),
      roles: [Role.CLIENT],
      stationIds: []
    };
  }

  private buildSystemUser(): RequestUser {
    return {
      id: 'telegram-connector-system',
      roles: [Role.SUPER_ADMIN],
      stationIds: []
    };
  }

  private toClientId(chatId: number): string {
    return `tg:${chatId}`;
  }

  private fromClientId(clientId: string): number | null {
    const match = clientId.match(/^tg:(-?\d+)$/);
    if (!match) {
      return null;
    }
    return Number(match[1]);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private parseStationMappings(): TelegramStationMapping[] {
    const raw = process.env.TELEGRAM_STATION_MAPPINGS;
    if (!raw) {
      return this.defaultStationMappings();
    }

    try {
      const parsed = JSON.parse(raw) as Array<
        Partial<TelegramStationMapping> & { callbackKey?: string }
      >;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .map((item) => ({
            key: String(item.key ?? item.callbackKey ?? '').trim(),
            stationId: String(item.stationId).trim(),
            stationName: String(item.stationName).trim(),
            groupChatId: String(item.groupChatId).trim()
          }))
          .filter(
            (item) =>
              item.key.length > 0 &&
              item.stationId.length > 0 &&
              item.stationName.length > 0 &&
              item.groupChatId.length > 0
          );
      }
    } catch (error) {
      this.logger.error(`Invalid TELEGRAM_STATION_MAPPINGS JSON: ${String(error)}`);
    }

    return this.defaultStationMappings();
  }

  private defaultStationMappings(): TelegramStationMapping[] {
    return [
      {
        key: 'yas',
        stationId: 'Yasenevo',
        stationName: 'Ясенево',
        groupChatId: '-1002248644435'
      },
      {
        key: 'nagat',
        stationId: 'Nagatinskaya',
        stationName: 'Нагатинская',
        groupChatId: '-1002321881785'
      },
      {
        key: 'nagat_p',
        stationId: 'NagatinskayaP',
        stationName: 'Нагатинская Премиум',
        groupChatId: '-5056259448'
      },
      {
        key: 'tereh',
        stationId: 'Terehovo',
        stationName: 'Терехово',
        groupChatId: '-4538138614'
      },
      {
        key: 'kuncev',
        stationId: 'Skolkovo',
        stationName: 'Сколково',
        groupChatId: '-4521607381'
      },
      {
        key: 'sochi',
        stationId: 'Sochi',
        stationName: 'Сочи',
        groupChatId: '-1003682319256'
      },
      {
        key: 'seleger',
        stationId: 'seleger',
        stationName: 'Селигерская',
        groupChatId: '-5124280803'
      },
      {
        key: 't-sbora',
        stationId: 'care_service',
        stationName: 'Точка сбора',
        groupChatId: '-1003843984863'
      }
    ];
  }
}
