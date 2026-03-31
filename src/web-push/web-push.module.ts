import { Module } from '@nestjs/common';
import { MessengerModule } from '../messenger/messenger.module';
import { SupportModule } from '../support/support.module';
import { WebPushController } from './web-push.controller';
import { WebPushPersistenceService } from './web-push-persistence.service';
import { WebPushService } from './web-push.service';

@Module({
  imports: [MessengerModule, SupportModule],
  controllers: [WebPushController],
  providers: [WebPushService, WebPushPersistenceService],
  exports: [WebPushService]
})
export class WebPushModule {}
