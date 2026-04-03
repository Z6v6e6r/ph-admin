import { Module } from '@nestjs/common';
import { QuickRepliesPersistenceService } from './quick-replies-persistence.service';
import { QuickRepliesService } from './quick-replies.service';

@Module({
  providers: [QuickRepliesPersistenceService, QuickRepliesService],
  exports: [QuickRepliesService]
})
export class QuickRepliesModule {}
