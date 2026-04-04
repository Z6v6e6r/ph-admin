import { Module } from '@nestjs/common';
import { LkPadelHubModule } from '../integrations/lk-padelhub/lk-padelhub.module';
import { VivaTournamentsService } from '../integrations/viva/viva-tournaments.service';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';

@Module({
  imports: [LkPadelHubModule],
  controllers: [TournamentsController],
  providers: [TournamentsService, VivaTournamentsService]
})
export class TournamentsModule {}
