import { Module } from '@nestjs/common';
import { LkPadelHubModule } from '../integrations/lk-padelhub/lk-padelhub.module';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';

@Module({
  imports: [LkPadelHubModule],
  controllers: [TournamentsController],
  providers: [TournamentsService]
})
export class TournamentsModule {}
