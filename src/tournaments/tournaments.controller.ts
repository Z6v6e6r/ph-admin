import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { AmericanoRatingSimulationResult } from './americano-rating.types';
import { AmericanoScheduleResult } from './americano-schedule.types';
import { CreateCustomTournamentFromSourceDto } from './dto/create-custom-tournament-from-source.dto';
import { GenerateTournamentScheduleDto } from './dto/generate-tournament-schedule.dto';
import { SimulateTournamentRatingDto } from './dto/simulate-tournament-rating.dto';
import { UpdateCustomTournamentDto } from './dto/update-custom-tournament.dto';
import { CustomTournament, Tournament, TournamentResultsView } from './tournaments.types';
import { TournamentsService } from './tournaments.service';

@Controller('tournaments')
@Roles(
  Role.SUPER_ADMIN,
  Role.TOURNAMENT_MANAGER,
  Role.MANAGER,
  Role.STATION_ADMIN,
  Role.GAME_MANAGER
)
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  @Get()
  findAll(): Promise<Tournament[]> {
    return this.tournamentsService.findAll();
  }

  @Post('custom/from-source/:sourceTournamentId')
  createCustomFromSource(
    @Param('sourceTournamentId') sourceTournamentId: string,
    @Body() dto: CreateCustomTournamentFromSourceDto,
    @CurrentUser() user?: RequestUser
  ): Promise<CustomTournament> {
    return this.tournamentsService.createCustomFromSource(sourceTournamentId, {
      ...dto,
      ...(user ? { actor: this.toActor(user) } : {})
    });
  }

  @Get('custom/:id')
  findCustomById(@Param('id') id: string): Promise<CustomTournament> {
    return this.tournamentsService.findCustomById(id);
  }

  @Patch('custom/:id')
  updateCustom(
    @Param('id') id: string,
    @Body() dto: UpdateCustomTournamentDto,
    @CurrentUser() user?: RequestUser
  ): Promise<CustomTournament> {
    return this.tournamentsService.updateCustom(id, {
      ...dto,
      ...(user ? { actor: this.toActor(user) } : {})
    });
  }

  @Post('generate-schedule')
  generateSchedule(
    @Body() dto: GenerateTournamentScheduleDto
  ): Promise<AmericanoScheduleResult> {
    return this.tournamentsService.generateSchedule(dto);
  }

  @Post('simulate-rating')
  simulateRating(
    @Body() dto: SimulateTournamentRatingDto
  ): Promise<AmericanoRatingSimulationResult> {
    return this.tournamentsService.simulateRating(dto);
  }

  @Get(':id/results')
  getResults(
    @Param('id') id: string,
    @CurrentUser() user?: RequestUser
  ): Promise<TournamentResultsView> {
    return this.tournamentsService.getResults(id, user);
  }

  @Get(':id')
  findById(@Param('id') id: string): Promise<Tournament> {
    return this.tournamentsService.findById(id);
  }

  private toActor(user: RequestUser): { id: string; login?: string; name: string } {
    return {
      id: user.id,
      ...(user.login ? { login: user.login } : {}),
      name: user.title || user.login || user.id
    };
  }
}
