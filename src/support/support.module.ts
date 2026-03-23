import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportPersistenceService } from './support-persistence.service';
import { SupportService } from './support.service';

@Module({
  controllers: [SupportController],
  providers: [SupportService, SupportPersistenceService],
  exports: [SupportService]
})
export class SupportModule {}
