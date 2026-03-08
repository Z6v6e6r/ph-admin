import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query
} from '@nestjs/common';
import { TelegramConnectorService } from './telegram-connector.service';
import { TelegramOutboxService } from './telegram-outbox.service';
import { TelegramOutboxCommand } from './telegram-outbox.types';

@Controller('integrations/telegram')
export class TelegramConnectorController {
  constructor(
    private readonly telegramConnectorService: TelegramConnectorService,
    private readonly telegramOutboxService: TelegramOutboxService
  ) {}

  @Post('webhook')
  async webhook(
    @Body() update: unknown,
    @Headers('x-telegram-bot-api-secret-token') secret?: string
  ): Promise<{ ok: true }> {
    return this.telegramConnectorService.handleWebhookUpdate(update, secret);
  }

  @Get('stations')
  stations(): ReturnType<TelegramConnectorService['listStations']> {
    return this.telegramConnectorService.listStations();
  }

  @Get('outbox/pull')
  pullOutbox(
    @Headers('x-integration-token') token?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('leaseSec', new ParseIntPipe({ optional: true })) leaseSec?: number
  ): { commands: TelegramOutboxCommand[] } {
    this.assertIntegrationToken(token);
    return {
      commands: this.telegramOutboxService.pull(limit ?? 20, leaseSec ?? 30)
    };
  }

  @Post('outbox/:id/ack')
  ackOutbox(
    @Headers('x-integration-token') token: string | undefined,
    @Param('id') id: string,
    @Body() body: { providerMessageId?: string } = {}
  ): TelegramOutboxCommand {
    this.assertIntegrationToken(token);
    return this.telegramOutboxService.ack(id, body.providerMessageId);
  }

  @Post('outbox/:id/fail')
  failOutbox(
    @Headers('x-integration-token') token: string | undefined,
    @Param('id') id: string,
    @Body() body: { error?: string; requeue?: boolean } = {}
  ): TelegramOutboxCommand {
    this.assertIntegrationToken(token);
    return this.telegramOutboxService.fail(
      id,
      body.error,
      body.requeue !== false
    );
  }

  @Get('outbox')
  listOutbox(
    @Headers('x-integration-token') token?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number
  ): { commands: TelegramOutboxCommand[] } {
    this.assertIntegrationToken(token);
    return { commands: this.telegramOutboxService.list(limit ?? 100) };
  }

  private assertIntegrationToken(token?: string): void {
    const expected = process.env.TELEGRAM_INTEGRATION_TOKEN ?? '';
    if (!expected) {
      return;
    }
    if (token === expected) {
      return;
    }
    throw new ForbiddenException('Invalid integration token');
  }
}
