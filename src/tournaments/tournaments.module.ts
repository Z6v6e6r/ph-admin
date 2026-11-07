import { TournamentChatNotificationProof } from './tournament-chat-notification.proof';
import { TournamentChatNotificationService } from './tournament-chat-notification.service';
import { TournamentChatNotificationController } from './tournament-chat-notification.controller';
import { TournamentChatActorProof } from './tournament-chat.actor-proof';
import { TournamentChatPersistence } from './tournament-chat.persistence';
import { TournamentChatService } from './tournament-chat.service';
import { TournamentChatRecovery } from './tournament-chat.recovery';
import { TournamentChatController } from './tournament-chat.controller';
import { TournamentOrganizerController } from './tournament-organizer.controller';
import { TournamentOrganizerService } from './tournament-organizer.service';
import { TournamentOrganizerLookupClient } from './tournament-organizer-lookup.client';
import { TournamentsLocalOwnerController } from './tournaments-local-owner.controller';
import { TournamentsOwnerPreparationController } from './tournaments-owner-preparation.controller';
import { Module } from '@nestjs/common';
import { CommunitiesModule } from '../communities/communities.module';
import { GamesModule } from '../games/games.module';
import { LkPadelHubModule } from '../integrations/lk-padelhub/lk-padelhub.module';
import { LkIdentityModule } from '../lk-identity/lk-identity.module';
import { PlayerRatingsModule } from '../player-ratings/player-ratings.module';
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
  imports: [LkPadelHubModule, GamesModule, CommunitiesModule, LkIdentityModule, PlayerRatingsModule],
  controllers: [TournamentChatNotificationController, TournamentChatController, TournamentOrganizerController, TournamentsLocalOwnerController, TournamentsController, TournamentsPublicController, TournamentsOwnerPreparationController],
  providers: [
    TournamentChatNotificationProof, TournamentChatNotificationService,
    TournamentChatActorProof, TournamentChatPersistence, TournamentChatService, TournamentChatRecovery,
    TournamentOrganizerService, TournamentOrganizerLookupClient,
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
