import { Module } from '@nestjs/common';
import { LkPadelHubModule } from '../integrations/lk-padelhub/lk-padelhub.module';
import { CommunitiesController } from './communities.controller';
import { CommunitiesPersistenceService } from './communities-persistence.service';
import { CommunitiesService } from './communities.service';

@Module({
  imports: [LkPadelHubModule],
  controllers: [CommunitiesController],
  providers: [CommunitiesService, CommunitiesPersistenceService]
})
export class CommunitiesModule {}
