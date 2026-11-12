import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LkPadelHubModule } from '../integrations/lk-padelhub/lk-padelhub.module';
import { CommunitiesController } from './communities.controller';
import { CommunitiesPublicController } from './communities-public.controller';
import { CommunitiesPersistenceService } from './communities-persistence.service';
import { CommunitiesService } from './communities.service';

@Module({
  imports: [AuthModule, LkPadelHubModule],
  controllers: [CommunitiesController, CommunitiesPublicController],
  providers: [CommunitiesService, CommunitiesPersistenceService],
  exports: [CommunitiesService]
})
export class CommunitiesModule {}
