import { Module } from '@nestjs/common';
import { LkPadelHubModule } from '../integrations/lk-padelhub/lk-padelhub.module';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';

@Module({
  imports: [LkPadelHubModule],
  controllers: [GamesController],
  providers: [GamesService]
})
export class GamesModule {}
