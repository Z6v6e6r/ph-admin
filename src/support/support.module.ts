import { Module } from '@nestjs/common';
import { QuickRepliesModule } from '../quick-replies/quick-replies.module';
import { MaxAcademySupportConnectorAdapter } from './connectors/max-academy-support.connector';
import { MaxSupportConnectorAdapter } from './connectors/max-support.connector';
import { SupportConnectorRegistry } from './connectors/support-connector.registry';
import { WebAcademySupportConnectorAdapter } from './connectors/web-academy-support.connector';
import { WebPromoSupportConnectorAdapter } from './connectors/web-promo-support.connector';
import { WebSupportConnectorAdapter } from './connectors/web-support.connector';
import { SupportController } from './support.controller';
import { SupportPersistenceService } from './support-persistence.service';
import { SupportService } from './support.service';
import { SupportMediaService } from './support-media.service';
import { SupportMediaInterceptor } from './support-media.interceptor';
import { SupportMediaController } from './support-media.controller';

@Module({
  imports: [QuickRepliesModule],
  controllers: [SupportController, SupportMediaController],
  providers: [
    { provide: SupportMediaService, useFactory: () => new SupportMediaService() },
    SupportMediaInterceptor,
    SupportService,
    SupportPersistenceService,
    SupportConnectorRegistry,
    MaxSupportConnectorAdapter,
    MaxAcademySupportConnectorAdapter,
    WebSupportConnectorAdapter,
    WebAcademySupportConnectorAdapter,
    WebPromoSupportConnectorAdapter
  ],
  exports: [SupportService, SupportMediaService, SupportMediaInterceptor]
})
export class SupportModule {}
