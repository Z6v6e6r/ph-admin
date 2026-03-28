import { Module } from '@nestjs/common';
import { MaxAcademySupportConnectorAdapter } from './connectors/max-academy-support.connector';
import { MaxSupportConnectorAdapter } from './connectors/max-support.connector';
import { SupportConnectorRegistry } from './connectors/support-connector.registry';
import { WebAcademySupportConnectorAdapter } from './connectors/web-academy-support.connector';
import { WebSupportConnectorAdapter } from './connectors/web-support.connector';
import { SupportController } from './support.controller';
import { SupportPersistenceService } from './support-persistence.service';
import { SupportService } from './support.service';

@Module({
  controllers: [SupportController],
  providers: [
    SupportService,
    SupportPersistenceService,
    SupportConnectorRegistry,
    MaxSupportConnectorAdapter,
    MaxAcademySupportConnectorAdapter,
    WebSupportConnectorAdapter,
    WebAcademySupportConnectorAdapter
  ],
  exports: [SupportService]
})
export class SupportModule {}
