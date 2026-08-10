import { Module } from '@nestjs/common';
import { CommunitiesModule } from '../communities/communities.module';
import { GamesModule } from '../games/games.module';
import { LkPadelHubModule } from '../integrations/lk-padelhub/lk-padelhub.module';
import { VivaAdminService } from '../integrations/viva/viva-admin.service';
import { VivaReferenceCacheService } from '../integrations/viva/viva-reference-cache.service';
import { VivaRequestGovernorService } from '../integrations/viva/viva-request-governor.service';
import { VivaTournamentSnapshotService } from '../integrations/viva/viva-tournament-snapshot.service';
import { AmericanoRatingSimulationService } from './americano-rating-simulation.service';
import { VivaTournamentsService } from '../integrations/viva/viva-tournaments.service';
import { AmericanoScheduleService } from './americano-schedule.service';
import { TournamentsPublicSessionService } from './tournaments-public-session.service';
import { TournamentsPersistenceService } from './tournaments-persistence.service';
import { TournamentsController } from './tournaments.controller';
import { TournamentsPublicController } from './tournaments-public.controller';
import { TournamentResultsExportService } from './tournament-results-export.service';
import { TournamentResultsStoreService } from './tournament-results-store.service';
import { TournamentsService } from './tournaments.service';
import { TournamentsVivaStatusSyncService } from './tournaments-viva-status-sync.service';

@Module({
  imports: [LkPadelHubModule, GamesModule, CommunitiesModule],
  controllers: [TournamentsController, TournamentsPublicController],
  providers: [
    AmericanoScheduleService,
    AmericanoRatingSimulationService,
    TournamentsService,
    TournamentResultsExportService,
    TournamentResultsStoreService,
    TournamentsVivaStatusSyncService,
    TournamentsPersistenceService,
    TournamentsPublicSessionService,
    VivaTournamentsService,
    VivaRequestGovernorService,
    VivaReferenceCacheService,
    VivaTournamentSnapshotService,
    VivaAdminService
  ]
})
export class TournamentsModule {}
