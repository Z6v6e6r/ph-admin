import { Module } from '@nestjs/common';
import { MessengerModule } from '../../messenger/messenger.module';
import { TelegramConnectorController } from './telegram-connector.controller';
import { TelegramOutboxService } from './telegram-outbox.service';
import { TelegramConnectorService } from './telegram-connector.service';

@Module({
  imports: [MessengerModule],
  controllers: [TelegramConnectorController],
  providers: [TelegramConnectorService, TelegramOutboxService]
})
export class TelegramConnectorModule {}
