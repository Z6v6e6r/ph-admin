import { Module } from '@nestjs/common';
import { SupportModule } from '../support/support.module';
import { AiConnectorService } from './ai/ai-connector.service';
import { MessengerController } from './messenger.controller';
import { MessengerPersistenceService } from './messenger-persistence.service';
import { MessengerService } from './messenger.service';

@Module({
  imports: [SupportModule],
  controllers: [MessengerController],
  providers: [MessengerService, AiConnectorService, MessengerPersistenceService],
  exports: [MessengerService]
})
export class MessengerModule {}
