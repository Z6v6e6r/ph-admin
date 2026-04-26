import { Module } from '@nestjs/common';
import { CommunitiesModule } from '../communities/communities.module';
import { GamesModule } from '../games/games.module';
import { LkPadelHubModule } from '../integrations/lk-padelhub/lk-padelhub.module';
import { VivaAdminService } from '../integrations/viva/viva-admin.service';
import { AmericanoRatingSimulationService } from './americano-rating-simulation.service';
import { VivaTournamentsService } from '../integrations/viva/viva-tournaments.service';
import { AmericanoScheduleService } from './americano-schedule.service';
import { TournamentsPublicSessionService } from './tournaments-public-session.service';
import { TournamentsPersistenceService } from './tournaments-persistence.service';
import { TournamentsController } from './tournaments.controller';
import { TournamentsPublicController } from './tournaments-public.controller';
import { TournamentsService } from './tournaments.service';

@Module({
  imports: [LkPadelHubModule, GamesModule, CommunitiesModule],
  controllers: [TournamentsController, TournamentsPublicController],
  providers: [
    AmericanoScheduleService,
    AmericanoRatingSimulationService,
    TournamentsService,
    TournamentsPersistenceService,
    TournamentsPublicSessionService,
    VivaTournamentsService,
    VivaAdminService
  ]
})
export class TournamentsModule {}
