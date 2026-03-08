import { Injectable, NotFoundException } from '@nestjs/common';
import { LkPadelHubClientService } from '../integrations/lk-padelhub/lk-padelhub-client.service';
import { Game } from './games.types';

@Injectable()
export class GamesService {
  constructor(private readonly lkPadelHubClient: LkPadelHubClientService) {}

  async findAll(): Promise<Game[]> {
    return this.lkPadelHubClient.listGames();
  }

  async findById(id: string): Promise<Game> {
    const game = await this.lkPadelHubClient.getGameById(id);
    if (!game) {
      throw new NotFoundException(`Game with id ${id} not found`);
    }
    return game;
  }
}
