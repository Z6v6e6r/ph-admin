import { Injectable, NotFoundException } from '@nestjs/common';
import { LkPadelHubClientService } from '../integrations/lk-padelhub/lk-padelhub-client.service';
import { VivaTournamentsService } from '../integrations/viva/viva-tournaments.service';
import { Tournament } from './tournaments.types';

@Injectable()
export class TournamentsService {
  constructor(
    private readonly lkPadelHubClient: LkPadelHubClientService,
    private readonly vivaTournamentsService: VivaTournamentsService
  ) {}

  async findAll(): Promise<Tournament[]> {
    const vivaTournaments = await this.vivaTournamentsService.listTournaments();
    if (vivaTournaments) {
      return vivaTournaments;
    }

    return this.lkPadelHubClient.listTournaments();
  }

  async findById(id: string): Promise<Tournament> {
    const tournament = await this.lkPadelHubClient.getTournamentById(id);
    if (!tournament) {
      throw new NotFoundException(`Tournament with id ${id} not found`);
    }
    return tournament;
  }
}
