import { Module } from '@nestjs/common';
import { LkPadelHubModule } from '../integrations/lk-padelhub/lk-padelhub.module';
import { CommunitiesController } from './communities.controller';
import { CommunitiesPublicController } from './communities-public.controller';
import { CommunitiesPersistenceService } from './communities-persistence.service';
import { CommunitiesService } from './communities.service';

@Module({
  imports: [LkPadelHubModule],
  controllers: [CommunitiesController, CommunitiesPublicController],
  providers: [CommunitiesService, CommunitiesPersistenceService]
})
export class CommunitiesModule {}
