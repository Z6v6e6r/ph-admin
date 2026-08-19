import { Module } from '@nestjs/common';
import { PlayerRatingsController } from './player-ratings.controller';
import { PlayerRatingRepository } from './player-ratings.repository';
import { PlayerRatingsService } from './player-ratings.service';
import { PlayerLevelProjectionService } from './player-level-projection.service';

@Module({
  controllers: [PlayerRatingsController],
  providers: [PlayerRatingsService, PlayerRatingRepository, PlayerLevelProjectionService],
  exports: [PlayerRatingsService]
})
export class PlayerRatingsModule {}
