import { Module } from '@nestjs/common';
import { LkPadelHubModule } from '../integrations/lk-padelhub/lk-padelhub.module';
import { VivaTournamentsService } from '../integrations/viva/viva-tournaments.service';
import { AmericanoScheduleService } from './americano-schedule.service';
import { TournamentsPublicSessionService } from './tournaments-public-session.service';
import { TournamentsPersistenceService } from './tournaments-persistence.service';
import { TournamentsController } from './tournaments.controller';
import { TournamentsPublicController } from './tournaments-public.controller';
import { TournamentsService } from './tournaments.service';

@Module({
  imports: [LkPadelHubModule],
  controllers: [TournamentsController, TournamentsPublicController],
  providers: [
    AmericanoScheduleService,
    TournamentsService,
    TournamentsPersistenceService,
    TournamentsPublicSessionService,
    VivaTournamentsService
  ]
})
export class TournamentsModule {}
