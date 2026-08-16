import { Module } from '@nestjs/common';
import { PlayerRatingsController } from './player-ratings.controller';
import { PlayerRatingRepository } from './player-ratings.repository';
import { PlayerRatingsService } from './player-ratings.service';

@Module({
  controllers: [PlayerRatingsController],
  providers: [PlayerRatingsService, PlayerRatingRepository],
  exports: [PlayerRatingsService]
})
export class PlayerRatingsModule {}
