import { Module } from '@nestjs/common';
import { LkPadelHubModule } from '../integrations/lk-padelhub/lk-padelhub.module';
import { VivaTournamentsService } from '../integrations/viva/viva-tournaments.service';
import { TournamentsPersistenceService } from './tournaments-persistence.service';
import { TournamentsController } from './tournaments.controller';
import { TournamentsPublicController } from './tournaments-public.controller';
import { TournamentsService } from './tournaments.service';

@Module({
  imports: [LkPadelHubModule],
  controllers: [TournamentsController, TournamentsPublicController],
  providers: [TournamentsService, TournamentsPersistenceService, VivaTournamentsService]
})
export class TournamentsModule {}
